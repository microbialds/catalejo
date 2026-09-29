// Post-build check of packages/web/dist (requirements §9; web agent rules).
//
// 1. The DuckDB-WASM binaries and worker are bundled: dist holds a .wasm file
//    and a DuckDB worker script.
// 2. No built text file names a CDN or any external host other than Google
//    Fonts. Every other host that appears in the bundle is listed below with
//    the reason it is harmless (a string in a library, never requested).
//    Binary .wasm files are not scanned: the DuckDB engine carries URL
//    strings for its optional httpfs code path.
//
// Usage: node scripts/check-dist.mjs [distDir]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(process.argv[2] ?? path.join(here, '..', 'dist'));

/** Hosts a page may request (the Google Fonts stylesheet and font files). */
const REQUESTED_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);

/**
 * URLs that appear as text inside bundled libraries and are never requested,
 * each with the reason. Matched as prefixes of the URL found in the bundle.
 */
const TEXT_ONLY_URLS = new Map([
  ['http://www.w3.org/', 'XML, SVG and MathML namespace identifiers in React DOM'],
  ['https://react.dev/errors/', 'React production error messages name the error decoder page'],
  ['https://tailwindcss.com', 'Tailwind CSS license banner comment'],
  ['https://github.com/duckdb/duckdb-wasm.git', 'DuckDB-WASM package metadata (repository field)'],
  ['https://github.com/emn178/js-sha256', 'license comment of js-sha256 inside the DuckDB worker'],
]);

/** CDN names that must never appear, whatever the allow-lists say. */
const FORBIDDEN = [/cdn\.jsdelivr/i, /unpkg\.com/i, /cdnjs\./i, /esm\.sh/i, /skypack/i];

const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.css', '.html', '.json', '.map', '.svg']);

/**
 * @param {string} dir
 * @returns {string[]}
 */
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** @type {string[]} */
let files;
try {
  files = walk(dist);
} catch {
  console.error(`check-dist: ${dist} does not exist; run the build first`);
  process.exit(1);
}

/** @type {string[]} */
const problems = [];
/** @param {string} file */
const relative = (file) => path.relative(dist, file);

const wasm = files.filter((file) => file.endsWith('.wasm'));
if (wasm.length === 0) problems.push('no .wasm file in dist (DuckDB-WASM must be bundled)');
if (!files.some((file) => /duckdb.*worker.*\.js$/.test(path.basename(file)))) {
  problems.push('no DuckDB worker script in dist');
}

/** @type {Map<string, Set<string>>} */
const hosts = new Map();
for (const file of files) {
  if (!TEXT_EXTENSIONS.has(path.extname(file))) continue;
  const text = readFileSync(file, 'utf8');
  for (const pattern of FORBIDDEN) {
    if (pattern.test(text)) problems.push(`${relative(file)} names a CDN (${pattern.source})`);
  }
  for (const match of text.matchAll(/https?:\/\/[^\s"'`()<>\\]+/gi)) {
    const url = match[0];
    let host;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      host = url;
    }
    const where = hosts.get(host) ?? new Set();
    where.add(relative(file));
    hosts.set(host, where);
    if (REQUESTED_HOSTS.has(host)) continue;
    if ([...TEXT_ONLY_URLS.keys()].some((prefix) => url.startsWith(prefix))) continue;
    problems.push(`${relative(file)} names ${url}`);
  }
}

if (problems.length > 0) {
  console.error('check-dist: failed');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

const sizes = wasm.map(
  (file) => `${relative(file)} (${(statSync(file).size / 2 ** 20).toFixed(1)} MiB)`,
);
console.log(`check-dist: ok; ${String(files.length)} files; wasm: ${sizes.join(', ')}`);
console.log(
  `check-dist: hosts named in the bundle: ${[...hosts.keys()].sort().join(', ') || 'none'}`,
);
