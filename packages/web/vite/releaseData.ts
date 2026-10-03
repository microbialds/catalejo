// Development and preview server for release files under /data/.
//
// The application reads the manifest at /data/manifest.json and every other
// release file at /data/r/<release_id>/<path> (data contract §6,
// requirements §10). In production a Pages Function forwards range requests
// to R2 for the release named in the pointer; locally this plugin serves one
// release directory with the same paths and the same behavior DuckDB-WASM
// relies on: HEAD, byte ranges (206 with Content-Range, 416 when
// unsatisfiable), Content-Length and Accept-Ranges. The current release is the
// release_id of the directory's manifest.json, read again whenever the file
// changes. As in production, the manifest is sent with Cache-Control:
// no-cache, a file of the current release as immutable, a path naming another
// release answers 404 with X-Catalejo-Release: stale, and any other /data/
// path answers 404.
//
// Because the scoped files are immutable, a browser keeps them under the same
// URL; after regenerating the release under the same release_id, reload
// without the cache. The directory is CATALEJO_RELEASE_DIR, or releases/synth
// at the repository root. A missing directory answers 404 and never stops the
// server.
import { createReadStream, promises as fs } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Plugin } from 'vite';

export const DATA_PREFIX = '/data/';

/** The first segment of the release-scoped paths, /data/r/<release_id>/<path>. */
export const RELEASE_SCOPE = 'r';

export const NO_CACHE = 'no-cache';
export const IMMUTABLE = 'public, max-age=31536000, immutable';
export const STALE_HEADER = 'X-Catalejo-Release';
export const STALE_VALUE = 'stale';

/** The identifier pattern of data contract §3.1, as in the Function. */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const CONTENT_TYPES: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.parquet': 'application/vnd.apache.parquet',
  '.gz': 'application/gzip',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

export function contentTypeFor(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * The release directory. CATALEJO_RELEASE_DIR wins; a relative value is taken
 * from the directory pnpm was invoked in (INIT_CWD), so that
 * `CATALEJO_RELEASE_DIR=releases/x pnpm --dir packages/web dev` run from the
 * repository root means <root>/releases/x.
 */
export function resolveReleaseDir(repoRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CATALEJO_RELEASE_DIR;
  if (override) return path.resolve(env.INIT_CWD ?? process.cwd(), override);
  return path.join(repoRoot, 'releases', 'synth');
}

export type ByteRange = { start: number; end: number } | 'unsatisfiable' | 'ignore';

/**
 * Parses a Range header against a file size (RFC 9110 §14). Returns the
 * inclusive byte range, "unsatisfiable" for a malformed or out-of-bounds bytes
 * range, or "ignore" when the header is absent, uses another unit, or asks for
 * several ranges (the full file is then sent with 200, which RFC 9110 allows).
 */
export function parseRange(header: string | undefined, size: number): ByteRange {
  if (header === undefined) return 'ignore';
  const trimmed = header.trim();
  if (!/^bytes\s*=/i.test(trimmed)) return 'ignore';
  const spec = trimmed.slice(trimmed.indexOf('=') + 1).trim();
  if (spec.includes(',')) return 'ignore';
  const match = /^(\d*)\s*-\s*(\d*)$/.exec(spec);
  if (!match) return 'unsatisfiable';
  const [, first = '', last = ''] = match;
  if (first === '' && last === '') return 'unsatisfiable';
  if (first === '') {
    const suffix = Number(last);
    if (suffix === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(first);
  if (start >= size) return 'unsatisfiable';
  const end = last === '' ? size - 1 : Math.min(Number(last), size - 1);
  if (end < start) return 'unsatisfiable';
  return { start, end };
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

interface CachedId {
  mtimeMs: number;
  size: number;
  releaseId: string | undefined;
}

/**
 * The release_id of the manifest in `root`, read again when the file's
 * modification time or size changes; undefined when it is missing or
 * unreadable.
 */
function currentReleaseReader() {
  let cached: (CachedId & { file: string }) | undefined;
  return async (root: string): Promise<string | undefined> => {
    const file = path.join(root, 'manifest.json');
    let stat;
    try {
      stat = await fs.stat(file);
    } catch {
      cached = undefined;
      return undefined;
    }
    if (cached?.file === file && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached.releaseId;
    }
    let releaseId: string | undefined;
    try {
      const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as { release_id?: unknown };
      releaseId = typeof parsed.release_id === 'string' ? parsed.release_id : undefined;
    } catch {
      releaseId = undefined;
    }
    cached = { file, mtimeMs: stat.mtimeMs, size: stat.size, releaseId };
    return releaseId;
  };
}

/**
 * A Connect middleware that answers every request under /data/ from
 * `releaseDir` and passes everything else to `next`.
 */
export function createReleaseHandler(releaseDir: string) {
  const currentRelease = currentReleaseReader();
  return function releaseHandler(req: IncomingMessage, res: ServerResponse, next: Next): void {
    const url = req.url ?? '';
    const pathname = url.split(/[?#]/, 1)[0] ?? '';
    if (!pathname.startsWith(DATA_PREFIX)) {
      next();
      return;
    }
    serve(releaseDir, currentRelease, pathname.slice(DATA_PREFIX.length), req, res).catch(
      (error: unknown) => {
        next(error);
      },
    );
  };
}

async function serve(
  releaseDir: string,
  currentRelease: (root: string) => Promise<string | undefined>,
  encoded: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    finish(res, 405, { Allow: 'GET, HEAD' });
    return;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    finish(res, 400);
    return;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) {
    finish(res, 400);
    return;
  }
  let root: string;
  try {
    root = await fs.realpath(releaseDir);
  } catch {
    finish(res, 404);
    return;
  }
  // /data/manifest.json, or /data/r/<release_id>/<path> for the current
  // release; every other path is not found.
  let relative: string;
  let cacheControl: string;
  if (decoded === 'manifest.json') {
    relative = decoded;
    cacheControl = NO_CACHE;
  } else {
    const [scope, releaseId, ...rest] = decoded.split('/');
    if (scope !== RELEASE_SCOPE || releaseId === undefined || rest.length === 0) {
      finish(res, 404);
      return;
    }
    if (!SAFE_ID.test(releaseId)) {
      finish(res, 400);
      return;
    }
    if (releaseId !== (await currentRelease(root))) {
      finish(res, 404, { [STALE_HEADER]: STALE_VALUE, 'Cache-Control': 'no-store' });
      return;
    }
    relative = rest.join('/');
    cacheControl = IMMUTABLE;
  }
  const requested = path.resolve(root, relative);
  if (requested === root) {
    finish(res, 404);
    return;
  }
  if (!isInside(root, requested)) {
    finish(res, 403);
    return;
  }
  let file: string;
  let size: number;
  try {
    file = await fs.realpath(requested);
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error('not a file');
    size = stat.size;
  } catch {
    finish(res, 404);
    return;
  }
  if (!isInside(root, file)) {
    finish(res, 403);
    return;
  }

  const common = {
    'Accept-Ranges': 'bytes',
    'Content-Type': contentTypeFor(file),
    'Cache-Control': cacheControl,
  };
  const range = parseRange(req.headers.range, size);
  if (range === 'unsatisfiable') {
    finish(res, 416, { ...common, 'Content-Range': `bytes */${String(size)}` });
    return;
  }
  const { start, end } = range === 'ignore' ? { start: 0, end: size - 1 } : range;
  res.statusCode = range === 'ignore' ? 200 : 206;
  for (const [name, value] of Object.entries(common)) res.setHeader(name, value);
  res.setHeader('Content-Length', String(size === 0 ? 0 : end - start + 1));
  if (range !== 'ignore') {
    res.setHeader('Content-Range', `bytes ${String(start)}-${String(end)}/${String(size)}`);
  }
  if (req.method === 'HEAD' || size === 0) {
    res.end();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(file, { start, end });
    stream.on('error', reject);
    stream.on('end', resolve);
    stream.pipe(res);
  });
}

/** The Vite plugin: the same handler for `vite` and `vite preview`. */
export function releaseData(repoRoot: string, env: NodeJS.ProcessEnv = process.env): Plugin {
  const releaseDir = resolveReleaseDir(repoRoot, env);
  const handler = createReleaseHandler(releaseDir);
  return {
    name: 'catalejo-release-data',
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
