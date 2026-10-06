// Uploads the DuckDB-WASM engine and its extension repository to the R2
// bucket that functions/assets/[[path]].ts serves at /assets/ (requirements
// §9, no request leaves the origin; §10, the engine files exceed the Pages
// per-file limit and are served from the bucket).
//
// The engine files are the ones the application requests, the main modules
// and workers of the bundles in src/data/engineAssets.ts engineBundles, taken
// from node_modules/@duckdb/duckdb-wasm/dist and uploaded to
// <remote>:<bucket>/assets/duckdb-wasm/<package version>/<file>. The extension
// repository is the one scripts/fetch-duckdb-extensions.mjs fills
// (.cache/duckdb-extensions), uploaded to
// <remote>:<bucket>/assets/duckdb-extensions/ with its layout,
// v<engine>/<platform>/<name>.duckdb_extension.wasm, for every platform and
// name pinned in config/versions.yaml.
//
// Every file is checked before the first upload; a missing extension means
// `pnpm run extensions` has not run. The uploads use rclone (no npm
// dependency), one `rclone copyto --checksum` per file, so a file already in
// the bucket with the same checksum is not sent again. --dry-run prints the
// commands without running them and does not need rclone.
//
// Usage: node scripts/upload-assets.mjs [--remote r2] [--bucket catalejo-releases] [--dry-run]
// The remote and bucket can also come from CATALEJO_R2_REMOTE and
// CATALEJO_R2_BUCKET; the options win.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { parseArgs } from 'node:util';
import { parse } from 'yaml';
import { DUCKDB_WASM_FILES, duckdbWasmDist, duckdbWasmVersion } from '../vite/duckdbAssets.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const repoRoot = path.resolve(webRoot, '..', '..');

export const DEFAULT_REMOTE = 'r2';
export const DEFAULT_BUCKET = 'catalejo-releases';

/**
 * @typedef {object} Upload
 * @property {string} source - the local file
 * @property {string} target - the destination, remote:bucket/key
 */

/**
 * @typedef {object} PlanInput
 * @property {string} remote - the rclone remote
 * @property {string} bucket - the R2 bucket
 * @property {string} version - the version of the DuckDB-WASM package
 * @property {string} distDir - the dist directory of the DuckDB-WASM package
 * @property {ReadonlyArray<string>} engineFiles - file names in distDir
 * @property {string} extensionsDir - the local extension repository
 * @property {ReadonlyArray<string>} extensionFiles - paths relative to extensionsDir
 */

/**
 * The uploads, in order: the engine files, then the extensions.
 * @param {PlanInput} input
 * @returns {Upload[]}
 */
export function planUploads(input) {
  const base = `${input.remote}:${input.bucket}/assets`;
  return [
    ...input.engineFiles.map((name) => ({
      source: path.join(input.distDir, name),
      target: `${base}/duckdb-wasm/${input.version}/${name}`,
    })),
    ...input.extensionFiles.map((relative) => ({
      source: path.join(input.extensionsDir, ...relative.split('/')),
      target: `${base}/duckdb-extensions/${relative}`,
    })),
  ];
}

/**
 * The rclone command of an upload.
 * @param {Upload} upload
 * @returns {string[]}
 */
export function rcloneCommand(upload) {
  return ['rclone', 'copyto', '--checksum', upload.source, upload.target];
}

/**
 * A command as a line a shell would read back.
 * @param {readonly string[]} argv
 */
export function shellLine(argv) {
  return argv
    .map((arg) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`))
    .join(' ');
}

/**
 * The sources that are not regular files.
 * @param {readonly Upload[]} uploads
 */
export function missingSources(uploads) {
  return uploads
    .filter(({ source }) => !existsSync(source) || !statSync(source).isFile())
    .map(({ source }) => source);
}

/**
 * The engine file names the application requests: the main module and the
 * worker of each bundle in engineBundles. engineAssets.ts reads the version
 * from a build-time global, which is set here before it is imported.
 * @param {string} version
 * @returns {Promise<string[]>}
 */
export async function requestedEngineFiles(version) {
  Reflect.set(globalThis, '__DUCKDB_WASM_VERSION__', version);
  const { engineBundles } = await import('../src/data/engineAssets.ts');
  const origin = 'http://localhost';
  const names = new Set();
  for (const bundle of Object.values(engineBundles(origin))) {
    for (const url of [bundle.mainModule, bundle.mainWorker]) {
      if (typeof url === 'string') names.add(path.posix.basename(new URL(url).pathname));
    }
  }
  return [...names];
}

/**
 * The extension files pinned in config/versions.yaml, relative to the
 * repository root, v<engine>/<platform>/<name>.duckdb_extension.wasm.
 * @returns {string[]}
 */
export function pinnedExtensionFiles() {
  const versions =
    /** @type {{ duckdb_extensions?: { engine: string; platforms: string[]; names: string[] } }} */ (
      parse(readFileSync(path.join(repoRoot, 'config', 'versions.yaml'), 'utf8'))
    );
  const pins = versions.duckdb_extensions;
  if (pins === undefined) throw new Error('config/versions.yaml has no duckdb_extensions section');
  return pins.platforms.flatMap((platform) =>
    pins.names.map((name) => `${pins.engine}/${platform}/${name}.duckdb_extension.wasm`),
  );
}

/** @param {string} message */
function fail(message) {
  console.error(`upload-assets: ${message}`);
  process.exit(1);
}

async function main() {
  // pnpm passes a literal "--" before the script's own options.
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  const { values } = parseArgs({
    args,
    options: {
      remote: { type: 'string' },
      bucket: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
  });
  const remote = values.remote ?? (process.env.CATALEJO_R2_REMOTE || DEFAULT_REMOTE);
  const bucket = values.bucket ?? (process.env.CATALEJO_R2_BUCKET || DEFAULT_BUCKET);
  const dryRun = values['dry-run'];
  if (!/^[\w.-]+$/.test(remote))
    fail(`the remote ${JSON.stringify(remote)} is not an rclone remote name`);
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(bucket))
    fail(`the bucket ${JSON.stringify(bucket)} is not a bucket name`);

  const version = duckdbWasmVersion(webRoot);
  const engineFiles = await requestedEngineFiles(version);
  const unknown = engineFiles.filter((name) => !DUCKDB_WASM_FILES.includes(name));
  if (unknown.length > 0) {
    fail(`engineBundles names files the asset servers do not allow: ${unknown.join(', ')}`);
  }
  const uploads = planUploads({
    remote,
    bucket,
    version,
    distDir: duckdbWasmDist(webRoot),
    engineFiles,
    extensionsDir: path.join(webRoot, '.cache', 'duckdb-extensions'),
    extensionFiles: pinnedExtensionFiles(),
  });

  const missing = missingSources(uploads);
  if (missing.length > 0) {
    console.error('upload-assets: these files are missing:');
    for (const file of missing) console.error(`  ${path.relative(process.cwd(), file) || file}`);
    fail(
      'run `pnpm --dir packages/web install` for the engine and `pnpm --dir packages/web run extensions` for the extensions, then try again',
    );
  }

  const commands = uploads.map(rcloneCommand);
  if (dryRun) {
    for (const command of commands) console.log(shellLine(command));
    console.log(`upload-assets: dry run, ${String(commands.length)} files, nothing uploaded`);
    return;
  }

  const probe = spawnSync('rclone', ['version'], { stdio: 'ignore' });
  if (probe.error !== undefined) {
    fail(
      'rclone is not installed or not on PATH (https://rclone.org/install/); --dry-run prints the commands without it',
    );
  }
  for (const command of commands) {
    console.log(shellLine(command));
    const [program = 'rclone', ...rest] = command;
    const run = spawnSync(program, rest, { stdio: 'inherit' });
    if (run.error !== undefined || run.status !== 0) {
      fail(`rclone failed (exit ${String(run.status)}) for ${command.at(-1) ?? ''}`);
    }
  }
  console.log(`upload-assets: ${String(commands.length)} files in ${remote}:${bucket}/assets/`);
}

const invoked = process.argv[1] === undefined ? undefined : realpathSync(process.argv[1]);
if (invoked === fileURLToPath(import.meta.url)) await main();
