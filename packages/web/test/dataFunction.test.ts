// The Pages Function that serves release files under /data/ from R2
// (requirements §9 and §10, data contract §6), exercised with a fake bucket.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  onRequest,
  parseRange,
  POINTER_TTL_MS,
  resetPointerCache,
} from '../functions/data/[[path]]';
import type {
  Env,
  EventContext,
  R2Bucket,
  R2GetOptions,
  R2Object,
  R2ObjectBody,
} from '../functions/types';
import { parseRange as devParseRange } from '../vite/releaseData';

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

function fakeBucket(objects: Record<string, Stored>) {
  const calls: Call[] = [];
  const meta = (key: string, stored: Stored): R2Object => ({
    key,
    size: stored.bytes.byteLength,
    httpEtag: `"${stored.etag}"`,
    ...(stored.contentType === undefined
      ? {}
      : { httpMetadata: { contentType: stored.contentType } }),
  });
  const bucket: R2Bucket = {
    get(key, options) {
      calls.push(options === undefined ? { method: 'get', key } : { method: 'get', key, options });
      const stored = objects[key];
      if (stored === undefined) return Promise.resolve(null);
      let bytes = stored.bytes;
      const range = options?.range;
      if (range !== undefined) {
        const size = bytes.byteLength;
        if ('suffix' in range) {
          bytes = bytes.slice(Math.max(0, size - range.suffix));
        } else {
          const offset = range.offset ?? 0;
          bytes = bytes.slice(offset, range.length === undefined ? size : offset + range.length);
        }
      }
      const body: R2ObjectBody = {
        ...meta(key, stored),
        ...(range === undefined ? {} : { range }),
        body: new Blob([bytes]).stream(),
      };
      return Promise.resolve(body);
    },
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
}

function context(segments: string[] | undefined, options: Options = {}) {
  const fake = fakeBucket(options.objects ?? baseObjects());
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
    await handle(context(['tables', 'genome.parquet'], { bucket: fake.bucket }).ctx);
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
    const { ctx, calls } = context(['other-lab', 'manifest.json'], {
      env: group('amr-network'),
    });
    expect((await handle(ctx)).status).toBe(404);
    expect(calls.map((call) => call.key)).toEqual([
      'releases/amr-network/current.json',
      'releases/synth/amr-network/other-lab/manifest.json',
    ]);
  });

  it('resolves another release id under the own release prefix', async () => {
    const { ctx, calls } = context(['2026-09', 'manifest.json']);
    expect((await handle(ctx)).status).toBe(404);
    expect(calls[1]?.key).toBe('releases/synth/2026-09/manifest.json');
  });

  it.each([[[] as string[]], [['amr-network']]])(
    'never serves a pointer file through /data/current.json (groups %j)',
    async (groups) => {
      const env = groups.length === 0 ? {} : group(groups[0] ?? '');
      const { ctx, calls } = context(['current.json'], { env });
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
    ctx.params = { path: 'tables/genome.parquet' };
    expect((await handle(ctx)).status).toBe(200);
    expect(calls[1]?.key).toBe('releases/synth/tables/genome.parquet');
  });
});

describe('functions/data/[[path]] responses', () => {
  it('serves a Parquet file whole with its type and revalidation headers', async () => {
    const { ctx, calls } = context(['tables', 'genome.parquet']);
    const response = await handle(ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/vnd.apache.parquet');
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    expect(response.headers.get('Cache-Control')).not.toMatch(/immutable/);
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
    const { ctx } = context(segments);
    expect((await handle(ctx)).headers.get('Content-Type')).toBe(type);
  });

  it('answers 404 for a missing object', async () => {
    const { ctx } = context(['tables', 'missing.parquet']);
    const response = await handle(ctx);
    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('answers a byte range with 206 and Content-Range', async () => {
    const { ctx, calls } = context(['genomes', 'KPN', 'KPN0001', 'features.parquet'], {
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
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    expect(await bytesOf(response)).toEqual(parquetBytes.slice(5, 15));
    const key = 'releases/synth/genomes/KPN/KPN0001/features.parquet';
    expect(calls.slice(1)).toEqual([
      { method: 'head', key },
      { method: 'get', key, options: { range: { offset: 5, length: 10 } } },
    ]);
  });

  it('answers an open-ended range to the end of the object', async () => {
    const size = parquetBytes.byteLength;
    const { ctx } = context(['tables', 'genome.parquet'], { headers: { Range: 'bytes=16-' } });
    const response = await handle(ctx);
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe(
      `bytes 16-${String(size - 1)}/${String(size)}`,
    );
    expect(await bytesOf(response)).toEqual(parquetBytes.slice(16));
  });

  it('clamps a range past the end of the object', async () => {
    const size = parquetBytes.byteLength;
    const { ctx } = context(['tables', 'genome.parquet'], {
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
    const { ctx, calls } = context(['tables', 'genome.parquet'], {
      headers: { Range: 'bytes=-4' },
    });
    const response = await handle(ctx);
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe(
      `bytes ${String(size - 4)}-${String(size - 1)}/${String(size)}`,
    );
    expect(response.headers.get('Content-Length')).toBe('4');
    expect(await bytesOf(response)).toEqual(text('PAR1'));
    expect(calls.at(-1)?.options).toEqual({ range: { offset: size - 4, length: 4 } });
  });

  it('answers a suffix range longer than the object with the whole object', async () => {
    const size = parquetBytes.byteLength;
    const { ctx } = context(['tables', 'genome.parquet'], { headers: { Range: 'bytes=-9999' } });
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
      const { ctx, calls } = context(['tables', 'genome.parquet'], { headers: { Range: range } });
      const response = await handle(ctx);
      expect(response.status).toBe(416);
      expect(response.headers.get('Content-Range')).toBe(`bytes */${String(size)}`);
      expect(response.body).toBeNull();
      expect(calls.filter((call) => call.method === 'get')).toHaveLength(1);
    },
  );

  it('answers 416 for any range on an empty object', async () => {
    const { ctx } = context(['empty.parquet'], { headers: { Range: 'bytes=0-' } });
    const response = await handle(ctx);
    expect(response.status).toBe(416);
    expect(response.headers.get('Content-Range')).toBe('bytes */0');
  });

  it.each([['items=0-3'], ['bytes=0-1, 4-5']])(
    'ignores the range %s and answers 200 with the whole object',
    async (range) => {
      const { ctx } = context(['tables', 'genome.parquet'], { headers: { Range: range } });
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
      const { ctx } = context(['tables', 'genome.parquet'], {
        headers: { 'If-None-Match': tag },
      });
      const response = await handle(ctx);
      expect(response.status).toBe(304);
      expect(response.headers.get('ETag')).toBe('"genome1"');
      expect(response.headers.get('Cache-Control')).toBe('no-cache');
      expect(response.body).toBeNull();
    },
  );

  it('answers 304 before applying a range', async () => {
    const { ctx, calls } = context(['tables', 'genome.parquet'], {
      headers: { 'If-None-Match': '"genome1"', Range: 'bytes=0-3' },
    });
    const response = await handle(ctx);
    expect(response.status).toBe(304);
    expect(response.headers.get('Content-Range')).toBeNull();
    expect(calls.slice(1)).toEqual([
      { method: 'head', key: 'releases/synth/tables/genome.parquet' },
    ]);
  });

  it('answers 200 for a different If-None-Match', async () => {
    const { ctx } = context(['tables', 'genome.parquet'], {
      headers: { 'If-None-Match': '"stale"' },
    });
    expect((await handle(ctx)).status).toBe(200);
  });

  it('answers HEAD from the object metadata without a body', async () => {
    const { ctx, calls } = context(['tables', 'genome.parquet'], { method: 'HEAD' });
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
    const { ctx, calls } = context(['tables', 'genome.parquet'], {
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
    const missing = context(['tables', 'missing.parquet'], { method: 'HEAD' });
    const missingResponse = await handle(missing.ctx);
    expect(missingResponse.status).toBe(404);
    expect(missingResponse.body).toBeNull();
    const cached = context(['tables', 'genome.parquet'], {
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
