// The /data/ release server used by `vite` and `vite preview` (data contract
// §6; requirements §10). DuckDB-WASM needs HEAD and byte ranges.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createServer, preview, type PreviewServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createReleaseHandler,
  parseRange,
  releaseData,
  resolveReleaseDir,
} from '../vite/releaseData';

interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

/** A raw request; the path is sent as written, without URL normalization. */
function request(
  port: number,
  method: string,
  requestPath: string,
  headers: Record<string, string> = {},
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path: requestPath, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
let tmp: string;
let releaseDir: string;

beforeAll(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'catalejo-release-'));
  releaseDir = path.join(tmp, 'release');
  mkdirSync(path.join(releaseDir, 'tables'), { recursive: true });
  mkdirSync(path.join(releaseDir, 'genomes', 'KPN', 'KPN0001'), { recursive: true });
  writeFileSync(path.join(releaseDir, 'manifest.json'), '{"release_id":"synth"}');
  writeFileSync(path.join(releaseDir, 'tables', 'genome.parquet'), bytes);
  writeFileSync(path.join(releaseDir, 'genomes', 'KPN', 'KPN0001', 'genome.fna.gz'), bytes);
  writeFileSync(path.join(releaseDir, 'empty.json'), '');
  writeFileSync(path.join(tmp, 'secret.txt'), 'outside the release');
  symlinkSync(path.join(tmp, 'secret.txt'), path.join(releaseDir, 'escape.txt'));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('parseRange', () => {
  it.each([
    [undefined, 'ignore'],
    ['items=0-1', 'ignore'],
    ['bytes=0-1,4-5', 'ignore'],
    ['bytes=0-9', { start: 0, end: 9 }],
    ['bytes=250-', { start: 250, end: 255 }],
    ['bytes=-4', { start: 252, end: 255 }],
    ['bytes=-1000', { start: 0, end: 255 }],
    ['bytes=5-100000', { start: 5, end: 255 }],
    ['bytes=256-', 'unsatisfiable'],
    ['bytes=9-3', 'unsatisfiable'],
    ['bytes=-0', 'unsatisfiable'],
    ['bytes=abc', 'unsatisfiable'],
    ['bytes=-', 'unsatisfiable'],
  ])('%s', (header, expected) => {
    expect(parseRange(header, 256)).toEqual(expected);
  });
});

describe('resolveReleaseDir', () => {
  it('defaults to releases/synth at the repository root', () => {
    expect(resolveReleaseDir('/repo', {})).toBe(path.join('/repo', 'releases', 'synth'));
  });

  it('takes CATALEJO_RELEASE_DIR, relative to the directory pnpm was run in', () => {
    expect(resolveReleaseDir('/repo', { CATALEJO_RELEASE_DIR: '/data/r1' })).toBe('/data/r1');
    expect(
      resolveReleaseDir('/repo', { CATALEJO_RELEASE_DIR: 'releases/r2', INIT_CWD: '/repo' }),
    ).toBe(path.join('/repo', 'releases', 'r2'));
  });
});

describe('release handler', () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    const handler = createReleaseHandler(releaseDir);
    server = http.createServer((req, res) => {
      handler(req, res, (error) => {
        res.statusCode = error === undefined ? 418 : 500;
        res.end();
      });
    });
    port = await listen(server);
  });

  afterAll(() => {
    server.close();
  });

  it('serves a JSON file with its length and range support', async () => {
    const answer = await request(port, 'GET', '/data/manifest.json');
    expect(answer.status).toBe(200);
    expect(answer.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(answer.headers['content-length']).toBe('22');
    expect(answer.headers['accept-ranges']).toBe('bytes');
    expect(answer.body.toString()).toBe('{"release_id":"synth"}');
  });

  it('answers HEAD with the length and no body', async () => {
    const answer = await request(port, 'HEAD', '/data/tables/genome.parquet');
    expect(answer.status).toBe(200);
    expect(answer.headers['content-type']).toBe('application/vnd.apache.parquet');
    expect(answer.headers['content-length']).toBe('256');
    expect(answer.body.length).toBe(0);
  });

  it('answers a byte range with 206 and Content-Range', async () => {
    const answer = await request(port, 'GET', '/data/tables/genome.parquet', {
      Range: 'bytes=10-19',
    });
    expect(answer.status).toBe(206);
    expect(answer.headers['content-range']).toBe('bytes 10-19/256');
    expect(answer.headers['content-length']).toBe('10');
    expect([...answer.body]).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  });

  it('answers suffix and open ranges', async () => {
    const suffix = await request(port, 'GET', '/data/tables/genome.parquet', { Range: 'bytes=-4' });
    expect(suffix.status).toBe(206);
    expect(suffix.headers['content-range']).toBe('bytes 252-255/256');
    expect([...suffix.body]).toEqual([252, 253, 254, 255]);
    const open = await request(port, 'GET', '/data/tables/genome.parquet', { Range: 'bytes=254-' });
    expect(open.headers['content-range']).toBe('bytes 254-255/256');
    expect([...open.body]).toEqual([254, 255]);
  });

  it('answers HEAD with a range as 206 without a body', async () => {
    const answer = await request(port, 'HEAD', '/data/tables/genome.parquet', {
      Range: 'bytes=0-3',
    });
    expect(answer.status).toBe(206);
    expect(answer.headers['content-length']).toBe('4');
    expect(answer.body.length).toBe(0);
  });

  it('answers 416 for an unsatisfiable or malformed range', async () => {
    for (const range of ['bytes=256-', 'bytes=abc']) {
      const answer = await request(port, 'GET', '/data/tables/genome.parquet', { Range: range });
      expect(answer.status).toBe(416);
      expect(answer.headers['content-range']).toBe('bytes */256');
    }
  });

  it('sends the whole file for several ranges', async () => {
    const answer = await request(port, 'GET', '/data/tables/genome.parquet', {
      Range: 'bytes=0-1,4-5',
    });
    expect(answer.status).toBe(200);
    expect(answer.body.length).toBe(256);
  });

  it('serves gzip files as themselves, without Content-Encoding', async () => {
    const answer = await request(port, 'GET', '/data/genomes/KPN/KPN0001/genome.fna.gz');
    expect(answer.status).toBe(200);
    expect(answer.headers['content-type']).toBe('application/gzip');
    expect(answer.headers['content-encoding']).toBeUndefined();
    expect(answer.body.length).toBe(256);
  });

  it('serves an empty file', async () => {
    const answer = await request(port, 'GET', '/data/empty.json');
    expect(answer.status).toBe(200);
    expect(answer.headers['content-length']).toBe('0');
  });

  it('ignores the query string', async () => {
    const answer = await request(port, 'GET', '/data/manifest.json?v=1');
    expect(answer.status).toBe(200);
  });

  it.each(['/data/missing.json', '/data/tables', '/data/tables/', '/data/'])(
    'answers 404 for %s',
    async (requestPath) => {
      const answer = await request(port, 'GET', requestPath);
      expect(answer.status).toBe(404);
    },
  );

  it.each([
    '/data/../secret.txt',
    '/data/%2e%2e/secret.txt',
    '/data/..%2fsecret.txt',
    '/data/tables/../../secret.txt',
    '/data/escape.txt',
  ])('rejects %s', async (requestPath) => {
    const answer = await request(port, 'GET', requestPath);
    expect(answer.status).toBe(403);
    expect(answer.body.toString()).not.toContain('outside');
  });

  it.each(['/data/%E0%A4%A', '/data/a%00b', '/data/..%5csecret.txt'])(
    'answers 400 for %s',
    async (requestPath) => {
      const answer = await request(port, 'GET', requestPath);
      expect(answer.status).toBe(400);
    },
  );

  it('answers 405 for other methods', async () => {
    const answer = await request(port, 'POST', '/data/manifest.json');
    expect(answer.status).toBe(405);
    expect(answer.headers.allow).toBe('GET, HEAD');
  });

  it('passes other paths to the next middleware', async () => {
    expect((await request(port, 'GET', '/')).status).toBe(418);
    expect((await request(port, 'GET', '/database')).status).toBe(418);
  });

  it('answers 404 when the release directory is missing and keeps serving', async () => {
    const missing = http.createServer((req, res) => {
      createReleaseHandler(path.join(tmp, 'absent'))(req, res, () => {
        res.statusCode = 418;
        res.end();
      });
    });
    const missingPort = await listen(missing);
    expect((await request(missingPort, 'GET', '/data/manifest.json')).status).toBe(404);
    expect((await request(missingPort, 'HEAD', '/data/manifest.json')).status).toBe(404);
    missing.close();
  });
});

describe('plugin', () => {
  let appRoot: string;
  let dev: ViteDevServer;
  let previewServer: PreviewServer;

  beforeAll(async () => {
    appRoot = path.join(tmp, 'app');
    mkdirSync(path.join(appRoot, 'dist'), { recursive: true });
    writeFileSync(path.join(appRoot, 'index.html'), '<!doctype html><div id="root"></div>');
    writeFileSync(path.join(appRoot, 'dist', 'index.html'), '<!doctype html><div id="root"></div>');
    const plugin = releaseData(tmp, { CATALEJO_RELEASE_DIR: releaseDir });
    dev = await createServer({
      configFile: false,
      root: appRoot,
      logLevel: 'silent',
      plugins: [plugin],
      server: { port: 0, host: '127.0.0.1' },
    });
    await dev.listen();
    previewServer = await preview({
      configFile: false,
      root: appRoot,
      logLevel: 'silent',
      plugins: [plugin],
      preview: { port: 0, host: '127.0.0.1' },
    });
  });

  afterAll(async () => {
    await dev.close();
    await previewServer.close();
  });

  const ports = () => ({
    dev: (dev.httpServer?.address() as AddressInfo).port,
    preview: (previewServer.httpServer.address() as AddressInfo).port,
  });

  it.each(['dev', 'preview'] as const)(
    'serves /data/ ahead of the SPA fallback in %s',
    async (which) => {
      const port = ports()[which];
      const range = await request(port, 'GET', '/data/tables/genome.parquet', {
        Range: 'bytes=0-1',
      });
      expect(range.status).toBe(206);
      expect([...range.body]).toEqual([0, 1]);
      const missing = await request(port, 'GET', '/data/missing.json', { Accept: 'text/html' });
      expect(missing.status).toBe(404);
      expect(missing.body.toString()).not.toContain('root');
      const page = await request(port, 'GET', '/genomes/KPN0001', { Accept: 'text/html' });
      expect(page.status).toBe(200);
    },
  );
});
