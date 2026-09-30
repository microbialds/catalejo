// The engine and extension URLs of src/data/engineAssets.ts and the local
// server for them in vite/duckdbAssets.ts (requirements §9 and §10).
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DUCKDB_EXTENSIONS_PATH,
  DUCKDB_WASM_VERSION,
  engineBundles,
  extensionRepositoryUrl,
} from '../src/data/engineAssets';
import {
  createDuckdbAssetsHandler,
  DUCKDB_WASM_FILES,
  duckdbWasmDist,
  duckdbWasmVersion,
} from '../vite/duckdbAssets';
import { webRoot } from './files';

const origin = 'https://catalejo.example';

describe('engineAssets', () => {
  it('carries the installed @duckdb/duckdb-wasm version', () => {
    expect(DUCKDB_WASM_VERSION).toBe(duckdbWasmVersion(webRoot));
  });

  it('offers only the mvp and eh bundles, on the same origin', () => {
    const bundles = engineBundles(origin);
    expect(Object.keys(bundles).sort()).toEqual(['eh', 'mvp']);
    const prefix = `${origin}/assets/duckdb-wasm/${DUCKDB_WASM_VERSION}/`;
    expect(bundles).toEqual({
      mvp: {
        mainModule: `${prefix}duckdb-mvp.wasm`,
        mainWorker: `${prefix}duckdb-browser-mvp.worker.js`,
      },
      eh: {
        mainModule: `${prefix}duckdb-eh.wasm`,
        mainWorker: `${prefix}duckdb-browser-eh.worker.js`,
      },
    });
  });

  it('names only files the local server allows', () => {
    const { mvp, eh } = engineBundles(origin);
    const files = [mvp.mainModule, mvp.mainWorker, eh?.mainModule ?? '', eh?.mainWorker ?? ''];
    for (const file of files) expect(DUCKDB_WASM_FILES).toContain(path.posix.basename(file));
  });

  it('puts the extension repository under /assets/ on the same origin', () => {
    expect(DUCKDB_EXTENSIONS_PATH).toBe('/assets/duckdb-extensions');
    expect(extensionRepositoryUrl(origin)).toBe(`${origin}/assets/duckdb-extensions`);
  });
});

interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

function request(port: number, method: string, requestPath: string): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: requestPath }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

describe('vite/duckdbAssets', () => {
  const version = '1.2.3';
  let tmp: string;
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'catalejo-duckdb-assets-'));
    const distDir = path.join(tmp, 'dist');
    const extensionsDir = path.join(tmp, 'extensions');
    mkdirSync(distDir);
    mkdirSync(path.join(extensionsDir, 'v1.4.3', 'wasm_eh'), { recursive: true });
    for (const file of [...DUCKDB_WASM_FILES, 'duckdb-coi.wasm', 'duckdb-node-eh.worker.cjs']) {
      writeFileSync(path.join(distDir, file), `content of ${file}`);
    }
    writeFileSync(
      path.join(extensionsDir, 'v1.4.3', 'wasm_eh', 'parquet.duckdb_extension.wasm'),
      'parquet',
    );
    writeFileSync(path.join(tmp, 'secret.txt'), 'outside');
    symlinkSync(path.join(tmp, 'secret.txt'), path.join(extensionsDir, 'escape.wasm'));
    const handler = createDuckdbAssetsHandler({ distDir, version, extensionsDir });
    server = http.createServer((req, res) => {
      handler(req, res, () => {
        res.statusCode = 299;
        res.end('next');
      });
    });
    port = await new Promise<number>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        resolve((server.address() as AddressInfo).port);
      });
    });
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(tmp, { recursive: true, force: true });
  });

  it.each([
    ['duckdb-mvp.wasm', 'application/wasm'],
    ['duckdb-eh.wasm', 'application/wasm'],
    ['duckdb-browser-mvp.worker.js', 'text/javascript'],
    ['duckdb-browser-eh.worker.js', 'text/javascript'],
  ])('serves %s as %s', async (file, type) => {
    const answer = await request(port, 'GET', `/assets/duckdb-wasm/${version}/${file}`);
    expect(answer.status).toBe(200);
    expect(answer.headers['content-type']).toBe(type);
    expect(answer.body.toString()).toBe(`content of ${file}`);
    expect(answer.headers['content-length']).toBe(String(answer.body.length));
  });

  it('answers HEAD without a body', async () => {
    const answer = await request(port, 'HEAD', `/assets/duckdb-wasm/${version}/duckdb-eh.wasm`);
    expect(answer.status).toBe(200);
    expect(answer.headers['content-length']).toBe(String('content of duckdb-eh.wasm'.length));
    expect(answer.body.length).toBe(0);
  });

  it.each([
    `/assets/duckdb-wasm/${version}/duckdb-coi.wasm`,
    `/assets/duckdb-wasm/${version}/duckdb-node-eh.worker.cjs`,
    `/assets/duckdb-wasm/9.9.9/duckdb-eh.wasm`,
    `/assets/duckdb-wasm/${version}/duckdb-eh.wasm/extra`,
    '/assets/duckdb-extensions/v1.4.3/wasm_mvp/parquet.duckdb_extension.wasm',
  ])('answers 404 for %s', async (requestPath) => {
    expect((await request(port, 'GET', requestPath)).status).toBe(404);
  });

  it('serves the extension repository layout', async () => {
    const answer = await request(
      port,
      'GET',
      '/assets/duckdb-extensions/v1.4.3/wasm_eh/parquet.duckdb_extension.wasm',
    );
    expect(answer.status).toBe(200);
    expect(answer.headers['content-type']).toBe('application/wasm');
    expect(answer.body.toString()).toBe('parquet');
  });

  it.each([
    '/assets/duckdb-extensions/../secret.txt',
    '/assets/duckdb-extensions/%2e%2e/secret.txt',
    '/assets/duckdb-extensions/v1.4.3/..%2f..%2fsecret.txt',
    `/assets/duckdb-wasm/${version}/..%2fduckdb-eh.wasm`,
    '/assets/duckdb-extensions/v1.4.3%5cwasm_eh',
    `/assets/duckdb-wasm/${version}/`,
  ])('rejects the unsafe path %s', async (requestPath) => {
    const answer = await request(port, 'GET', requestPath);
    expect(answer.status).toBe(400);
  });

  it('refuses a symbolic link that leaves the repository', async () => {
    expect((await request(port, 'GET', '/assets/duckdb-extensions/escape.wasm')).status).toBe(403);
  });

  it('answers 405 for other methods', async () => {
    const answer = await request(port, 'POST', `/assets/duckdb-wasm/${version}/duckdb-eh.wasm`);
    expect(answer.status).toBe(405);
    expect(answer.headers.allow).toBe('GET, HEAD');
  });

  it('passes other paths to next', async () => {
    for (const requestPath of ['/assets/index-abc.js', '/data/manifest.json', '/']) {
      expect((await request(port, 'GET', requestPath)).status).toBe(299);
    }
  });
});

describe('the installed package', () => {
  it('has every allowed engine file', async () => {
    const { existsSync } = await import('node:fs');
    const dist = duckdbWasmDist(webRoot);
    for (const file of DUCKDB_WASM_FILES) expect(existsSync(path.join(dist, file))).toBe(true);
  });
});
