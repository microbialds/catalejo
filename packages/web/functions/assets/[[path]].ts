// Serves the DuckDB-WASM engine and extensions from R2 (requirements §9, no
// request leaves the origin; §10, Cloudflare Pages).
//
// The engine files exceed the Pages limit of 25 MiB per file, so the build
// does not contain them. deploy.yml uploads them to the RELEASES bucket under
// assets/duckdb-wasm/<package version>/, with the extension repository under
// assets/duckdb-extensions/v<engine>/<platform>/, and this Function answers
// /assets/duckdb-wasm/* and /assets/duckdb-extensions/* from those keys. The
// files never change under one path, so they are cached as immutable.
//
// public/_routes.json limits the Function to those two prefixes, so Vite's
// own build assets under /assets/ stay static. Any other /assets/ path that
// reaches the Function anyway is passed to context.next(). _routes.json also
// sends /data/* to the release proxy in functions/data/[[path]].ts.
//
// In development the Vite plugin in vite/duckdbAssets.ts serves the same
// paths from node_modules and from .cache/duckdb-extensions.
import type { Env, EventContext, PagesFunction, R2Object } from '../types';

type Context = EventContext<Env, 'path'>;

/** The first path segments served from the bucket. */
const BUCKET_PREFIXES = new Set(['duckdb-wasm', 'duckdb-extensions']);

const IMMUTABLE = 'public, max-age=31536000, immutable';

function plain(status: number, message: string, method: string): Response {
  return new Response(method === 'HEAD' ? null : `${message}\n`, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/** The path segments under /assets/, or undefined when one is unsafe. */
function segments(params: Context['params']): string[] | undefined {
  const raw = params.path;
  const parts = raw === undefined ? [] : Array.isArray(raw) ? raw : raw.split('/');
  if (parts.length === 0) return undefined;
  const unsafe = (part: string) =>
    part === '' ||
    part === '.' ||
    part === '..' ||
    part.includes('/') ||
    part.includes('\\') ||
    part.includes('\0');
  return parts.some(unsafe) ? undefined : parts;
}

export function contentTypeFor(key: string, object: R2Object): string {
  const lower = key.toLowerCase();
  if (lower.endsWith('.wasm')) return 'application/wasm';
  if (lower.endsWith('.js')) return 'text/javascript';
  return object.httpMetadata?.contentType ?? 'application/octet-stream';
}

/** Whether If-None-Match names the object's ETag (weak comparison, RFC 9110). */
function matches(ifNoneMatch: string | null, etag: string): boolean {
  if (ifNoneMatch === null) return false;
  const strip = (tag: string) => tag.trim().replace(/^W\//, '');
  return ifNoneMatch.split(',').some((tag) => tag.trim() === '*' || strip(tag) === strip(etag));
}

function headersFor(key: string, object: R2Object): Headers {
  return new Headers({
    'Content-Type': contentTypeFor(key, object),
    'Cache-Control': IMMUTABLE,
    ETag: object.httpEtag,
  });
}

async function serve(context: Context): Promise<Response> {
  const { request, env } = context;
  const method = request.method;
  const parts = segments(context.params);
  if (parts === undefined) return plain(400, 'Bad request path.', method);
  if (!BUCKET_PREFIXES.has(parts[0] ?? '')) return context.next();
  const bucket = env.RELEASES;
  if (bucket === undefined) {
    return plain(
      503,
      'The RELEASES bucket binding is not configured for this Pages project.',
      method,
    );
  }

  const key = `assets/${parts.join('/')}`;
  const ifNoneMatch = request.headers.get('If-None-Match');
  if (method === 'HEAD') {
    const object = await bucket.head(key);
    if (object === null) return plain(404, 'Not found.', method);
    const headers = headersFor(key, object);
    if (matches(ifNoneMatch, object.httpEtag)) return new Response(null, { status: 304, headers });
    headers.set('Content-Length', String(object.size));
    return new Response(null, { status: 200, headers });
  }

  const object = await bucket.get(key);
  if (object === null) return plain(404, 'Not found.', method);
  const headers = headersFor(key, object);
  if (matches(ifNoneMatch, object.httpEtag)) {
    await object.body.cancel();
    return new Response(null, { status: 304, headers });
  }
  headers.set('Content-Length', String(object.size));
  return new Response(object.body, { status: 200, headers });
}

export const onRequestGet: PagesFunction<Env, 'path'> = serve;
export const onRequestHead: PagesFunction<Env, 'path'> = serve;
