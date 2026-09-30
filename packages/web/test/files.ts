// Helpers for the source guards: package paths and source listing.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const repoRoot = path.resolve(webRoot, '..', '..');
export const srcDir = path.join(webRoot, 'src');

const TEST_FILE = /\.(test|spec)\.tsx?$/;

/** Source files under src/ with the given extensions, excluding tests and
 * src/generated/. Paths are absolute. */
export function sourceFiles(extensions: readonly string[]): string[] {
  return readdirSync(srcDir, { recursive: true, encoding: 'utf8' })
    .filter((relative) => extensions.some((ext) => relative.endsWith(ext)))
    .filter((relative) => !TEST_FILE.test(relative))
    .filter((relative) => !relative.split(path.sep).includes('generated'))
    .map((relative) => path.join(srcDir, relative))
    .sort();
}
