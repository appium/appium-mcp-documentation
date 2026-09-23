/** Deterministic dataset validation and source/fact checks; no retriever or model imports. */
import {z} from 'zod';

const text = z.string().trim().min(1);
export const evalDatasetSchema = z.object({
  version: z.literal(2),
  description: text,
  matchMode: z.literal('answerSpan'),
  spanMatch: z.object({normalize: z.literal('lowercase+collapse-whitespace'), anyOf: z.literal(true)}),
  queries: z
    .array(
      z.object({
        id: text,
        question: text,
        query: text,
        expectedSources: z.array(text).min(1),
        answerSpans: z.array(text).default([]),
        requiredFacts: z.array(text).default([]),
        difficulty: z.enum(['easy', 'medium', 'vague']),
        category: text.optional(),
      }),
    )
    .min(1)
    .refine((queries) => new Set(queries.map((q) => q.id)).size === queries.length, 'Duplicate case IDs'),
});

export type EvalQuery = z.infer<typeof evalDatasetSchema>['queries'][number];
export interface RetrievedChunk {
  rank: number;
  text: string;
  source: string | undefined;
  charCount: number;
}

export function chunkContainsSpan(chunkText: string, span: string): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  return normalize(chunkText).includes(normalize(span));
}

export function endsWithExpected(source: string, expected: string): boolean {
  const actual = source.replace(/\\/g, '/');
  const suffix = expected.replace(/\\/g, '/');
  return actual === suffix || actual.endsWith(`/${suffix}`);
}

export function checkEvidence(q: EvalQuery, chunks: RetrievedChunk[]) {
  const sourceChunks = chunks.filter((c) => c.source && q.expectedSources.some((s) => endsWithExpected(c.source!, s)));
  const sourceFirstHitRank = sourceChunks[0]?.rank ?? null;
  // Expected sources are acceptable alternatives, not a list of mandatory files.
  const matchedSources = q.expectedSources.filter((s) => sourceChunks.some((c) => endsWithExpected(c.source!, s)));
  const requiredFactsMissing = q.requiredFacts.filter(
    (fact) => !sourceChunks.some((c) => chunkContainsSpan(c.text, fact)),
  );
  const failures: string[] = [];
  if (!sourceChunks.length) failures.push(`Expected any source: ${q.expectedSources.join(', ')}`);
  if (q.answerSpans.length && !chunks.some((c) => q.answerSpans.some((s) => chunkContainsSpan(c.text, s)))) {
    failures.push(`No evidence span found: ${q.answerSpans.join(' | ')}`);
  }
  if (requiredFactsMissing.length)
    failures.push(`Missing required facts in expected sources: ${requiredFactsMissing.join(' | ')}`);
  return {
    sourceFirstHitRank,
    sourceHit: sourceFirstHitRank === null ? 0 : 1,
    matchedSources,
    requiredFactsMissing,
    requiredFactsPresent: q.requiredFacts.length ? q.requiredFacts.length - requiredFactsMissing.length : null,
    failures,
  };
}
