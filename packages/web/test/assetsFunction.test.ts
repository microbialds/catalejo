// The Pages Function that serves the DuckDB-WASM engine and extensions from
// R2 (requirements §9 and §10), exercised with a fake bucket.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { onRequestGet, onRequestHead } from '../functions/assets/[[path]]';
import type { Env, EventContext, R2Bucket, R2Object, R2ObjectBody } from '../functions/types';
import { webRoot } from './files';

interface Stored {
  bytes: Uint8Array<ArrayBuffer>;
  etag: string;
  contentType?: string;
}

function fakeBucket(objects: Record<string, Stored>) {
  const calls: { method: 'get' | 'head'; key: string }[] = [];
  const meta = (key: string, stored: Stored): R2Object => ({
    key,
    size: stored.bytes.byteLength,
    httpEtag: `"${stored.etag}"`,
    ...(stored.contentType === undefined
      ? {}
      : { httpMetadata: { contentType: stored.contentType } }),
  });
  const bucket: R2Bucket = {
    get(key) {
      calls.push({ method: 'get', key });
      const stored = objects[key];
      if (stored === undefined) return Promise.resolve(null);
      const body: R2ObjectBody = {
        ...meta(key, stored),
        body: new Blob([stored.bytes]).stream(),
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

const wasmBytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const objects: Record<string, Stored> = {
  'assets/duckdb-wasm/1.32.0/duckdb-eh.wasm': { bytes: wasmBytes, etag: 'wasm1' },
  'assets/duckdb-wasm/1.32.0/duckdb-browser-eh.worker.js': {
    bytes: new TextEncoder().encode('self.onmessage = null;'),
    etag: 'js1',
  },
  'assets/duckdb-extensions/v1.4.3/wasm_eh/parquet.duckdb_extension.wasm': {
    bytes: wasmBytes,
    etag: 'ext1',
  },
  'assets/duckdb-extensions/v1.4.3/notes.txt': {
    bytes: new TextEncoder().encode('notes'),
    etag: 'txt1',
    contentType: 'text/plain',
  },
};

const nextResponse = new Response('from next', { status: 299 });

function context(
  segments: string[] | undefined,
  options: { method?: string; headers?: Record<string, string>; env?: Env } = {},
) {
  const { bucket, calls } = fakeBucket(objects);
  const next = vi.fn(() => Promise.resolve(nextResponse));
  const url = `https://catalejo.pages.dev/assets/${(segments ?? []).join('/')}`;
  const ctx: EventContext<Env, 'path'> = {
    request: new Request(url, {
      method: options.method ?? 'GET',
      headers: options.headers ?? {},
    }),
    env: options.env ?? { RELEASES: bucket },
    params: segments === undefined ? {} : { path: segments },
    next,
    waitUntil: () => undefined,
  };
  return { ctx, next, calls };
}

const handle = (ctx: EventContext<Env, 'path'>) =>
  Promise.resolve(ctx.request.method === 'HEAD' ? onRequestHead(ctx) : onRequestGet(ctx));

describe('functions/assets/[[path]]', () => {
  it('serves a .wasm engine file with its type and immutable cache headers', async () => {
    const { ctx, calls } = context(['duckdb-wasm', '1.32.0', 'duckdb-eh.wasm']);
    const response = await handle(ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/wasm');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(response.headers.get('ETag')).toBe('"wasm1"');
    expect(response.headers.get('Content-Length')).toBe(String(wasmBytes.byteLength));
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(wasmBytes);
    expect(calls).toEqual([{ method: 'get', key: 'assets/duckdb-wasm/1.32.0/duckdb-eh.wasm' }]);
  });

  it('serves the worker as JavaScript', async () => {
    const { ctx } = context(['duckdb-wasm', '1.32.0', 'duckdb-browser-eh.worker.js']);
    const response = await handle(ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/javascript');
  });

  it('serves an extension from the repository layout', async () => {
    const { ctx, calls } = context([
      'duckdb-extensions',
      'v1.4.3',
      'wasm_eh',
      'parquet.duckdb_extension.wasm',
    ]);
    const response = await handle(ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/wasm');
    expect(calls[0]?.key).toBe(
      'assets/duckdb-extensions/v1.4.3/wasm_eh/parquet.duckdb_extension.wasm',
    );
  });

  it('uses the stored content type for other extensions', async () => {
    const { ctx } = context(['duckdb-extensions', 'v1.4.3', 'notes.txt']);
    const response = await handle(ctx);
    expect(response.headers.get('Content-Type')).toBe('text/plain');
  });

  it('answers 404 for a missing key', async () => {
    const { ctx } = context(['duckdb-wasm', '9.9.9', 'duckdb-eh.wasm']);
    const response = await handle(ctx);
    expect(response.status).toBe(404);
  });

  it.each([['"wasm1"'], ['W/"wasm1"'], ['"other", "wasm1"'], ['*']])(
    'answers 304 for If-None-Match %s',
    async (tag) => {
      const { ctx } = context(['duckdb-wasm', '1.32.0', 'duckdb-eh.wasm'], {
        headers: { 'If-None-Match': tag },
      });
      const response = await handle(ctx);
      expect(response.status).toBe(304);
      expect(response.headers.get('ETag')).toBe('"wasm1"');
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
      expect(response.body).toBeNull();
    },
  );

  it('answers 200 for a different If-None-Match', async () => {
    const { ctx } = context(['duckdb-wasm', '1.32.0', 'duckdb-eh.wasm'], {
      headers: { 'If-None-Match': '"stale"' },
    });
    expect((await handle(ctx)).status).toBe(200);
  });

  it('passes other /assets/ paths to next()', async () => {
    const { ctx, next, calls } = context(['index-abc123.js']);
    const response = await handle(ctx);
    expect(next).toHaveBeenCalledTimes(1);
    expect(response).toBe(nextResponse);
    expect(calls).toEqual([]);
  });

  it.each([
    [['duckdb-wasm', '..', 'secret']],
    [['duckdb-extensions', '.', 'v1.4.3']],
    [['duckdb-wasm', '', 'duckdb-eh.wasm']],
    [['duckdb-wasm', '1.32.0/../x']],
    [['duckdb-wasm', '1.32.0', 'a\\b']],
    [['..', 'releases', 'current.json']],
  ])('rejects the unsafe path %j', async (segments) => {
    const { ctx, next, calls } = context(segments);
    const response = await handle(ctx);
    expect(response.status).toBe(400);
    expect(next).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('rejects a request without a path', async () => {
    const { ctx } = context(undefined);
    expect((await handle(ctx)).status).toBe(400);
  });

  it('answers 503 when the RELEASES binding is missing', async () => {
    const { ctx } = context(['duckdb-wasm', '1.32.0', 'duckdb-eh.wasm'], { env: {} });
    const response = await handle(ctx);
    expect(response.status).toBe(503);
    expect(await response.text()).toMatch(/RELEASES/);
  });

  it('still passes other paths to next() without the binding', async () => {
    const { ctx, next } = context(['index.css'], { env: {} });
    await handle(ctx);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('answers HEAD from the object metadata without a body', async () => {
    const { ctx, calls } = context(['duckdb-wasm', '1.32.0', 'duckdb-eh.wasm'], {
      method: 'HEAD',
    });
    const response = await handle(ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/wasm');
    expect(response.headers.get('Content-Length')).toBe(String(wasmBytes.byteLength));
    expect(response.headers.get('ETag')).toBe('"wasm1"');
    expect(response.body).toBeNull();
    expect(calls).toEqual([{ method: 'head', key: 'assets/duckdb-wasm/1.32.0/duckdb-eh.wasm' }]);
  });

  it('answers HEAD with 404 and 304 as GET does', async () => {
    const missing = context(['duckdb-wasm', '1.32.0', 'missing.wasm'], { method: 'HEAD' });
    expect((await handle(missing.ctx)).status).toBe(404);
    const cached = context(['duckdb-wasm', '1.32.0', 'duckdb-eh.wasm'], {
      method: 'HEAD',
      headers: { 'If-None-Match': '"wasm1"' },
    });
    expect((await handle(cached.ctx)).status).toBe(304);
  });
});

describe('public/_routes.json', () => {
  it('sends only the engine and extension paths to Functions', () => {
    const routes = JSON.parse(
      readFileSync(path.join(webRoot, 'public', '_routes.json'), 'utf8'),
    ) as unknown;
    expect(routes).toEqual({
      version: 1,
      include: ['/assets/duckdb-wasm/*', '/assets/duckdb-extensions/*'],
      exclude: [],
    });
  });
});
