import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import * as path from 'node:path';
import {test, type TestContext} from 'node:test';
import {fileURLToPath} from 'node:url';

/** Run the real compiled CLI in an isolated package with only retrieval stubbed.
 * These are Level 1 command tests, not evidence of production retrieval quality.
 * No production model code is copied or loaded, and reports stay in the temp dir.
 */
function fixture(t: TestContext) {
  const root = mkdtempSync(path.join(tmpdir(), 'appium-eval-cli-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const scripts = path.join(root, 'dist/scripts');
  mkdirSync(scripts, {recursive: true});
  mkdirSync(path.join(root, 'dist/uploads'));
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({type: 'module'}));
  copyFileSync(
    new URL('../scripts/eval-documentation-rag.js', import.meta.url),
    path.join(scripts, 'eval-documentation-rag.js'),
  );
  // Resolve the existing helper at its real location so it uses the installed Zod.
  symlinkSync(
    fileURLToPath(new URL('../scripts/rag-eval-checks.js', import.meta.url)),
    path.join(scripts, 'rag-eval-checks.js'),
  );
  writeFileSync(
    path.join(root, 'dist/simple-pdf-indexer.js'),
    `
    import {readFileSync} from 'node:fs';
    export async function queryVectorStore(query, topK) {
      if (query === 'throw') throw new Error('fixture retrieval error');
      return JSON.parse(readFileSync(new URL('./uploads/documents.json', import.meta.url), 'utf8')).slice(0, topK);
    }
  `,
  );
  const datasetPath = path.join(scripts, 'rag-eval-dataset.json');
  const corpusPath = path.join(root, 'dist/uploads/documents.json');
  const dataset = {
    version: 2,
    description: 'CLI fixture',
    matchMode: 'answerSpan',
    spanMatch: {normalize: 'lowercase+collapse-whitespace', anyOf: true},
    queries: [
      {
        id: 'fixture-case',
        question: 'Where is the fact?',
        query: 'fact',
        expectedSources: ['expected.md'],
        answerSpans: ['required fact'],
        requiredFacts: ['required fact'],
        difficulty: 'easy',
      },
    ],
  };
  writeFileSync(datasetPath, JSON.stringify(dataset));
  writeFileSync(
    corpusPath,
    JSON.stringify([
      {pageContent: 'no source metadata', metadata: {}},
      {pageContent: 'unrelated', metadata: {relativePath: 'other.md'}},
      {pageContent: 'required fact', metadata: {relativePath: 'docs/expected.md'}},
    ]),
  );
  const results = path.join(root, 'src/scripts/eval-results');
  const run = (...args: string[]) => {
    const result = spawnSync(process.execPath, [path.join(scripts, 'eval-documentation-rag.js'), ...args], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    return result;
  };
  const report = () => JSON.parse(readFileSync(path.join(results, 'latest.json'), 'utf8'));
  return {run, report, results, dataset, datasetPath, corpusPath};
}

void test('CLI saves reports and hashes actual inputs; smaller budgets leave unmeasured cutoffs null', (t) => {
  const f = fixture(t);
  const result = f.run('--strict', '--top-k=3', '--label=fixture');
  assert.equal(result.status, 0, result.stderr);
  const report = f.report();
  assert.equal(report.overall.failedCases, 0);
  assert.equal(report.perQuery[0].sourceFirstHitRank, 3);
  assert.equal(report.overall.hitAnyAt3, 1);
  assert.equal(report.overall.hitAnyAt5, null);
  assert.equal(report.overall.fileRecallAt5, null);
  assert.equal(report.perQuery[0].hitAnyAt10, null);
  assert.match(result.stdout, /hit@5=N\/A/);
  assert.deepEqual(JSON.parse(readFileSync(path.join(f.results, 'fixture-latest.json'), 'utf8')), report);
  assert.equal(readdirSync(f.results).length, 3);
  const hash = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
  assert.equal(report.datasetSha256, hash(f.datasetPath));
  assert.equal(report.corpusSha256, hash(f.corpusPath));
  assert.equal(f.run('--top-k=3').status, 0);
  assert.equal(f.report().datasetSha256, report.datasetSha256);
  assert.equal(f.report().corpusSha256, report.corpusSha256);
  // Even a same-version edit must be distinguishable. Hashes cover raw bytes.
  writeFileSync(f.datasetPath, readFileSync(f.datasetPath, 'utf8') + '\n');
  assert.equal(f.run('--top-k=3').status, 0);
  assert.notEqual(f.report().datasetSha256, report.datasetSha256);
  assert.equal(f.report().corpusSha256, report.corpusSha256);
  const editedDatasetHash = f.report().datasetSha256;
  writeFileSync(f.corpusPath, readFileSync(f.corpusPath, 'utf8') + '\n');
  assert.equal(f.run('--top-k=3').status, 0);
  assert.notEqual(f.report().corpusSha256, report.corpusSha256);
  assert.equal(f.report().datasetSha256, editedDatasetHash);
});

void test('CLI strict failures save diagnostics; report-only and no-save preserve their contracts', (t) => {
  const f = fixture(t);
  const strict = f.run('--strict', '--quiet', '--top-k=1');
  assert.equal(strict.status, 1);
  assert.match(strict.stdout, /FAIL fixture-case/);
  assert.match(strict.stdout, /Expected any source: expected.md/);
  assert.match(strict.stdout, /Missing required facts/);
  assert.equal(f.report().overall.failedCases, 1);
  const saved = readFileSync(path.join(f.results, 'latest.json'), 'utf8');
  const files = readdirSync(f.results);
  assert.equal(f.run('--quiet', '--top-k=1', '--no-save').status, 0);
  assert.equal(f.run('--strict', '--quiet', '--top-k=1', '--no-save').status, 1);
  assert.equal(readFileSync(path.join(f.results, 'latest.json'), 'utf8'), saved);
  assert.deepEqual(readdirSync(f.results), files);
});

void test('CLI rejects invalid arguments and names the case on retrieval errors without saving a report', (t) => {
  const f = fixture(t);
  assert.equal(f.run('--strict', '--top-k=3', '--no-save').status, 0);
  assert.ok(!existsSync(f.results));
  for (const arg of ['--top-k=0', '--top-k=1.5', '--top-k=NaN', '--label=../escape']) {
    const result = f.run(arg);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Eval failed:/);
  }
  f.dataset.queries[0].query = 'throw';
  writeFileSync(f.datasetPath, JSON.stringify(f.dataset));
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Retrieval failed for fixture-case/);
  assert.ok(!existsSync(f.results));
});

void test('CLI file hits keep original ranks when a result has no source metadata', (t) => {
  const f = fixture(t);
  const corpus = JSON.parse(readFileSync(f.corpusPath, 'utf8'));
  corpus.splice(2, 0, ...Array.from({length: 3}, () => ({pageContent: 'noise', metadata: {relativePath: 'noise.md'}})));
  writeFileSync(f.corpusPath, JSON.stringify(corpus));
  const result = f.run('--strict');
  assert.equal(result.status, 0, result.stderr);
  const report = f.report();
  assert.equal(report.perQuery[0].sourceFirstHitRank, 6);
  assert.equal(report.perQuery[0].fileRecallAt5, 0);
  assert.equal(report.perQuery[0].fileRecallAt10, 1);
  assert.equal(report.overall.fileRecallAt5, 0);
  assert.equal(report.overall.mrr, 1 / 6);
});
