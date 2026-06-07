import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fs } from '@appium/support';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let moduleRoot: string | undefined;

export function getModuleRoot(): string {
  moduleRoot ??= fs.findRoot(__dirname);
  return moduleRoot;
}

export function resolveAppiumResourcesPath(...segments: string[]): string {
  return path.join(getModuleRoot(), 'src', 'resources', ...segments);
}
