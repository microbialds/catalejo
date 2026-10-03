// The Pages Function that serves release files under /data/ from R2
// (requirements §9 and §10, data contract §6), exercised with a fake bucket:
// the manifest at /data/manifest.json, every other file at
// /data/r/<release_id>/<path> for the pointer's release only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IMMUTABLE,
  onRequest,
  RELEASE_SCOPE,
  parseRange,
  POINTER_TTL_MS,
  requestedRange,
  resetPointerCache,
  singleEtag,
  STALE_HEADER,
  STALE_VALUE,
} from '../functions/data/[[path]]';
import type {
  Env,
  EventContext,
  R2Bucket,
  R2GetOptions,
  R2Object,
  R2ObjectBody,
} from '../functions/types';
import {
  parseRange as devParseRange,
  IMMUTABLE as DEV_IMMUTABLE,
  RELEASE_SCOPE as DEV_RELEASE_SCOPE,
  STALE_HEADER as DEV_STALE_HEADER,
  STALE_VALUE as DEV_STALE_VALUE,
} from '../vite/releaseData';

interface Stored {
  bytes: Uint8Array<ArrayBuffer>;
  etag: string;
  contentType?: string;
}

interface Call {
  method: 'get' | 'head';
  key: string;
  options?: R2GetOptions;
}

const text = (value: string) => new TextEncoder().encode(value);

/**
 * What the fake answers for a range that starts at or past the end of the
 * object, which R2 does not document: a thrown error or null.
 */
type PastEnd = 'throw' | 'null';

function fakeBucket(objects: Record<string, Stored>, pastEnd: PastEnd = 'throw') {
  const calls: Call[] = [];
  const meta = (key: string, stored: Stored): R2Object => ({
    key,
    size: stored.bytes.byteLength,
    httpEtag: `"${stored.etag}"`,
    ...(stored.contentType === undefined
      ? {}
      : { httpMetadata: { contentType: stored.contentType } }),
  });
  // R2 returns the metadata without a body when onlyIf fails and clamps a
  // length past the end; a range that starts past the end throws or returns
  // null, as pastEnd says.
  const get = (key: string, options?: R2GetOptions): Promise<R2ObjectBody | R2Object | null> => {
    calls.push(options === undefined ? { method: 'get', key } : { method: 'get', key, options });
    const stored = objects[key];
    if (stored === undefined) return Promise.resolve(null);
    const unchanged = options?.onlyIf?.etagDoesNotMatch;
    if (unchanged !== undefined && unchanged === stored.etag) {
      return Promise.resolve(meta(key, stored));
    }
    let bytes = stored.bytes;
    const range = options?.range;
    if (range !== undefined) {
      const size = bytes.byteLength;
      if ('suffix' in range) {
        bytes = bytes.slice(Math.max(0, size - range.suffix));
      } else {
        const offset = range.offset ?? 0;
        if (offset >= size) {
          return pastEnd === 'null'
            ? Promise.resolve(null)
            : Promise.reject(new Error('get: The requested range is not satisfiable (10039)'));
        }
        bytes = bytes.slice(offset, range.length === undefined ? size : offset + range.length);
      }
    }
    const body: R2ObjectBody = {
      ...meta(key, stored),
      ...(range === undefined ? {} : { range }),
      body: new Blob([bytes]).stream(),
    };
    return Promise.resolve(body);
  };
  const bucket: R2Bucket = {
    get: get as R2Bucket['get'],
    head(key) {
      calls.push({ method: 'head', key });
      const stored = objects[key];
      return Promise.resolve(stored === undefined ? null : meta(key, stored));
    },
  };
  return { bucket, calls };
}

const pointer = (releaseId: unknown) => ({
  bytes: text(JSON.stringify({ release_id: releaseId })),
  etag: `pointer-${String(releaseId)}`,
});

const parquetBytes = text('PAR1-0123456789-PAR1');
const mainManifest = text('{"release_id":"synth","group_id":null}');
const groupManifest = text('{"release_id":"synth","group_id":"amr-network"}');

function baseObjects(): Record<string, Stored> {
  return {
    'releases/current.json': pointer('synth'),
    'releases/amr-network/current.json': pointer('synth'),
    'releases/other-lab/current.json': pointer('synth'),
    'releases/synth/manifest.json': { bytes: mainManifest, etag: 'main-manifest' },
    'releases/synth/tables/genome.parquet': { bytes: parquetBytes, etag: 'genome1' },
    'releases/synth/genomes/KPN/KPN0001/features.parquet': {
      bytes: parquetBytes,
      etag: 'features1',
    },
    'releases/synth/methods.md': { bytes: text('# Methods'), etag: 'md1' },
    'releases/synth/genomes/KPN/KPN0001/genome.gbk.gz': {
      bytes: new Uint8Array([31, 139, 8, 0]),
      etag: 'gz1',
    },
    'releases/synth/notes.bin': {
      bytes: new Uint8Array([1, 2, 3]),
      etag: 'bin1',
      contentType: 'application/x-catalejo-test',
    },
    'releases/synth/unknown.bin': { bytes: new Uint8Array([1, 2, 3]), etag: 'bin2' },
    'releases/synth/empty.parquet': { bytes: new Uint8Array(0), etag: 'empty1' },
    'releases/synth/amr-network/manifest.json': { bytes: groupManifest, etag: 'group-manifest' },
    'releases/synth/amr-network/tables/genome.parquet': { bytes: parquetBytes, etag: 'genome2' },
    'releases/synth/other-lab/manifest.json': { bytes: text('{}'), etag: 'other-manifest' },
    'releases/2026-09/manifest.json': { bytes: text('{}'), etag: 'old-manifest' },
  };
}

interface Options {
  method?: string;
  headers?: Record<string, string>;
  env?: Partial<Env>;
  objects?: Record<string, Stored>;
  bucket?: R2Bucket | null;
  pastEnd?: PastEnd;
}

function context(segments: string[] | undefined, options: Options = {}) {
  const fake = fakeBucket(options.objects ?? baseObjects(), options.pastEnd);
  const next = vi.fn(() => Promise.resolve(new Response('from next', { status: 299 })));
  const url = `https://catalejo-main.pages.dev/data/${(segments ?? []).join('/')}`;
  const env: Env = { ...options.env };
  if (options.bucket !== null) env.RELEASES = options.bucket ?? fake.bucket;
  const ctx: EventContext<Env, 'path'> = {
    request: new Request(url, {
      method: options.method ?? 'GET',
      headers: options.headers ?? {},
    }),
    env,
    params: segments === undefined ? {} : { path: segments },
    next,
    waitUntil: () => undefined,
  };
  return { ctx, next, calls: fake.calls };
}

const handle = (ctx: EventContext<Env, 'path'>) => Promise.resolve(onRequest(ctx));
const bytesOf = async (response: Response) => new Uint8Array(await response.arrayBuffer());
const group = (id: string): Partial<Env> => ({ CATALEJO_GROUP: id });
/** The segments of /data/r/synth/<path>, the current release in baseObjects. */
const scoped = (...path: string[]) => ['r', 'synth', ...path];

beforeEach(() => {
  resetPointerCache();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('functions/data/[[path]] pointer resolution', () => {
  it('serves the main instance from releases/<release_id>/', async () => {
    const { ctx, calls } = context(['manifest.json']);
    const response = await handle(ctx);
    expect(response.status).toBe(200);
    expect(await bytesOf(response)).toEqual(mainManifest);
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(calls.map((call) => call.key)).toEqual([
      'releases/current.json',
      'releases/synth/manifest.json',
    ]);
  });

  it('treats an empty CATALEJO_GROUP as the main instance', async () => {
    const { ctx, calls } = context(['manifest.json'], { env: group('') });
    expect((await handle(ctx)).status).toBe(200);
    expect(calls.map((call) => call.key)).toEqual([
      'releases/current.json',
      'releases/synth/manifest.json',
    ]);
  });

  it('serves a group instance from releases/<release_id>/<group_id>/', async () => {
    const { ctx, calls } = context(['manifest.json'], { env: group('amr-network') });
    const response = await handle(ctx);
    expect(response.status).toBe(200);
    expect(await bytesOf(response)).toEqual(groupManifest);
    expect(calls.map((call) => call.key)).toEqual([
      'releases/amr-network/current.json',
      'releases/synth/amr-network/manifest.json',
    ]);
  });

  it('follows the release the pointer names', async () => {
    const objects = { ...baseObjects(), 'releases/current.json': pointer('2026-09') };
    const { ctx, calls } = context(['manifest.json'], { objects });
    expect((await handle(ctx)).status).toBe(200);
    expect(calls[1]?.key).toBe('releases/2026-09/manifest.json');
  });

  it('reuses the parsed pointer within the TTL and reads it again after', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T12:00:00Z'));
    const fake = fakeBucket(baseObjects());
    const pointerReads = () =>
      fake.calls.filter((call) => call.key === 'releases/current.json').length;

    await handle(context(['manifest.json'], { bucket: fake.bucket }).ctx);
    await handle(context(scoped('tables', 'genome.parquet'), { bucket: fake.bucket }).ctx);
    expect(pointerReads()).toBe(1);

    vi.setSystemTime(Date.now() + POINTER_TTL_MS - 1);
    await handle(context(['manifest.json'], { bucket: fake.bucket }).ctx);
    expect(pointerReads()).toBe(1);

    vi.setSystemTime(Date.now() + 2);
    await handle(context(['manifest.json'], { bucket: fake.bucket }).ctx);
    expect(pointerReads()).toBe(2);
  });

  it('keeps the pointers of the main instance and of a group apart', async () => {
    const fake = fakeBucket(baseObjects());
    await handle(context(['manifest.json'], { bucket: fake.bucket }).ctx);
    const { ctx } = context(['manifest.json'], { bucket: fake.bucket, env: group('amr-network') });
    const response = await handle(ctx);
    expect(await bytesOf(response)).toEqual(groupManifest);
    expect(fake.calls.map((call) => call.key)).toContain('releases/amr-network/current.json');
  });

  it('answers 503 when the pointer file is missing, and reads it again next time', async () => {
    const objects = baseObjects();
    delete objects['releases/current.json'];
    const fake = fakeBucket(objects);
    const first = await handle(context(['manifest.json'], { bucket: fake.bucket }).ctx);
    expect(first.status).toBe(503);
    expect(await first.text()).toMatch(/current release/);
    objects['releases/current.json'] = pointer('synth');
    const second = await handle(context(['manifest.json'], { bucket: fake.bucket }).ctx);
    expect(second.status).toBe(200);
  });

  it('answers 503 for a group without a pointer file', async () => {
    const { ctx, calls } = context(['manifest.json'], { env: group('no-such-group') });
    expect((await handle(ctx)).status).toBe(503);
    expect(calls.map((call) => call.key)).toEqual(['releases/no-such-group/current.json']);
  });

  it.each([
    ['invalid JSON', { bytes: text('{release_id'), etag: 'bad' }],
    ['no release_id', { bytes: text('{"id":"synth"}'), etag: 'bad' }],
    ['a traversing release_id', pointer('..')],
    ['a release_id with a slash', pointer('synth/amr-network')],
    ['a numeric release_id', pointer(202609)],
    ['an empty release_id', pointer('')],
  ])('answers 503 for a pointer with %s', async (_label, stored) => {
    const objects = { ...baseObjects(), 'releases/current.json': stored };
    const { ctx, calls } = context(['manifest.json'], { objects });
    expect((await handle(ctx)).status).toBe(503);
    expect(calls.map((call) => call.key)).toEqual(['releases/current.json']);
  });

  it.each([['..'], ['.'], ['amr-network/../x'], [' amr-network'], ['a\\b'], ['-x']])(
    'answers 503 without reading the bucket for CATALEJO_GROUP %j',
    async (value) => {
      const { ctx, calls } = context(['manifest.json'], { env: group(value) });
      const response = await handle(ctx);
      expect(response.status).toBe(503);
      expect(await response.text()).toMatch(/CATALEJO_GROUP/);
      expect(calls).toEqual([]);
    },
  );
});

describe('functions/data/[[path]] isolation', () => {
  it("resolves another group's id under the group instance's own prefix", async () => {
    const { ctx, calls } = context(['r', 'synth', 'other-lab', 'manifest.json'], {
      env: group('amr-network'),
    });
    expect((await handle(ctx)).status).toBe(404);
    expect(calls.map((call) => call.key)).toEqual([
      'releases/amr-network/current.json',
      'releases/synth/amr-network/other-lab/manifest.json',
    ]);
  });

  it('resolves another release id inside a scoped path under the own release prefix', async () => {
    const { ctx, calls } = context(['r', 'synth', '2026-09', 'manifest.json']);
    expect((await handle(ctx)).status).toBe(404);
    expect(calls[1]?.key).toBe('releases/synth/2026-09/manifest.json');
  });

  it.each([
    [['2026-09', 'manifest.json']],
    [['tables', 'genome.parquet']],
    [['current.json']],
    [['amr-network', 'manifest.json']],
    [['r']],
    [['r', 'synth']],
    [['R', 'synth', 'manifest.json']],
    [['manifest.json', 'x']],
  ])('answers 404 for the unscoped path %j without reading the bucket', async (segments) => {
    const { ctx, calls, next } = context(segments);
    const response = await handle(ctx);
    expect(response.status).toBe(404);
    expect(response.headers.get(STALE_HEADER)).toBeNull();
    expect(calls).toEqual([]);
    expect(next).not.toHaveBeenCalled();
  });

  it.each([[[] as string[]], [['amr-network']]])(
    'never serves a pointer file through /data/r/<release_id>/current.json (groups %j)',
    async (groups) => {
      const env = groups.length === 0 ? {} : group(groups[0] ?? '');
      const { ctx, calls } = context(['r', 'synth', 'current.json'], { env });
      expect((await handle(ctx)).status).toBe(404);
      const last = calls.at(-1)?.key ?? '';
      expect(last.endsWith('/current.json')).toBe(true);
      expect(last.startsWith('releases/synth/')).toBe(true);
    },
  );

  it.each([
    [['..', 'other-lab', 'manifest.json']],
    [['..', '..', 'current.json']],
    [['%2e%2e', 'other-lab', 'manifest.json']],
    [['%2E%2E', 'current.json']],
    [['.', 'manifest.json']],
    [['%2e', 'manifest.json']],
    [['tables', '', 'genome.parquet']],
    [['tables%2f..%2f..', 'current.json']],
    [['tables/../..', 'current.json']],
    [['tables', 'a\\b']],
    [['tables', '%5c..']],
    [['tables', 'genome.parquet%00']],
    [['tables', '%E0%A4%A']],
    [['r', '..', 'manifest.json']],
    [['r', '%2e%2e', 'current.json']],
    [['r', 'synth', '..', '..', 'current.json']],
    [['r', 'synth', 'tables%2f..%2f..', 'current.json']],
  ])('rejects the unsafe path %j without reading the bucket', async (segments) => {
    const { ctx, calls, next } = context(segments, { env: group('amr-network') });
    const response = await handle(ctx);
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a request without a path', async () => {
    const { ctx, calls } = context(undefined);
    expect((await handle(ctx)).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('accepts the segments of a catch-all parameter given as one string', async () => {
    const { ctx, calls } = context(undefined);
    ctx.params = { path: 'r/synth/tables/genome.parquet' };
    expect((await handle(ctx)).status).toBe(200);
    expect(calls[1]?.key).toBe('releases/synth/tables/genome.parquet');
  });
});

describe('functions/data/[[path]] responses', () => {
  it('serves a Parquet file whole with its type and immutable caching', async () => {
    const { ctx, calls } = context(scoped('tables', 'genome.parquet'));
    const response = await handle(ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/vnd.apache.parquet');
    expect(response.headers.get('Cache-Control')).toBe(IMMUTABLE);
    expect(response.headers.get('ETag')).toBe('"genome1"');
    expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    expect(response.headers.get('Content-Length')).toBe(String(parquetBytes.byteLength));
    expect(await bytesOf(response)).toEqual(parquetBytes);
    expect(calls[1]).toEqual({ method: 'get', key: 'releases/synth/tables/genome.parquet' });
  });

  it.each([
    [['methods.md'], 'text/markdown; charset=utf-8'],
    [['genomes', 'KPN', 'KPN0001', 'genome.gbk.gz'], 'application/gzip'],
    [['notes.bin'], 'application/x-catalejo-test'],
    [['unknown.bin'], 'application/octet-stream'],
  ])('sends %j as %s', async (segments, type) => {
    const { ctx } = context(scoped(...segments));
    expect((await handle(ctx)).headers.get('Content-Type')).toBe(type);
  });

  it('answers 404 for a missing object', async () => {
    const { ctx } = context(scoped('tables', 'missing.parquet'));
    const response = await handle(ctx);
    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('answers a byte range with 206 and Content-Range', async () => {
    const { ctx, calls } = context(scoped('genomes', 'KPN', 'KPN0001', 'features.parquet'), {
      headers: { Range: 'bytes=5-14' },
    });
    const response = await handle(ctx);
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe(
      `bytes 5-14/${String(parquetBytes.byteLength)}`,
    );
    expect(response.headers.get('Content-Length')).toBe('10');
    expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    expect(response.headers.get('ETag')).toBe('"features1"');
    expect(response.headers.get('Cache-Control')).toBe(IMMUTABLE);
    expect(await bytesOf(response)).toEqual(parquetBytes.slice(5, 15));
    const key = 'releases/synth/genomes/KPN/KPN0001/features.parquet';
    expect(calls.slice(1)).toEqual([
      { method: 'get', key, options: { range: { offset: 5, length: 10 } } },
    ]);
  });

  it('answers an open-ended range to the end of the object', async () => {
    const size = parquetBytes.byteLength;
    const { ctx } = context(scoped('tables', 'genome.parquet'), {
      headers: { Range: 'bytes=16-' },
    });
    const response = await handle(ctx);
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe(
      `bytes 16-${String(size - 1)}/${String(size)}`,
    );
    expect(await bytesOf(response)).toEqual(parquetBytes.slice(16));
  });

  it('clamps a range past the end of the object', async () => {
    const size = parquetBytes.byteLength;
    const { ctx } = context(scoped('tables', 'genome.parquet'), {
      headers: { Range: 'bytes=10-9999' },
    });
    const response = await handle(ctx);
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe(
      `bytes 10-${String(size - 1)}/${String(size)}`,
    );
    expect(response.headers.get('Content-Length')).toBe(String(size - 10));
  });

  it('answers a suffix range with the last bytes', async () => {
    const size = parquetBytes.byteLength;
    const { ctx, calls } = context(scoped('tables', 'genome.parquet'), {
      headers: { Range: 'bytes=-4' },
    });
    const response = await handle(ctx);
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe(
      `bytes ${String(size - 4)}-${String(size - 1)}/${String(size)}`,
    );
    expect(response.headers.get('Content-Length')).toBe('4');
    expect(await bytesOf(response)).toEqual(text('PAR1'));
    expect(calls.at(-1)?.options).toEqual({ range: { suffix: 4 } });
  });

  it('answers a suffix range longer than the object with the whole object', async () => {
    const size = parquetBytes.byteLength;
    const { ctx } = context(scoped('tables', 'genome.parquet'), {
      headers: { Range: 'bytes=-9999' },
    });
    const response = await handle(ctx);
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe(
      `bytes 0-${String(size - 1)}/${String(size)}`,
    );
    expect(await bytesOf(response)).toEqual(parquetBytes);
  });

  it.each([['bytes=9999-'], ['bytes=8-3'], ['bytes=-0'], ['bytes=abc'], ['bytes=-']])(
    'answers 416 for the unsatisfiable range %s',
    async (range) => {
      const size = parquetBytes.byteLength;
      const { ctx, calls } = context(scoped('tables', 'genome.parquet'), {
        headers: { Range: range },
      });
      const response = await handle(ctx);
      expect(response.status).toBe(416);
      expect(response.headers.get('Content-Range')).toBe(`bytes */${String(size)}`);
      expect(response.body).toBeNull();
      expect(calls.filter((call) => call.method === 'head')).toHaveLength(1);
    },
  );

  it('answers 416 for any range on an empty object', async () => {
    const { ctx } = context(scoped('empty.parquet'), { headers: { Range: 'bytes=0-' } });
    const response = await handle(ctx);
    expect(response.status).toBe(416);
    expect(response.headers.get('Content-Range')).toBe('bytes */0');
  });

  it.each([['items=0-3'], ['bytes=0-1, 4-5']])(
    'ignores the range %s and answers 200 with the whole object',
    async (range) => {
      const { ctx } = context(scoped('tables', 'genome.parquet'), { headers: { Range: range } });
      const response = await handle(ctx);
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Range')).toBeNull();
      expect(response.headers.get('Content-Length')).toBe(String(parquetBytes.byteLength));
      expect(await bytesOf(response)).toEqual(parquetBytes);
    },
  );

  it.each([['"genome1"'], ['W/"genome1"'], ['"other", "genome1"'], ['*']])(
    'answers 304 for If-None-Match %s',
    async (tag) => {
      const { ctx } = context(scoped('tables', 'genome.parquet'), {
        headers: { 'If-None-Match': tag },
      });
      const response = await handle(ctx);
      expect(response.status).toBe(304);
      expect(response.headers.get('ETag')).toBe('"genome1"');
      expect(response.headers.get('Cache-Control')).toBe(IMMUTABLE);
      expect(response.body).toBeNull();
    },
  );

  it('answers 304 before applying a range', async () => {
    const { ctx, calls } = context(scoped('tables', 'genome.parquet'), {
      headers: { 'If-None-Match': '"genome1"', Range: 'bytes=0-3' },
    });
    const response = await handle(ctx);
    expect(response.status).toBe(304);
    expect(response.headers.get('Content-Range')).toBeNull();
    expect(calls.slice(1)).toEqual([
      {
        method: 'get',
        key: 'releases/synth/tables/genome.parquet',
        options: { range: { offset: 0, length: 4 }, onlyIf: { etagDoesNotMatch: 'genome1' } },
      },
    ]);
  });

  it('answers 200 for a different If-None-Match', async () => {
    const { ctx } = context(scoped('tables', 'genome.parquet'), {
      headers: { 'If-None-Match': '"stale"' },
    });
    expect((await handle(ctx)).status).toBe(200);
  });

  it('answers HEAD from the object metadata without a body', async () => {
    const { ctx, calls } = context(scoped('tables', 'genome.parquet'), { method: 'HEAD' });
    const response = await handle(ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/vnd.apache.parquet');
    expect(response.headers.get('Content-Length')).toBe(String(parquetBytes.byteLength));
    expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    expect(response.headers.get('ETag')).toBe('"genome1"');
    expect(response.body).toBeNull();
    expect(calls.slice(1)).toEqual([
      { method: 'head', key: 'releases/synth/tables/genome.parquet' },
    ]);
  });

  it('answers HEAD with a range as 206 without a body', async () => {
    const { ctx, calls } = context(scoped('tables', 'genome.parquet'), {
      method: 'HEAD',
      headers: { Range: 'bytes=0-3' },
    });
    const response = await handle(ctx);
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Length')).toBe('4');
    expect(response.body).toBeNull();
    expect(calls.filter((call) => call.method === 'get')).toHaveLength(1);
  });

  it('answers HEAD with 404 and 304 as GET does', async () => {
    const missing = context(scoped('tables', 'missing.parquet'), { method: 'HEAD' });
    const missingResponse = await handle(missing.ctx);
    expect(missingResponse.status).toBe(404);
    expect(missingResponse.body).toBeNull();
    const cached = context(scoped('tables', 'genome.parquet'), {
      method: 'HEAD',
      headers: { 'If-None-Match': '"genome1"' },
    });
    expect((await handle(cached.ctx)).status).toBe(304);
  });

  it.each([['POST'], ['PUT'], ['DELETE'], ['PATCH'], ['OPTIONS']])(
    'answers 405 with Allow for %s',
    async (method) => {
      const { ctx, calls, next } = context(['manifest.json'], { method });
      const response = await handle(ctx);
      expect(response.status).toBe(405);
      expect(response.headers.get('Allow')).toBe('GET, HEAD');
      expect(calls).toEqual([]);
      expect(next).not.toHaveBeenCalled();
    },
  );

  it('answers 503 when the RELEASES binding is missing', async () => {
    const { ctx } = context(['manifest.json'], { bucket: null });
    const response = await handle(ctx);
    expect(response.status).toBe(503);
    expect(await response.text()).toMatch(/RELEASES/);
  });
});

describe('functions/data/[[path]] release scope (requirements §10)', () => {
  it('serves /data/manifest.json from the pointer release with no-cache and its ETag', async () => {
    const { ctx } = context(['manifest.json']);
    const response = await handle(ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    expect(response.headers.get('ETag')).toBe('"main-manifest"');
    expect(response.headers.get(STALE_HEADER)).toBeNull();
  });

  it('answers 304 for the manifest through the onlyIf precondition', async () => {
    const { ctx, calls } = context(['manifest.json'], {
      headers: { 'If-None-Match': '"main-manifest"' },
    });
    const response = await handle(ctx);
    expect(response.status).toBe(304);
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    expect(response.headers.get('ETag')).toBe('"main-manifest"');
    expect(calls.slice(1)).toEqual([
      {
        method: 'get',
        key: 'releases/synth/manifest.json',
        options: { onlyIf: { etagDoesNotMatch: 'main-manifest' } },
      },
    ]);
  });

  it('serves a file of the current release, including its manifest, as immutable', async () => {
    for (const segments of [scoped('tables', 'genome.parquet'), scoped('manifest.json')]) {
      const { ctx } = context(segments);
      const response = await handle(ctx);
      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe(IMMUTABLE);
      expect(response.headers.get('Cache-Control')).toMatch(/immutable/);
    }
  });

  it('serves the current release of a group instance under its group prefix', async () => {
    const { ctx, calls } = context(scoped('tables', 'genome.parquet'), {
      env: group('amr-network'),
    });
    const response = await handle(ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe(IMMUTABLE);
    expect(calls.at(-1)?.key).toBe('releases/synth/amr-network/tables/genome.parquet');
  });

  it('refuses a release other than the current one with the stale header', async () => {
    const { ctx, calls } = context(['r', '2026-09', 'manifest.json']);
    const response = await handle(ctx);
    expect(response.status).toBe(404);
    expect(response.headers.get(STALE_HEADER)).toBe('stale');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    expect(await response.text()).toMatch(/no longer current/);
    expect(calls.map((call) => call.key)).toEqual(['releases/current.json']);
  });

  it('refuses the previous release once the pointer moves', async () => {
    const objects: Record<string, Stored> = {
      ...baseObjects(),
      'releases/current.json': pointer('2026-09'),
      'releases/2026-09/tables/genome.parquet': { bytes: parquetBytes, etag: 'g9' },
    };
    const old = context(scoped('tables', 'genome.parquet'), { objects });
    const stale = await handle(old.ctx);
    expect(stale.status).toBe(404);
    expect(stale.headers.get(STALE_HEADER)).toBe('stale');
    const current = context(['r', '2026-09', 'tables', 'genome.parquet'], { objects });
    expect((await handle(current.ctx)).status).toBe(200);
  });

  it('refuses a stale release on HEAD with the header and no body', async () => {
    const { ctx } = context(['r', 'other', 'tables', 'genome.parquet'], { method: 'HEAD' });
    const response = await handle(ctx);
    expect(response.status).toBe(404);
    expect(response.headers.get(STALE_HEADER)).toBe('stale');
    expect(response.body).toBeNull();
  });

  it('refuses a stale release for a group instance against the group pointer', async () => {
    const objects = { ...baseObjects(), 'releases/amr-network/current.json': pointer('2026-09') };
    const { ctx } = context(scoped('tables', 'genome.parquet'), {
      objects,
      env: group('amr-network'),
    });
    const response = await handle(ctx);
    expect(response.status).toBe(404);
    expect(response.headers.get(STALE_HEADER)).toBe('stale');
  });
});

describe('functions/data/[[path]] one R2 operation per read', () => {
  /** The bucket calls of one request once the pointer is cached. */
  async function operations(segments: string[], options: Options = {}) {
    const fake = fakeBucket(baseObjects());
    await handle(context(['manifest.json'], { bucket: fake.bucket }).ctx);
    fake.calls.length = 0;
    const response = await handle(context(segments, { ...options, bucket: fake.bucket }).ctx);
    await response.arrayBuffer();
    return { response, calls: [...fake.calls] };
  }

  it.each([
    ['a closed range', 'bytes=0-3', 206],
    ['an open range', 'bytes=4-', 206],
    ['a suffix range', 'bytes=-4', 206],
    ['a range past the end', 'bytes=10-9999', 206],
    ['no range', undefined, 200],
  ])('reads %s with a single get()', async (_label, range, status) => {
    const headers: Record<string, string> = range === undefined ? {} : { Range: range };
    const { response, calls } = await operations(scoped('tables', 'genome.parquet'), { headers });
    expect(response.status).toBe(status);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('get');
  });

  it('answers a conditional ranged read with a single get()', async () => {
    const { response, calls } = await operations(scoped('tables', 'genome.parquet'), {
      headers: { Range: 'bytes=0-3', 'If-None-Match': '"genome1"' },
    });
    expect(response.status).toBe(304);
    expect(calls).toHaveLength(1);
  });

  it('answers HEAD with a single head()', async () => {
    const { calls } = await operations(scoped('tables', 'genome.parquet'), { method: 'HEAD' });
    expect(calls.map((call) => call.method)).toEqual(['head']);
  });

  it('answers a range that starts past the end with 416 after one more head()', async () => {
    const { response, calls } = await operations(scoped('tables', 'genome.parquet'), {
      headers: { Range: 'bytes=9999-' },
    });
    expect(response.status).toBe(416);
    expect(calls.map((call) => call.method)).toEqual(['get', 'head']);
  });
});

describe.each<PastEnd>(['throw', 'null'])(
  'functions/data/[[path]] with a bucket whose get() past the end does %s',
  (pastEnd) => {
    const genomeKey = 'releases/synth/tables/genome.parquet';

    /** The bucket calls of one request once the pointer is cached. */
    async function operations(segments: string[], headers: Record<string, string> = {}) {
      const fake = fakeBucket(baseObjects(), pastEnd);
      await handle(context(['manifest.json'], { bucket: fake.bucket }).ctx);
      fake.calls.length = 0;
      const response = await handle(context(segments, { headers, bucket: fake.bucket }).ctx);
      const body = await bytesOf(response);
      return { response, body, calls: [...fake.calls] };
    }

    it.each([['bytes=9999-'], ['bytes=9999-10000'], [`bytes=${String(parquetBytes.byteLength)}-`]])(
      'answers %s with 416 and the size after one get() and one head()',
      async (range) => {
        const { response, body, calls } = await operations(scoped('tables', 'genome.parquet'), {
          Range: range,
        });
        expect(response.status).toBe(416);
        expect(response.headers.get('Content-Range')).toBe(
          `bytes */${String(parquetBytes.byteLength)}`,
        );
        expect(response.headers.get('Content-Length')).toBe('0');
        expect(response.headers.get('Accept-Ranges')).toBe('bytes');
        expect(response.headers.get('ETag')).toBe('"genome1"');
        expect(response.headers.get('Cache-Control')).toBe(IMMUTABLE);
        expect(body).toEqual(new Uint8Array(0));
        expect(calls.map((call) => [call.method, call.key])).toEqual([
          ['get', genomeKey],
          ['head', genomeKey],
        ]);
      },
    );

    it('answers 416 for a range on an empty object', async () => {
      const { response } = await operations(scoped('empty.parquet'), { Range: 'bytes=0-' });
      expect(response.status).toBe(416);
      expect(response.headers.get('Content-Range')).toBe('bytes */0');
    });

    it('answers 304 before 416 when the ETag matches', async () => {
      const { response } = await operations(scoped('tables', 'genome.parquet'), {
        Range: 'bytes=9999-',
        'If-None-Match': 'W/"genome1"',
      });
      expect(response.status).toBe(304);
    });

    it('answers 404 for a missing key read with a range', async () => {
      const key = 'releases/synth/tables/missing.parquet';
      const { response, calls } = await operations(scoped('tables', 'missing.parquet'), {
        Range: 'bytes=0-3',
      });
      expect(response.status).toBe(404);
      expect(response.headers.get('Content-Range')).toBeNull();
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(calls.map((call) => [call.method, call.key])).toEqual([
        ['get', key],
        ['head', key],
      ]);
    });

    it('answers 404 for a missing key read whole with a single get()', async () => {
      const { response, calls } = await operations(scoped('tables', 'missing.parquet'));
      expect(response.status).toBe(404);
      expect(calls.map((call) => call.method)).toEqual(['get']);
    });

    it.each([['bytes=0-3'], ['bytes=4-'], ['bytes=-4'], ['bytes=10-9999']])(
      'reads the satisfiable range %s with a single get()',
      async (range) => {
        const { response, calls } = await operations(scoped('tables', 'genome.parquet'), {
          Range: range,
        });
        expect(response.status).toBe(206);
        expect(calls.map((call) => call.method)).toEqual(['get']);
      },
    );
  },
);

describe('functions/data/[[path]] a pointer that moved within the TTL', () => {
  const oldPointer = 'releases/current.json';
  /** A bucket on release synth with a newer release 2026-10 already uploaded. */
  function moving() {
    const objects: Record<string, Stored> = {
      ...baseObjects(),
      'releases/2026-10/manifest.json': { bytes: text('{}'), etag: 'new-manifest' },
      'releases/2026-10/tables/genome.parquet': { bytes: parquetBytes, etag: 'genome10' },
      'releases/2026-10/amr-network/tables/genome.parquet': {
        bytes: parquetBytes,
        etag: 'genome10g',
      },
    };
    const fake = fakeBucket(objects);
    const pointerReads = (key = oldPointer) => fake.calls.filter((call) => call.key === key).length;
    const request = (segments: string[], env: Partial<Env> = {}) =>
      handle(context(segments, { bucket: fake.bucket, env }).ctx);
    return { objects, fake, pointerReads, request };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
  });

  it('reads the pointer again and serves the new release it names', async () => {
    const { objects, fake, pointerReads, request } = moving();
    expect((await request(['manifest.json'])).status).toBe(200);
    expect(pointerReads()).toBe(1);
    objects[oldPointer] = pointer('2026-10');
    vi.setSystemTime(Date.now() + POINTER_TTL_MS / 2);

    fake.calls.length = 0;
    const response = await request(['r', '2026-10', 'tables', 'genome.parquet']);
    expect(response.status).toBe(200);
    expect(response.headers.get(STALE_HEADER)).toBeNull();
    expect(response.headers.get('ETag')).toBe('"genome10"');
    expect(await bytesOf(response)).toEqual(parquetBytes);
    expect(fake.calls.map((call) => call.key)).toEqual([
      oldPointer,
      'releases/2026-10/tables/genome.parquet',
    ]);

    // The cache now holds the new release: no further pointer read, and the
    // manifest comes from it.
    fake.calls.length = 0;
    expect((await request(['r', '2026-10', 'tables', 'genome.parquet'])).status).toBe(200);
    const manifest = await request(['manifest.json']);
    expect(manifest.headers.get('ETag')).toBe('"new-manifest"');
    expect(pointerReads()).toBe(0);
  });

  it('answers the stale 404 when the fresh pointer still names another release', async () => {
    const { objects, fake, pointerReads, request } = moving();
    await request(['manifest.json']);
    objects[oldPointer] = pointer('2026-10');
    fake.calls.length = 0;

    const response = await request(['r', '2026-08', 'tables', 'genome.parquet']);
    expect(response.status).toBe(404);
    expect(response.headers.get(STALE_HEADER)).toBe(STALE_VALUE);
    expect(fake.calls.map((call) => call.key)).toEqual([oldPointer]);

    // The fresh read updated the cache, so the old release is now stale and
    // the new one is served without reading the pointer.
    fake.calls.length = 0;
    expect((await request(scoped('tables', 'genome.parquet'))).headers.get(STALE_HEADER)).toBe(
      STALE_VALUE,
    );
    expect(pointerReads()).toBe(1);
    fake.calls.length = 0;
    expect((await request(['r', '2026-10', 'tables', 'genome.parquet'])).status).toBe(200);
    expect(pointerReads()).toBe(0);
  });

  it('answers the stale 404 after one pointer read when the pointer has not moved', async () => {
    const { fake, request } = moving();
    await request(['manifest.json']);
    fake.calls.length = 0;
    const response = await request(['r', '2026-10', 'tables', 'genome.parquet']);
    expect(response.status).toBe(404);
    expect(response.headers.get(STALE_HEADER)).toBe(STALE_VALUE);
    expect(fake.calls.map((call) => call.key)).toEqual([oldPointer]);
  });

  it('reads no pointer for a request for the cached release', async () => {
    const { objects, fake, pointerReads, request } = moving();
    await request(['manifest.json']);
    objects[oldPointer] = pointer('2026-10');
    fake.calls.length = 0;
    const response = await request(scoped('tables', 'genome.parquet'));
    expect(response.status).toBe(200);
    expect(pointerReads()).toBe(0);
    expect(fake.calls.map((call) => call.key)).toEqual(['releases/synth/tables/genome.parquet']);
  });

  it('reads the pointer once for a mismatch on a cold cache', async () => {
    const { fake, pointerReads, request } = moving();
    const response = await request(['r', '2026-08', 'tables', 'genome.parquet']);
    expect(response.headers.get(STALE_HEADER)).toBe(STALE_VALUE);
    expect(pointerReads()).toBe(1);
    expect(fake.calls).toHaveLength(1);
  });

  it('reads the group pointer again for a group instance', async () => {
    const groupPointer = 'releases/amr-network/current.json';
    const { objects, fake, pointerReads, request } = moving();
    const env = group('amr-network');
    await request(['manifest.json'], env);
    objects[groupPointer] = pointer('2026-10');
    fake.calls.length = 0;
    const response = await request(['r', '2026-10', 'tables', 'genome.parquet'], env);
    expect(response.status).toBe(200);
    expect(fake.calls.map((call) => call.key)).toEqual([
      groupPointer,
      'releases/2026-10/amr-network/tables/genome.parquet',
    ]);
    expect(pointerReads()).toBe(0);
  });

  it('answers 503 when the pointer read again is gone', async () => {
    const { objects, request } = moving();
    await request(['manifest.json']);
    delete objects['releases/current.json'];
    const response = await request(['r', '2026-10', 'tables', 'genome.parquet']);
    expect(response.status).toBe(503);
    expect(response.headers.get(STALE_HEADER)).toBeNull();
  });
});

describe('requestedRange and singleEtag', () => {
  it.each([
    [undefined, 'ignore'],
    ['items=0-1', 'ignore'],
    ['bytes=0-1,4-5', 'ignore'],
    ['bytes=0-9', { offset: 0, length: 10 }],
    ['bytes=250-', { offset: 250 }],
    ['bytes=-4', { suffix: 4 }],
    ['bytes=9-3', 'unsatisfiable'],
    ['bytes=-0', 'unsatisfiable'],
    ['bytes=abc', 'unsatisfiable'],
    ['bytes=-', 'unsatisfiable'],
  ])('reads the Range header %j', (header, expected) => {
    expect(requestedRange(header)).toEqual(expected);
  });

  it.each([
    [null, undefined],
    ['"abc"', 'abc'],
    ['W/"abc"', 'abc'],
    [' "abc" ', 'abc'],
    ['*', undefined],
    ['"a", "b"', undefined],
    ['abc', undefined],
    ['""', undefined],
  ])('reads If-None-Match %j', (header, expected) => {
    expect(singleEtag(header)).toBe(expected);
  });
});

describe('the development server', () => {
  it('uses the same scope, cache header and stale header as the Function', () => {
    expect(DEV_RELEASE_SCOPE).toBe(RELEASE_SCOPE);
    expect(DEV_IMMUTABLE).toBe(IMMUTABLE);
    expect(DEV_STALE_HEADER).toBe(STALE_HEADER);
    expect(DEV_STALE_VALUE).toBe(STALE_VALUE);
  });
});

describe('parseRange', () => {
  it.each([
    [undefined, 20],
    ['bytes=0-3', 20],
    ['bytes=5-', 20],
    ['bytes=-4', 20],
    ['bytes=-40', 20],
    ['bytes=10-9999', 20],
    ['bytes=20-', 20],
    ['bytes=8-3', 20],
    ['bytes=-0', 20],
    ['bytes=-', 20],
    ['bytes=x-1', 20],
    ['BYTES = 1 - 2', 20],
    ['bytes=0-1,4-5', 20],
    ['items=0-1', 20],
    ['bytes=0-', 0],
    ['bytes=-1', 0],
  ])('agrees with the development server for %j on size %d', (header, size) => {
    expect(parseRange(header, size)).toEqual(devParseRange(header, size));
  });
});
