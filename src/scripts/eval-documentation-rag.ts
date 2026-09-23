/**
 * Level 2 retrieval evaluation for the Appium documentation tool.
 *
 * Runs fixed golden queries through the production queryVectorStore retriever:
 * does the retrieved context contain the expected documentation and evidence?
 * No query-generation model, answer synthesis, or LLM judge is involved. Local
 * embeddings require no API credential, but may download weights on first use.
 *
 * What we measure:
 *
 *   1. answerSpanRecall / hitAnyAt{1,3,5,10} / MRR
 *      answerSpanRecall is the fraction of declared answerSpans found in top-K.
 *      A hit requires ANY span; MRR averages the reciprocal rank of the first
 *      chunk containing a span (zero for a miss). Aggregate span metrics include
 *      only cases declaring spans. These measure evidence presence, not final
 *      answer correctness; broad markers can match unrelated documentation.
 *
 *   2. sourceHit / sourceHitRate / sourceFirstHitRank
 *      Does ANY acceptable expected source appear in top-K, and at what rank?
 *      fileRecallAt5/10 retain the legacy names for binary any-source hits at
 *      those cutoffs; they are not multi-document recall. Missing source metadata
 *      does not change chunk ranks. Cutoffs above requested K are null (N/A).
 *
 *   3. requiredFactsPresent / requiredFactsMissing
 *      Optional ALL-of fact markers: each must occur in a chunk from an expected
 *      source. This distinguishes source-scoped evidence from legacy span hits.
 *
 *   4. contextEfficiency
 *      1000 * spansCovered / topKChars, averaged over cases with a span hit in
 *      top-K. Evidence density is diagnostic, not a composite quality score.
 *
 *   5. latencyMs / topKChunks / topKChars / uniqueFiles / payloadBytes
 *      Retrieval time includes initialization for the first query. Payload bytes
 *      count UTF-8 serialized returned documents including metadata, not tokens
 *      or MCP wire bytes. Mean latency and payload size are also reported.
 *
 * Saved reports include datasetSha256 and corpusSha256 for the exact input file
 * bytes. Compare these alongside datasetVersion, embeddingModel, and topK; the
 * hashes identify inputs but do not pin downloaded model weights or the runtime.
 *
 * Text matching lowercases and collapses whitespace, then checks substrings
 * within individual chunks, never across chunk boundaries. Source paths match
 * exactly or by suffix at a path boundary. A case fails if no expected source
 * appears, no declared answerSpan appears, or any requiredFact is missing.
 *
 * Usage (after npm run build):
 *   npm run eval-docs -- [--top-k=10] [--label=NAME] [--quiet] [--no-save] [--strict]
 *
 *   --top-k=N   positive integer context budget (default 10)
 *   --label=N   saved run label (letters, digits, underscores, hyphens)
 *   --quiet     suppress per-case progress/table; retain failures and summaries
 *   --no-save   skip JSON reports in src/scripts/eval-results/
 *   --strict    exit 1 on quality failures after reporting; default is report-only
 *
 * Execution, dataset, and argument errors always exit 1. See evals/DESIGN.md for
 * dataset maintenance, repository ownership, CI strategy, and future layers.
 */

import {createHash} from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';

import {queryVectorStore} from '../simple-pdf-indexer.js';
import {
  checkEvidence,
  chunkContainsSpan,
  endsWithExpected,
  evalDatasetSchema,
  type EvalQuery,
  type RetrievedChunk,
} from './rag-eval-checks.js';

interface PerQueryResult extends ReturnType<typeof checkEvidence> {
  question: string;
  requiredFacts: string[];
  latencyMs: number;
  payloadBytes: number;
  id: string;
  query: string;
  difficulty: EvalQuery['difficulty'];
  category?: string;
  expectedSources: string[];
  answerSpans: string[];
  retrievedSources: string[];
  topKChunks: number;
  topKChars: number;
  uniqueFiles: number;

  // Ranks containing at least one answerSpan, the first such rank, and the
  // covered/missing spans. Lets us derive hit@K cheaply.
  hitRanks: number[];
  firstHitRank: number | null;
  spansCovered: string[];
  spansMissing: string[];

  // Aggregates: per definitions in evals/DESIGN.md.
  answerSpanRecall: number;
  hitAnyAt1: number | null;
  hitAnyAt3: number | null;
  hitAnyAt5: number | null;
  hitAnyAt10: number | null;
  reciprocalRank: number;
  contextEfficiency: number; // spans/kchar; only meaningful when hitAny=1

  // Diagnostic: right-file recall (independent of whether the answer span
  // actually landed). Useful for spotting "right file, wrong section" cases.
  fileRecallAt5: number | null;
  fileRecallAt10: number | null;
}

interface AggregateMetrics {
  sourceHitRate: number;
  averageLatencyMs: number;
  averagePayloadBytes: number;
  failedCases: number;
  count: number;
  answerSpanRecall: number;
  hitAnyAt1: number | null;
  hitAnyAt3: number | null;
  hitAnyAt5: number | null;
  hitAnyAt10: number | null;
  mrr: number;
  contextEfficiency: number; // averaged over queries with a hit
  fileRecallAt5: number | null;
  fileRecallAt10: number | null;
}

interface EvalRun {
  timestamp: string;
  label: string;
  datasetVersion: number;
  datasetSha256: string;
  corpusSha256: string;
  topK: number;
  embeddingModel: string;
  overall: AggregateMetrics;
  byDifficulty: Record<string, AggregateMetrics>;
  perQuery: PerQueryResult[];
}

// -- arg parsing ----------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
const flagSet = new Set(args);
const QUIET = flagSet.has('--quiet');
const NO_SAVE = flagSet.has('--no-save');

function flagValue(name: string, dflt: string): string {
  const a = args.find((x) => x.startsWith(`${name}=`));
  return a ? a.split('=').slice(1).join('=') : dflt;
}

const TOP_K = Number(flagValue('--top-k', '10'));
const LABEL = flagValue('--label', 'default');

// -- paths ----------------------------------------------------------------

function resolveDatasetPath(): string {
  const candidates = [
    path.resolve(__dirname, 'rag-eval-dataset.json'),
    path.resolve(__dirname, '../../src/scripts/rag-eval-dataset.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  throw new Error(`rag-eval-dataset.json not found in: ${candidates.join(', ')}`);
}

function resolveResultsDir(): string {
  const dir = path.resolve(__dirname, '../../src/scripts/eval-results');
  fs.mkdirSync(dir, {recursive: true});
  return dir;
}

// -- per-query evaluation -------------------------------------------------

function evaluateQuery(
  q: EvalQuery,
  chunks: RetrievedChunk[],
): {
  hitRanks: number[];
  firstHitRank: number | null;
  spansCovered: string[];
  spansMissing: string[];
} {
  const hitRanks: number[] = [];
  const spansCovered = new Set<string>();

  for (const chunk of chunks) {
    let chunkHadHit = false;
    for (const span of q.answerSpans) {
      if (chunkContainsSpan(chunk.text, span)) {
        spansCovered.add(span);
        chunkHadHit = true;
      }
    }
    if (chunkHadHit) {
      hitRanks.push(chunk.rank);
    }
  }
  const firstHitRank = hitRanks.length > 0 ? hitRanks[0] : null;
  const spansMissing = q.answerSpans.filter((s) => !spansCovered.has(s));
  return {
    hitRanks,
    firstHitRank,
    spansCovered: [...spansCovered],
    spansMissing,
  };
}

// -- aggregation ----------------------------------------------------------

function aggregate(results: PerQueryResult[]): AggregateMetrics {
  if (results.length === 0) {
    return {
      sourceHitRate: 0,
      averageLatencyMs: 0,
      averagePayloadBytes: 0,
      failedCases: 0,
      count: 0,
      answerSpanRecall: 0,
      hitAnyAt1: 0,
      hitAnyAt3: 0,
      hitAnyAt5: 0,
      hitAnyAt10: 0,
      mrr: 0,
      contextEfficiency: 0,
      fileRecallAt5: 0,
      fileRecallAt10: 0,
    };
  }
  const n = results.length;
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const spanResults = results.filter((r) => r.answerSpans.length);
  const spanMean = (values: number[]) => (values.length ? mean(values) : 0);
  const hitResults = results.filter((r) => r.firstHitRank !== null);
  return {
    sourceHitRate: mean(results.map((r) => r.sourceHit)),
    averageLatencyMs: mean(results.map((r) => r.latencyMs)),
    averagePayloadBytes: mean(results.map((r) => r.payloadBytes)),
    failedCases: results.filter((r) => r.failures.length).length,
    count: n,
    answerSpanRecall: spanMean(spanResults.map((r) => r.answerSpanRecall)),
    hitAnyAt1: results[0].hitAnyAt1 === null ? null : spanMean(spanResults.map((r) => r.hitAnyAt1!)),
    hitAnyAt3: results[0].hitAnyAt3 === null ? null : spanMean(spanResults.map((r) => r.hitAnyAt3!)),
    hitAnyAt5: results[0].hitAnyAt5 === null ? null : spanMean(spanResults.map((r) => r.hitAnyAt5!)),
    hitAnyAt10: results[0].hitAnyAt10 === null ? null : spanMean(spanResults.map((r) => r.hitAnyAt10!)),
    mrr: spanMean(spanResults.map((r) => r.reciprocalRank)),
    contextEfficiency: hitResults.length ? mean(hitResults.map((r) => r.contextEfficiency)) : 0,
    fileRecallAt5: results[0].fileRecallAt5 === null ? null : mean(results.map((r) => r.fileRecallAt5!)),
    fileRecallAt10: results[0].fileRecallAt10 === null ? null : mean(results.map((r) => r.fileRecallAt10!)),
  };
}

function fmt(n: number | null, dp: number = 3): string {
  return n === null ? 'N/A' : n.toFixed(dp);
}

function printAggregate(label: string, m: AggregateMetrics): void {
  const tag = `${label} (n=${m.count})`.padEnd(20);
  console.log(
    `Source hit rate=${fmt(m.sourceHitRate)}  failed=${m.failedCases}  avg latency=${fmt(m.averageLatencyMs, 1)}ms  avg payload=${fmt(m.averagePayloadBytes, 0)}B`,
  );
  console.log(
    `${tag}  spanRecall=${fmt(m.answerSpanRecall)}  hit@1=${fmt(m.hitAnyAt1)}  hit@3=${fmt(m.hitAnyAt3)}  hit@5=${fmt(m.hitAnyAt5)}  hit@10=${fmt(m.hitAnyAt10)}  MRR=${fmt(m.mrr)}  ctxEff=${fmt(m.contextEfficiency, 2)}  fileR@5=${fmt(m.fileRecallAt5)}`,
  );
}

function printPerQueryTable(results: PerQueryResult[]): void {
  const header = 'id   | diff   | fhr | spans  | hit@5 | unique | sources';
  const sep = '-'.repeat(110);
  console.log(sep);
  console.log(header);
  console.log(sep);
  for (const r of results) {
    const fhr = r.firstHitRank === null ? ' - ' : String(r.firstHitRank).padStart(3, ' ');
    const spans = `${r.spansCovered.length}/${r.answerSpans.length}`;
    const matched = r.retrievedSources[0] ? r.retrievedSources.slice(0, 2).join(', ') : '(empty)';
    console.log(
      `${r.id.padEnd(4)} | ${r.difficulty.padEnd(6)} | ${fhr} | ${spans.padEnd(6)} | ${fmt(r.hitAnyAt5, 0).padEnd(5)} | ${String(r.uniqueFiles).padEnd(6)} | ${matched}`,
    );
  }
  console.log(sep);
}

// -- main -----------------------------------------------------------------

async function runEval(): Promise<void> {
  const datasetPath = resolveDatasetPath();
  if (!Number.isSafeInteger(TOP_K) || TOP_K < 1) throw new Error('--top-k must be a positive integer');
  if (!/^[a-zA-Z0-9_-]+$/.test(LABEL))
    throw new Error('--label must contain only letters, digits, underscores or hyphens');
  const datasetBytes = fs.readFileSync(datasetPath);
  const dataset = evalDatasetSchema.parse(JSON.parse(datasetBytes.toString('utf-8')));
  // Use the built corpus beside the production retriever, not the source copy.
  // Read before retrieval; concurrent edits to input assets are not supported.
  const corpusBytes = fs.readFileSync(path.resolve(__dirname, '../uploads/documents.json'));
  const datasetSha256 = createHash('sha256').update(datasetBytes).digest('hex');
  const corpusSha256 = createHash('sha256').update(corpusBytes).digest('hex');

  console.log(`\n=== Appium retrieval eval (Level 2) ===`);
  console.log(`Dataset: ${datasetPath}`);
  console.log(`Queries: ${dataset.queries.length}   topK: ${TOP_K}   label: ${LABEL}\n`);

  const perQuery: PerQueryResult[] = [];

  for (const q of dataset.queries) {
    const start = performance.now();
    const docs = await queryVectorStore(q.query, TOP_K).catch((error: unknown) => {
      throw new Error(`Retrieval failed for ${q.id}: ${q.query}`, {cause: error});
    });
    const latencyMs = performance.now() - start;
    const payloadBytes = Buffer.byteLength(JSON.stringify(docs), 'utf8');
    const chunks: RetrievedChunk[] = docs.map((d, i) => ({
      rank: i + 1,
      text: d.pageContent,
      source:
        (d.metadata?.relativePath as string | undefined) ??
        (d.metadata?.filename as string | undefined) ??
        (d.metadata?.source as string | undefined),
      charCount: d.pageContent.length,
    }));

    const retrievedSources = chunks.map((c) => c.source).filter((s): s is string => !!s);

    const topKChars = chunks.reduce((a, c) => a + c.charCount, 0);
    const uniqueFiles = new Set(retrievedSources).size;

    const {hitRanks, firstHitRank, spansCovered, spansMissing} = evaluateQuery(q, chunks);

    const answerSpanRecall = q.answerSpans.length === 0 ? 0 : spansCovered.length / q.answerSpans.length;
    const hitAnyAt = (k: number): 0 | 1 => (hitRanks.some((r) => r <= k) ? 1 : 0);
    const reciprocalRank = firstHitRank ? 1 / firstHitRank : 0;
    const contextEfficiency = firstHitRank !== null && topKChars > 0 ? (1000 * spansCovered.length) / topKChars : 0;

    const fileMatched = (k: number): 0 | 1 => {
      return chunks.some(
        (c) => c.rank <= k && c.source && q.expectedSources.some((es) => endsWithExpected(c.source!, es)),
      )
        ? 1
        : 0;
    };

    const evidence = checkEvidence(q, chunks);
    perQuery.push({
      ...evidence,
      question: q.question,
      requiredFacts: q.requiredFacts,
      latencyMs,
      payloadBytes,
      id: q.id,
      query: q.query,
      difficulty: q.difficulty,
      category: q.category,
      expectedSources: q.expectedSources,
      answerSpans: q.answerSpans,
      retrievedSources,
      topKChunks: chunks.length,
      topKChars,
      uniqueFiles,
      hitRanks,
      firstHitRank,
      spansCovered,
      spansMissing,
      answerSpanRecall,
      hitAnyAt1: TOP_K >= 1 ? hitAnyAt(1) : null,
      hitAnyAt3: TOP_K >= 3 ? hitAnyAt(3) : null,
      hitAnyAt5: TOP_K >= 5 ? hitAnyAt(5) : null,
      hitAnyAt10: TOP_K >= 10 ? hitAnyAt(10) : null,
      reciprocalRank,
      contextEfficiency,
      fileRecallAt5: TOP_K >= 5 ? fileMatched(5) : null,
      fileRecallAt10: TOP_K >= 10 ? fileMatched(10) : null,
    });

    if (!QUIET) {
      const status = evidence.failures.length ? 'FAIL' : 'PASS';
      console.log(
        `${status.padEnd(4)} ${q.id}  spans=${spansCovered.length}/${q.answerSpans.length}  fhr=${firstHitRank ?? '-'} source=${evidence.sourceHit ? 'PASS' : 'FAIL'} sourceRank=${evidence.sourceFirstHitRank ?? '-'} facts=${q.requiredFacts.length ? (evidence.requiredFactsMissing.length ? 'FAIL' : 'PASS') : 'N/A'} latency=${fmt(latencyMs, 1)}ms chunks=${chunks.length} payload=${payloadBytes}B`,
      );
    }
  }

  if (!QUIET) {
    printPerQueryTable(perQuery);
  }

  for (const r of perQuery.filter((r) => r.failures.length)) {
    console.log(
      `FAIL ${r.id} (${r.question}):\n  ${r.failures.join('\n  ')}\n  Retrieved: ${r.retrievedSources.join(', ') || '(empty)'}`,
    );
  }
  const overall = aggregate(perQuery);
  const byDifficulty: Record<string, AggregateMetrics> = {};
  for (const d of ['easy', 'medium', 'vague'] as const) {
    byDifficulty[d] = aggregate(perQuery.filter((r) => r.difficulty === d));
  }

  console.log('');
  printAggregate('overall', overall);
  for (const d of ['easy', 'medium', 'vague'] as const) {
    printAggregate(d, byDifficulty[d]);
  }
  console.log('');
  if (flagSet.has('--strict') && overall.failedCases) process.exitCode = 1;

  if (!NO_SAVE) {
    const run: EvalRun = {
      timestamp: new Date().toISOString(),
      label: LABEL,
      datasetVersion: dataset.version,
      datasetSha256,
      corpusSha256,
      topK: TOP_K,
      embeddingModel: process.env.SENTENCE_TRANSFORMERS_MODEL || 'Xenova/bge-small-en-v1.5',
      overall,
      byDifficulty,
      perQuery,
    };
    const dir = resolveResultsDir();
    const stamp = run.timestamp.replace(/[:.]/g, '-');
    const outPath = path.join(dir, `${LABEL}-${stamp}.json`);
    const labelLatestPath = path.join(dir, `${LABEL}-latest.json`);
    const latestPath = path.join(dir, 'latest.json');
    fs.writeFileSync(outPath, JSON.stringify(run, null, 2));
    fs.writeFileSync(labelLatestPath, JSON.stringify(run, null, 2));
    fs.writeFileSync(latestPath, JSON.stringify(run, null, 2));
    console.log(`Saved: ${path.relative(process.cwd(), outPath)}`);
    console.log(`       ${path.relative(process.cwd(), labelLatestPath)}`);
    console.log(`       ${path.relative(process.cwd(), latestPath)}\n`);
  }
}

try {
  await runEval();
} catch (err) {
  console.error('Eval failed:', err);
  process.exitCode = 1;
}
