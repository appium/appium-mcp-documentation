import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, test} from 'node:test';

import {splitMarkdownByHeaders} from '../markdown-header-splitter.js';
import {getMarkdownFilesInDirectory} from '../simple-pdf-indexer.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, {recursive: true, force: true});
    }
  }
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appium-mcp-docs-'));
  tempDirs.push(dir);
  return dir;
}

void describe('getMarkdownFilesInDirectory', () => {
  void test('returns markdown files and excludes appium-skills content', async () => {
    const root = makeTempDir();
    const docsDir = path.join(root, 'docs');
    const skillsDir = path.join(root, 'appium-skills');
    const nestedSkillsDir = path.join(skillsDir, 'skills', 'android');

    fs.mkdirSync(docsDir, {recursive: true});
    fs.mkdirSync(nestedSkillsDir, {recursive: true});
    fs.writeFileSync(path.join(root, 'README.md'), '# Root');
    fs.writeFileSync(path.join(docsDir, 'guide.md'), '# Guide');
    fs.writeFileSync(path.join(docsDir, 'ignore.txt'), 'ignore');
    fs.writeFileSync(path.join(nestedSkillsDir, 'SKILL.md'), '# Skill');

    const markdownFiles = await getMarkdownFilesInDirectory(root);
    const relativeFiles = markdownFiles.map((file) => path.relative(root, file));

    assert.deepEqual(relativeFiles.sort(), ['README.md', 'docs/guide.md']);
  });
});

void describe('splitMarkdownByHeaders', () => {
  void test('reserves breadcrumb length when recursive-splitting oversized sections and handles nested fences', async () => {
    const markdown = [
      '# Page Title',
      '',
      '## Code Example',
      '',
      '````markdown',
      '```bash',
      '# Not a heading inside nested fence',
      '```',
      '````',
      '',
      '## Large Section',
      '',
      'Paragraph one with enough words to force a recursive split.',
      '',
      'Paragraph two with enough words to force a recursive split.',
      '',
      'Paragraph three with enough words to force a recursive split.',
    ].join('\r\n');

    const chunks = await splitMarkdownByHeaders(markdown, {
      chunkSize: 120,
      chunkOverlap: 10,
    });

    assert.equal(chunks[0]?.metadata.sectionCount, 2);
    assert.match(
      chunks[0]?.pageContent ?? '',
      /# Page Title > ## Code Example[\s\S]*# Not a heading inside nested fence/,
    );
    for (const chunk of chunks) {
      assert.ok(chunk.pageContent.length <= 120, `Expected chunk length <= 120, got ${chunk.pageContent.length}`);
    }
  });
});
