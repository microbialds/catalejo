// Development and preview server for the DuckDB-WASM engine and extensions
// under /assets/ (requirements §9 and §10).
//
// The application loads the engine from /assets/duckdb-wasm/<version>/ and
// the extensions from /assets/duckdb-extensions/ on its own origin. In
// production a Pages Function (functions/assets/[[path]].ts) serves both from
// the R2 bucket. Locally this plugin is the fallback. It serves the four
// allowed engine files from node_modules/@duckdb/duckdb-wasm/dist for the
// installed version only, and the extension repository from
// .cache/duckdb-extensions, which scripts/fetch-duckdb-extensions.mjs fills.
import { createReadStream, promises as fs, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Plugin } from 'vite';

export const DUCKDB_WASM_PREFIX = '/assets/duckdb-wasm/';
export const DUCKDB_EXTENSIONS_PREFIX = '/assets/duckdb-extensions/';

/** The engine files the application may request, and nothing else. */
export const DUCKDB_WASM_FILES: readonly string[] = [
  'duckdb-mvp.wasm',
  'duckdb-eh.wasm',
  'duckdb-browser-mvp.worker.js',
  'duckdb-browser-eh.worker.js',
];

/** The dist directory of the installed @duckdb/duckdb-wasm, resolved from webRoot. */
export function duckdbWasmDist(webRoot: string): string {
  const require = createRequire(path.join(webRoot, 'package.json'));
  return path.dirname(require.resolve('@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm'));
}

/**
 * The installed @duckdb/duckdb-wasm version. The package does not export its
 * package.json, so the file is read next to the resolved dist directory.
 */
export function duckdbWasmVersion(webRoot: string): string {
  const file = path.join(path.dirname(duckdbWasmDist(webRoot)), 'package.json');
  const { version } = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown };
  if (typeof version !== 'string') throw new Error(`${file} has no version`);
  return version;
}

/** The local extension repository used in development and tests. */
export function extensionCacheDir(webRoot: string): string {
  return path.join(webRoot, '.cache', 'duckdb-extensions');
}

export function engineContentType(file: string): string {
  switch (path.extname(file).toLowerCase()) {
    case '.wasm':
      return 'application/wasm';
    case '.js':
      return 'text/javascript';
    default:
      return 'application/octet-stream';
  }
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function finish(res: ServerResponse, status: number, headers: Record<string, string> = {}): void {
  res.statusCode = status;
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.setHeader('Content-Length', '0');
  res.end();
}

type Next = (error?: unknown) => void;

export interface DuckdbAssetsOptions {
  /** node_modules/@duckdb/duckdb-wasm/dist */
  distDir: string;
  /** The installed package version; other versions answer 404. */
  version: string;
  /** The extension repository root, .cache/duckdb-extensions. */
  extensionsDir: string;
}

/**
 * A Connect middleware that answers every request under /assets/duckdb-wasm/
 * and /assets/duckdb-extensions/ and passes everything else to `next`.
 */
export function createDuckdbAssetsHandler(options: DuckdbAssetsOptions) {
  return function duckdbAssetsHandler(req: IncomingMessage, res: ServerResponse, next: Next): void {
    const pathname = (req.url ?? '').split(/[?#]/, 1)[0] ?? '';
    let target: Promise<string | number>;
    if (pathname.startsWith(DUCKDB_WASM_PREFIX)) {
      target = engineFile(options, pathname.slice(DUCKDB_WASM_PREFIX.length));
    } else if (pathname.startsWith(DUCKDB_EXTENSIONS_PREFIX)) {
      target = extensionFile(options, pathname.slice(DUCKDB_EXTENSIONS_PREFIX.length));
    } else {
      next();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      finish(res, 405, { Allow: 'GET, HEAD' });
      return;
    }
    target
      .then(async (found) => {
        if (typeof found === 'number') finish(res, found);
        else await send(found, req, res);
      })
      .catch((error: unknown) => {
        next(error);
      });
  };
}

function decode(encoded: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    return undefined;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return undefined;
  const segments = decoded.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return undefined;
  }
  return decoded;
}

/** <version>/<file> from the allow-list, or a status code. */
async function engineFile(options: DuckdbAssetsOptions, encoded: string): Promise<string | number> {
  const relative = decode(encoded);
  if (relative === undefined) return 400;
  const [version, name, ...rest] = relative.split('/');
  if (version !== options.version || name === undefined || rest.length > 0) return 404;
  if (!DUCKDB_WASM_FILES.includes(name)) return 404;
  const file = path.join(options.distDir, name);
  return (await isFile(file)) ? file : 404;
}

/** A file inside the extension repository, or a status code. */
async function extensionFile(
  options: DuckdbAssetsOptions,
  encoded: string,
): Promise<string | number> {
  const relative = decode(encoded);
  if (relative === undefined) return 400;
  let root: string;
  try {
    root = await fs.realpath(options.extensionsDir);
  } catch {
    return 404;
  }
  const requested = path.resolve(root, relative);
  if (!isInside(root, requested)) return 403;
  let file: string;
  try {
    file = await fs.realpath(requested);
  } catch {
    return 404;
  }
  if (!isInside(root, file)) return 403;
  return (await isFile(file)) ? file : 404;
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}

async function send(file: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { size } = await fs.stat(file);
  res.statusCode = 200;
  res.setHeader('Content-Type', engineContentType(file));
  res.setHeader('Content-Length', String(size));
  res.setHeader('Cache-Control', 'no-cache');
  if (req.method === 'HEAD' || size === 0) {
    res.end();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on('error', reject);
    stream.on('end', resolve);
    stream.pipe(res);
  });
}

/** The Vite plugin: the same handler for `vite` and `vite preview`. */
export function duckdbAssets(webRoot: string): Plugin {
  const distDir = duckdbWasmDist(webRoot);
  const handler = createDuckdbAssetsHandler({
    distDir,
    version: duckdbWasmVersion(webRoot),
    extensionsDir: extensionCacheDir(webRoot),
  });
  return {
    name: 'catalejo-duckdb-assets',
    configureServer(server) {
      // Registered directly, not in a returned post hook, so it runs before
      // Vite's own middlewares and the SPA fallback.
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
