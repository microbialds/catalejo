// Serves the release files under /data/ from R2 (requirements §9, "the
// Functions proxy serves only the release prefix for its instance"; §10,
// Cloudflare Pages; data contract §6, release layout).
//
// The application reads manifest.json and opens Parquet files through the
// same-origin /data/ path. This Function reads the instance's pointer file,
// releases/current.json for the main instance or
// releases/<group_id>/current.json when the CATALEJO_GROUP variable names a
// group, and answers /data/<path> from releases/<release_id>/<path> or
// releases/<release_id>/<group_id>/<path>. Every key is built under that
// prefix from validated segments, so an instance never reaches another
// release or, for a group instance, another group's prefix. The main
// instance serves the full collection, whose prefix contains the group
// prefixes (contract §6).
//
// DuckDB-WASM reads Parquet files in parts, so the Function answers HEAD and
// a single byte range (206 with Content-Range, 416 when the range cannot be
// satisfied), with Content-Length and Accept-Ranges, as the development
// server does.
//
// Caching. Requirements §10 marks release files immutable because they never
// change under one release_id, but /data/ URLs carry no release_id: when the
// pointer moves to a new release, the same URL names a different file. The
// responses therefore carry Cache-Control: no-cache with the object's ETag,
// and a matching If-None-Match answers 304, so the browser revalidates every
// read and downloads a file again only when it changed. URLs scoped by
// release (/data/<release_id>/...) would allow immutable; that is an open
// point for the maintainer. The parsed pointer is kept in module scope for
// POINTER_TTL_MS, so a new pointer is seen within that time.
//
// public/_routes.json sends /data/* to Functions. In development and in
// `vite preview` the Vite plugin in vite/releaseData.ts serves releases/synth
// (or CATALEJO_RELEASE_DIR) at /data/ with the same range behavior, and this
// Function is not involved.
import type { Env, EventContext, PagesFunction, R2Bucket, R2Object } from '../types';

type Context = EventContext<Env, 'path'>;

/**
 * The pattern for release and group identifiers, the identifier pattern of
 * data contract §3.1. It excludes empty strings, "." and "..", and slashes.
 */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** How long a parsed pointer file is reused, in milliseconds. */
export const POINTER_TTL_MS = 60_000;

const NO_CACHE = 'no-cache';

const CONTENT_TYPES: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.parquet': 'application/vnd.apache.parquet',
  '.gz': 'application/gzip',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

interface CachedPointer {
  releaseId: string;
  expires: number;
}

/** Parsed pointer files by key. Only valid pointers are kept. */
const pointerCache = new Map<string, CachedPointer>();

/** Forgets every cached pointer (for tests). */
export function resetPointerCache(): void {
  pointerCache.clear();
}

function plain(status: number, message: string, method: string, extra?: HeadersInit): Response {
  const headers = new Headers(extra);
  headers.set('Content-Type', 'text/plain; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(method === 'HEAD' ? null : `${message}\n`, { status, headers });
}

/**
 * The decoded path segments under /data/, or undefined when one is unsafe.
 * Each segment is percent-decoded once more, so an encoded "%2e%2e" or "%2f"
 * is seen and rejected whatever decoding happened before.
 */
function segments(params: Context['params']): string[] | undefined {
  const raw = params.path;
  const parts = raw === undefined ? [] : Array.isArray(raw) ? raw : raw.split('/');
  if (parts.length === 0) return undefined;
  const decoded: string[] = [];
  for (const part of parts) {
    let value: string;
    try {
      value = decodeURIComponent(part);
    } catch {
      return undefined;
    }
    if (
      value === '' ||
      value === '.' ||
      value === '..' ||
      value.includes('/') ||
      value.includes('\\') ||
      value.includes('\0')
    ) {
      return undefined;
    }
    decoded.push(value);
  }
  return decoded;
}

/** The content type for a release file, by extension, then object metadata. */
export function contentTypeFor(key: string, object: R2Object): string {
  const lower = key.toLowerCase();
  const dot = lower.lastIndexOf('.');
  const known = dot > lower.lastIndexOf('/') ? CONTENT_TYPES[lower.slice(dot)] : undefined;
  return known ?? object.httpMetadata?.contentType ?? 'application/octet-stream';
}

export type ByteRange = { start: number; end: number } | 'unsatisfiable' | 'ignore';

/**
 * Parses a Range header against a file size (RFC 9110 §14). This mirrors
 * parseRange in vite/releaseData.ts, which cannot be imported here because
 * that module depends on Node and Vite; test/dataFunction.test.ts checks that
 * the two agree. Returns the inclusive byte range, "unsatisfiable" for a
 * malformed or out-of-bounds bytes range, or "ignore" when the header is
 * absent, uses another unit, or asks for several ranges (the full file is
 * then sent with 200, which RFC 9110 allows).
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

/** Whether If-None-Match names the object's ETag (weak comparison, RFC 9110). */
function matches(ifNoneMatch: string | null, etag: string): boolean {
  if (ifNoneMatch === null) return false;
  const strip = (tag: string) => tag.trim().replace(/^W\//, '');
  return ifNoneMatch.split(',').some((tag) => tag.trim() === '*' || strip(tag) === strip(etag));
}

type Prefix = { prefix: string } | { error: string };

/**
 * The key prefix this instance serves, releases/<release_id>/ or
 * releases/<release_id>/<group_id>/, from its pointer file. Only an unset or
 * empty CATALEJO_GROUP selects the main instance; any other value must be a
 * valid group identifier, so a misconfigured group instance fails closed and
 * never serves the full collection.
 */
async function instancePrefix(env: Env, bucket: R2Bucket): Promise<Prefix> {
  const group = env.CATALEJO_GROUP ?? '';
  if (group !== '' && !SAFE_ID.test(group)) {
    return { error: 'The CATALEJO_GROUP variable is not a valid group identifier.' };
  }
  const pointerKey = group === '' ? 'releases/current.json' : `releases/${group}/current.json`;
  const now = Date.now();
  let cached = pointerCache.get(pointerKey);
  if (cached === undefined || cached.expires <= now) {
    pointerCache.delete(pointerKey);
    const object = await bucket.get(pointerKey);
    if (object === null) return { error: 'No current release is published for this instance.' };
    let parsed: unknown;
    try {
      parsed = JSON.parse(await new Response(object.body).text());
    } catch {
      return { error: 'The current release pointer is not valid JSON.' };
    }
    const id =
      typeof parsed === 'object' && parsed !== null && 'release_id' in parsed
        ? parsed.release_id
        : undefined;
    if (typeof id !== 'string' || !SAFE_ID.test(id)) {
      return { error: 'The current release pointer does not name a valid release.' };
    }
    cached = { releaseId: id, expires: now + POINTER_TTL_MS };
    pointerCache.set(pointerKey, cached);
  }
  const groupPart = group === '' ? '' : `${group}/`;
  return { prefix: `releases/${cached.releaseId}/${groupPart}` };
}

function headersFor(key: string, object: R2Object): Headers {
  return new Headers({
    'Accept-Ranges': 'bytes',
    'Content-Type': contentTypeFor(key, object),
    'Cache-Control': NO_CACHE,
    ETag: object.httpEtag,
  });
}

async function serve(context: Context): Promise<Response> {
  const { request, env } = context;
  const method = request.method;
  if (method !== 'GET' && method !== 'HEAD') {
    return plain(405, 'Method not allowed.', method, { Allow: 'GET, HEAD' });
  }
  const parts = segments(context.params);
  if (parts === undefined) return plain(400, 'Bad request path.', method);
  const bucket = env.RELEASES;
  if (bucket === undefined) {
    return plain(
      503,
      'The RELEASES bucket binding is not configured for this Pages project.',
      method,
    );
  }
  const resolved = await instancePrefix(env, bucket);
  if ('error' in resolved) return plain(503, resolved.error, method);

  const key = `${resolved.prefix}${parts.join('/')}`;
  const ifNoneMatch = request.headers.get('If-None-Match');
  const rangeHeader = request.headers.get('Range') ?? undefined;

  if (method === 'HEAD' || rangeHeader !== undefined) {
    // The size is needed before the range can be checked, and If-None-Match
    // is evaluated before Range (RFC 9110 §13.2.2).
    const object = await bucket.head(key);
    if (object === null) return plain(404, 'Not found.', method);
    const headers = headersFor(key, object);
    if (matches(ifNoneMatch, object.httpEtag)) return new Response(null, { status: 304, headers });
    const size = object.size;
    const range = parseRange(rangeHeader, size);
    if (range === 'unsatisfiable') {
      headers.set('Content-Range', `bytes */${String(size)}`);
      headers.set('Content-Length', '0');
      return new Response(null, { status: 416, headers });
    }
    if (range !== 'ignore') {
      const length = range.end - range.start + 1;
      headers.set('Content-Length', String(length));
      headers.set(
        'Content-Range',
        `bytes ${String(range.start)}-${String(range.end)}/${String(size)}`,
      );
      if (method === 'HEAD') return new Response(null, { status: 206, headers });
      const part = await bucket.get(key, { range: { offset: range.start, length } });
      if (part === null) return plain(404, 'Not found.', method);
      return new Response(part.body, { status: 206, headers });
    }
    if (method === 'HEAD') {
      headers.set('Content-Length', String(size));
      return new Response(null, { status: 200, headers });
    }
    // A GET whose Range header is ignored is answered whole, below.
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

/** Every method reaches this handler, so that others answer 405. */
export const onRequest: PagesFunction<Env, 'path'> = serve;
