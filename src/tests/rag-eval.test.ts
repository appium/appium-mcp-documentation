import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

import {
  checkEvidence,
  chunkContainsSpan,
  endsWithExpected,
  evalDatasetSchema,
  type RetrievedChunk,
} from '../scripts/rag-eval-checks.js';

const dataset = JSON.parse(readFileSync(new URL('../scripts/rag-eval-dataset.json', import.meta.url), 'utf8'));
const q = evalDatasetSchema.parse(dataset).queries[0];
const chunk = (rank: number, text: string, source?: string): RetrievedChunk => ({
  rank,
  text,
  source,
  charCount: text.length,
});

void test('golden schema validates, defaults optional facts/spans, rejects blank queries and duplicate IDs', () => {
  assert.equal(q.question, 'How do I install Appium?');
  const sourceOnly = {...q, requiredFacts: undefined, answerSpans: undefined};
  assert.deepEqual(evalDatasetSchema.parse({...dataset, queries: [sourceOnly]}).queries[0].requiredFacts, []);
  assert.throws(() => evalDatasetSchema.parse({...dataset, queries: [q, q]}), /Duplicate case IDs/);
  assert.throws(() => evalDatasetSchema.parse({...dataset, queries: [{...q, query: ' '}]}));
  assert.throws(() => evalDatasetSchema.parse({...dataset, queries: [{...q, expectedSources: []}]}));
});

void test('source suffixes respect path boundaries and separators', () => {
  assert.ok(endsWithExpected('docs/en/quickstart/install.md', 'en/quickstart/install.md'));
  assert.ok(endsWithExpected('docs\\en\\quickstart\\install.md', 'en/quickstart/install.md'));
  assert.ok(!endsWithExpected('not-install.md', 'install.md'));
});

void test('missing metadata does not promote source rank; expected sources are alternatives', () => {
  const result = checkEvidence({...q, expectedSources: [...q.expectedSources, 'alternative.md']}, [
    chunk(1, 'unrelated'),
    chunk(2, 'npm install -g appium', 'docs/en/quickstart/install.md'),
  ]);
  assert.equal(result.sourceFirstHitRank, 2);
  assert.deepEqual(result.failures, []);
});

void test('facts must all occur in expected sources, not across chunks or unrelated files', () => {
  assert.ok(chunkContainsSpan('NPM\n install -g Appium', 'npm install -g appium'));
  const result = checkEvidence(q, [
    chunk(1, 'npm install -g appium', 'unrelated.md'),
    chunk(2, 'npm install', q.expectedSources[0]),
    chunk(3, '-g appium', q.expectedSources[0]),
  ]);
  assert.equal(result.sourceHit, 1);
  assert.deepEqual(result.requiredFactsMissing, ['npm install -g appium']);
  assert.match(result.failures.join(), /Missing required facts/);
  const allFacts = checkEvidence({...q, requiredFacts: ['npm install -g appium', 'missing fact']}, [
    chunk(1, 'npm install -g appium', q.expectedSources[0]),
  ]);
  assert.equal(allFacts.requiredFactsPresent, 1);
  assert.deepEqual(allFacts.requiredFactsMissing, ['missing fact']);
});

void test('empty retrieval exposes source and evidence failures; source-only cases are supported', () => {
  const empty = checkEvidence(q, []);
  assert.equal(empty.sourceHit, 0);
  assert.equal(empty.sourceFirstHitRank, null);
  assert.match(empty.failures.join(), /Expected any source/);
  assert.match(empty.failures.join(), /No evidence span/);
  const sourceOnly = checkEvidence({...q, answerSpans: [], requiredFacts: []}, [chunk(1, '', q.expectedSources[0])]);
  assert.deepEqual(sourceOnly.failures, []);
  assert.equal(sourceOnly.requiredFactsPresent, null);
});

void test('golden expectations exist in the checked-in corpus', () => {
  const corpus = JSON.parse(readFileSync(new URL('../uploads/documents.json', import.meta.url), 'utf8')) as {
    pageContent: string;
    metadata: {relativePath: string};
  }[];
  for (const query of evalDatasetSchema.parse(dataset).queries) {
    const relevant = corpus.filter((d) =>
      query.expectedSources.some((s) => endsWithExpected(d.metadata.relativePath, s)),
    );
    for (const source of query.expectedSources) {
      assert.ok(
        relevant.some((d) => endsWithExpected(d.metadata.relativePath, source)),
        `${query.id}: stale source ${source}`,
      );
    }
    for (const fact of query.requiredFacts) {
      assert.ok(
        relevant.some((d) => chunkContainsSpan(d.pageContent, fact)),
        `${query.id}: stale fact ${fact}`,
      );
    }
    if (query.answerSpans.length) {
      assert.ok(
        relevant.some((d) => query.answerSpans.some((span) => chunkContainsSpan(d.pageContent, span))),
        `${query.id}: no evidence marker in expected sources`,
      );
    }
  }
});
