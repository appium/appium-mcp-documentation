import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function resolveAppiumResourcesPath(...segments: string[]): string {
  return path.join(findResourceRoot(), ...segments);
}

function findResourceRoot(): string {
  if (process.env.APPIUM_MCP_RESOURCES_PATH) {
    return process.env.APPIUM_MCP_RESOURCES_PATH;
  }

  const candidates = [
    path.resolve(process.cwd(), 'src/resources'),
    path.resolve(process.cwd(), 'dist/resources'),
    path.resolve(__dirname, 'resources'),
    path.resolve(__dirname, '../resources'),
  ];

  const existing = candidates.find((candidate) => fs.existsSync(candidate));
  return existing ?? candidates[0];
}
