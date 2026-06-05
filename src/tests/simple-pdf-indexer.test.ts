import { describe, expect, test, afterEach } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getMarkdownFilesInDirectory } from '../simple-pdf-indexer.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appium-mcp-docs-'));
  tempDirs.push(dir);
  return dir;
}

describe('getMarkdownFilesInDirectory', () => {
  test('returns markdown files and excludes appium-skills content', async () => {
    const root = makeTempDir();
    const docsDir = path.join(root, 'docs');
    const skillsDir = path.join(root, 'appium-skills');
    const nestedSkillsDir = path.join(skillsDir, 'skills', 'android');

    fs.mkdirSync(docsDir, { recursive: true });
    fs.mkdirSync(nestedSkillsDir, { recursive: true });
    fs.writeFileSync(path.join(root, 'README.md'), '# Root');
    fs.writeFileSync(path.join(docsDir, 'guide.md'), '# Guide');
    fs.writeFileSync(path.join(docsDir, 'ignore.txt'), 'ignore');
    fs.writeFileSync(path.join(nestedSkillsDir, 'SKILL.md'), '# Skill');

    const markdownFiles = await getMarkdownFilesInDirectory(root);
    const relativeFiles = markdownFiles.map((file) =>
      path.relative(root, file)
    );

    expect(relativeFiles.sort()).toEqual(['README.md', 'docs/guide.md']);
  });
});
