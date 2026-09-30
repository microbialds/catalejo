// Fills the local DuckDB extension repository (requirements §9, no request
// leaves the origin; config/versions.yaml, duckdb_extensions).
//
// For each platform and extension name in config/versions.yaml, the script
// makes sure <out>/<engine>/<platform>/<name>.duckdb_extension.wasm exists
// with the pinned sha256. A missing file, or one with another hash, is
// downloaded from <source>/<engine>/<platform>/<name>.duckdb_extension.wasm.
// Node's fetch decodes the Brotli transfer encoding, and the pinned hashes are
// of the decoded bytes. A download whose hash differs from the pin fails the
// script and is not written. When every file is present and valid the script
// makes no request.
//
// The default output is packages/web/.cache/duckdb-extensions, which the
// development server and the tests serve as /assets/duckdb-extensions/.
// deploy.yml uses --out to stage the same layout for the bucket upload.
//
// Usage: node scripts/fetch-duckdb-extensions.mjs [--out <dir>]
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parse } from 'yaml';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const repoRoot = path.resolve(webRoot, '..', '..');

const { values } = parseArgs({ options: { out: { type: 'string' } } });
const out = path.resolve(
  process.env.INIT_CWD ?? process.cwd(),
  values.out ?? path.join(webRoot, '.cache', 'duckdb-extensions'),
);

/**
 * @typedef {object} ExtensionPins
 * @property {string} source
 * @property {string} engine
 * @property {string[]} platforms
 * @property {string[]} names
 * @property {Record<string, string>} sha256
 */

const versions = /** @type {{ duckdb_extensions?: ExtensionPins }} */ (
  parse(readFileSync(path.join(repoRoot, 'config', 'versions.yaml'), 'utf8'))
);
const pins = versions.duckdb_extensions;
if (pins === undefined) {
  console.error('fetch-duckdb-extensions: config/versions.yaml has no duckdb_extensions section');
  process.exit(1);
}

/** @param {Uint8Array} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** @param {string} file */
function hashOf(file) {
  try {
    return sha256(readFileSync(file));
  } catch {
    return undefined;
  }
}

let fetched = 0;
let present = 0;
/** @type {string[]} */
const problems = [];

for (const platform of pins.platforms) {
  for (const name of pins.names) {
    const key = `${platform}/${name}`;
    const expected = pins.sha256[key];
    if (expected === undefined) {
      problems.push(`no sha256 pinned for ${key}`);
      continue;
    }
    const relative = `${pins.engine}/${platform}/${name}.duckdb_extension.wasm`;
    const target = path.join(out, relative);
    if (hashOf(target) === expected) {
      present += 1;
      continue;
    }
    const url = `${pins.source.replace(/\/+$/, '')}/${relative}`;
    console.log(`fetch-duckdb-extensions: downloading ${url}`);
    const response = await globalThis.fetch(url);
    if (!response.ok) {
      problems.push(`${url} answered ${String(response.status)}`);
      continue;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const actual = sha256(bytes);
    if (actual !== expected) {
      problems.push(`${url} has sha256 ${actual}, but config/versions.yaml pins ${expected}`);
      continue;
    }
    mkdirSync(path.dirname(target), { recursive: true });
    const partial = `${target}.partial`;
    writeFileSync(partial, bytes);
    renameSync(partial, target);
    fetched += 1;
  }
}

if (problems.length > 0) {
  console.error('fetch-duckdb-extensions: failed');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
const shown = path.relative(process.cwd(), out);
const where = shown === '' ? '.' : shown.startsWith('..') ? out : shown;
console.log(
  `fetch-duckdb-extensions: ${String(present + fetched)} files in ${where} (${String(fetched)} downloaded)`,
);
