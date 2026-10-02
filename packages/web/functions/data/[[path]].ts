// Serves the release files under /data/ from R2 (requirements §9, "the
// Functions proxy serves only the release prefix for its instance"; §10,
// Cloudflare Pages and the release-scoped data paths; data contract §6,
// release layout).
//
// The application reads the manifest at /data/manifest.json and every other
// release file at /data/r/<release_id>/<path> (requirements §10). This
// Function reads the instance's pointer file, releases/current.json for the
// main instance or releases/<group_id>/current.json when the CATALEJO_GROUP
// variable names a group, and answers
//
//   /data/manifest.json        from the pointer's release, with
//                              Cache-Control: no-cache and the object's ETag;
//   /data/r/<release_id>/<path> from releases/<release_id>/[<group_id>/]<path>
//                              when <release_id> is the pointer's release,
//                              with Cache-Control immutable, because a file
//                              never changes under one release_id;
//                              for any other release_id, 404 with the header
//                              X-Catalejo-Release: stale, on which the
//                              application asks the reader to reload;
//   any other /data/ path      404, without reading the bucket.
//
// Every key is built under the instance prefix from validated segments, so an
// instance never reaches another release or, for a group instance, another
// group's prefix. The main instance serves the full collection, whose prefix
// contains the group prefixes (contract §6). The parsed pointer is kept in
// module scope for POINTER_TTL_MS, so a new pointer is seen within that time.
//
// DuckDB-WASM reads Parquet files in parts, so the Function answers HEAD and
// a single byte range (206 with Content-Range, 416 when the range cannot be
// satisfied), with Content-Length and Accept-Ranges, as the development
// server does. A GET costs one R2 operation: the Range header becomes an R2
// range and If-None-Match an onlyIf precondition of the same get() call, and
// the object's size, returned with the part, gives the Content-Range. Only a
// range R2 refuses (one that starts past the end) costs a head() to answer
// 416 with the size. HEAD costs one head().
//
// public/_routes.json sends /data/* to Functions. In development and in
// `vite preview` the Vite plugin in vite/releaseData.ts serves releases/synth
// (or CATALEJO_RELEASE_DIR) at the same paths with the same behavior, and
// this Function is not involved.
import type {
  Env,
  EventContext,
  PagesFunction,
  R2Bucket,
  R2Object,
  R2ObjectBody,
  R2Range,
} from '../types';

type Context = EventContext<Env, 'path'>;

/**
 * The pattern for release and group identifiers, the identifier pattern of
 * data contract §3.1. It excludes empty strings, "." and "..", and slashes.
 */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** How long a parsed pointer file is reused, in milliseconds. */
export const POINTER_TTL_MS = 60_000;

/** The manifest: revalidated on every read, so a new pointer is seen. */
const NO_CACHE = 'no-cache';

/** A file under /data/r/<release_id>/, which never changes. */
export const IMMUTABLE = 'public, max-age=31536000, immutable';

/** The first segment of the release-scoped paths, /data/r/<release_id>/<path>. */
export const RELEASE_SCOPE = 'r';

/** The header and value of the answer for a release other than the current one. */
export const STALE_HEADER = 'X-Catalejo-Release';
export const STALE_VALUE = 'stale';

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

type Instance = { releaseId: string; prefix: string } | { error: string };

/**
 * The current release of this instance and the key prefix it serves,
 * releases/<release_id>/ or releases/<release_id>/<group_id>/, from its
 * pointer file. Only an unset or
 * empty CATALEJO_GROUP selects the main instance; any other value must be a
 * valid group identifier, so a misconfigured group instance fails closed and
 * never serves the full collection.
 */
async function instance(env: Env, bucket: R2Bucket): Promise<Instance> {
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
  return { releaseId: cached.releaseId, prefix: `releases/${cached.releaseId}/${groupPart}` };
}

function headersFor(key: string, object: R2Object, cacheControl: string): Headers {
  return new Headers({
    'Accept-Ranges': 'bytes',
    'Content-Type': contentTypeFor(key, object),
    'Cache-Control': cacheControl,
    ETag: object.httpEtag,
  });
}

/**
 * A Range header as an R2 range, before the size is known: "a-b" is an offset
 * and a length, "a-" an offset, "-n" a suffix. The same cases as parseRange
 * are "ignore" or "unsatisfiable"; bounds are checked once the size is known.
 */
export function requestedRange(header: string | undefined): R2Range | 'unsatisfiable' | 'ignore' {
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
    return suffix === 0 ? 'unsatisfiable' : { suffix };
  }
  const offset = Number(first);
  if (last === '') return { offset };
  const end = Number(last);
  return end < offset ? 'unsatisfiable' : { offset, length: end - offset + 1 };
}

/**
 * The one ETag of an If-None-Match header, bare (without W/ and quotes) as
 * R2's onlyIf takes it; undefined for no header, "*" or several tags, which
 * are compared after the read.
 */
export function singleEtag(ifNoneMatch: string | null): string | undefined {
  if (ifNoneMatch === null || ifNoneMatch.includes(',')) return undefined;
  const tag = ifNoneMatch.trim().replace(/^W\//, '');
  const bare = /^"([^"]*)"$/.exec(tag)?.[1];
  return bare === undefined || bare === '' ? undefined : bare;
}

/** One get(): the object, its metadata alone when the precondition held, or null. */
function getOnce(
  bucket: R2Bucket,
  key: string,
  range: R2Range | undefined,
  etag: string | undefined,
): Promise<R2ObjectBody | R2Object | null> {
  if (etag === undefined) return range === undefined ? bucket.get(key) : bucket.get(key, { range });
  const onlyIf = { etagDoesNotMatch: etag };
  return bucket.get(key, range === undefined ? { onlyIf } : { range, onlyIf });
}

function notModified(headers: Headers): Response {
  return new Response(null, { status: 304, headers });
}

function unsatisfiable(headers: Headers, size: number): Response {
  headers.set('Content-Range', `bytes */${String(size)}`);
  headers.set('Content-Length', '0');
  return new Response(null, { status: 416, headers });
}

function partial(
  headers: Headers,
  range: { start: number; end: number },
  size: number,
  body: ReadableStream<Uint8Array> | null,
): Response {
  headers.set('Content-Length', String(range.end - range.start + 1));
  headers.set('Content-Range', `bytes ${String(range.start)}-${String(range.end)}/${String(size)}`);
  return new Response(body, { status: 206, headers });
}

/** HEAD from the object's metadata, one head(). */
async function head(
  bucket: R2Bucket,
  key: string,
  request: Request,
  cacheControl: string,
): Promise<Response> {
  const object = await bucket.head(key);
  if (object === null) return plain(404, 'Not found.', 'HEAD');
  const headers = headersFor(key, object, cacheControl);
  // If-None-Match is evaluated before Range (RFC 9110 §13.2.2).
  if (matches(request.headers.get('If-None-Match'), object.httpEtag)) return notModified(headers);
  const size = object.size;
  const range = parseRange(request.headers.get('Range') ?? undefined, size);
  if (range === 'unsatisfiable') return unsatisfiable(headers, size);
  if (range !== 'ignore') return partial(headers, range, size, null);
  headers.set('Content-Length', String(size));
  return new Response(null, { status: 200, headers });
}

/**
 * The answer to a range R2 refused: a head() for the size, then 416, or, if
 * the range is satisfiable after all, the part with its bounds clamped.
 */
async function refusedRange(
  bucket: R2Bucket,
  key: string,
  request: Request,
  cacheControl: string,
): Promise<Response> {
  const object = await bucket.head(key);
  if (object === null) return plain(404, 'Not found.', 'GET');
  const headers = headersFor(key, object, cacheControl);
  if (matches(request.headers.get('If-None-Match'), object.httpEtag)) return notModified(headers);
  const range = parseRange(request.headers.get('Range') ?? undefined, object.size);
  if (range === 'unsatisfiable' || range === 'ignore') return unsatisfiable(headers, object.size);
  const length = range.end - range.start + 1;
  const part = await bucket.get(key, { range: { offset: range.start, length } });
  if (part === null) return plain(404, 'Not found.', 'GET');
  return partial(headers, range, object.size, part.body);
}

/** GET with one get(): the precondition and the range travel with the read. */
async function get(
  bucket: R2Bucket,
  key: string,
  request: Request,
  cacheControl: string,
): Promise<Response> {
  const ifNoneMatch = request.headers.get('If-None-Match');
  const rangeHeader = request.headers.get('Range') ?? undefined;
  const requested = requestedRange(rangeHeader);
  if (requested === 'unsatisfiable') return refusedRange(bucket, key, request, cacheControl);
  const range = requested === 'ignore' ? undefined : requested;
  let object: R2ObjectBody | R2Object | null;
  try {
    object = await getOnce(bucket, key, range, singleEtag(ifNoneMatch));
  } catch (error) {
    if (range === undefined) throw error;
    return refusedRange(bucket, key, request, cacheControl);
  }
  if (object === null) return plain(404, 'Not found.', 'GET');
  const headers = headersFor(key, object, cacheControl);
  if (!('body' in object)) return notModified(headers);
  if (matches(ifNoneMatch, object.httpEtag)) {
    await object.body.cancel();
    return notModified(headers);
  }
  const size = object.size;
  if (range === undefined) {
    headers.set('Content-Length', String(size));
    return new Response(object.body, { status: 200, headers });
  }
  const bounds = parseRange(rangeHeader, size);
  if (bounds === 'unsatisfiable' || bounds === 'ignore') {
    await object.body.cancel();
    return unsatisfiable(headers, size);
  }
  return partial(headers, bounds, size, object.body);
}

type Target =
  { kind: 'manifest' } | { kind: 'scoped'; releaseId: string; path: string[] } | { kind: 'none' };

/** What a /data/ path names, from its decoded segments. */
function target(parts: string[]): Target {
  if (parts.length === 1 && parts[0] === 'manifest.json') return { kind: 'manifest' };
  const [scope, releaseId, ...path] = parts;
  if (scope === RELEASE_SCOPE && releaseId !== undefined && path.length > 0) {
    return { kind: 'scoped', releaseId, path };
  }
  return { kind: 'none' };
}

async function serve(context: Context): Promise<Response> {
  const { request, env } = context;
  const method = request.method;
  if (method !== 'GET' && method !== 'HEAD') {
    return plain(405, 'Method not allowed.', method, { Allow: 'GET, HEAD' });
  }
  const parts = segments(context.params);
  if (parts === undefined) return plain(400, 'Bad request path.', method);
  const named = target(parts);
  if (named.kind === 'none') return plain(404, 'Not found.', method);
  const bucket = env.RELEASES;
  if (bucket === undefined) {
    return plain(
      503,
      'The RELEASES bucket binding is not configured for this Pages project.',
      method,
    );
  }
  const resolved = await instance(env, bucket);
  if ('error' in resolved) return plain(503, resolved.error, method);

  let key: string;
  let cacheControl: string;
  if (named.kind === 'manifest') {
    key = `${resolved.prefix}manifest.json`;
    cacheControl = NO_CACHE;
  } else {
    if (named.releaseId !== resolved.releaseId) {
      return plain(404, 'This release is no longer current; reload the page.', method, {
        [STALE_HEADER]: STALE_VALUE,
      });
    }
    key = `${resolved.prefix}${named.path.join('/')}`;
    cacheControl = IMMUTABLE;
  }
  return method === 'HEAD'
    ? head(bucket, key, request, cacheControl)
    : get(bucket, key, request, cacheControl);
}

/** Every method reaches this handler, so that others answer 405. */
export const onRequest: PagesFunction<Env, 'path'> = serve;
