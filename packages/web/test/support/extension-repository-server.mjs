// A DuckDB extension repository for the Node tests, run as a child process.
//
// The blocking build of duckdb-wasm loads an extension in Node by fetching it
// in a worker thread while the main thread waits on Atomics.wait, which blocks
// the test's event loop, so a server in the same process could never answer. This script serves <root> on an ephemeral
// 127.0.0.1 port, prints the port on its first stdout line, and appends every
// requested path to <logFile>, one per line.
//
// Usage: node extension-repository-server.mjs <root> <logFile>
import { Buffer } from 'node:buffer';
import { appendFileSync, createReadStream, realpathSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const [rootArg, logFile] = process.argv.slice(2);
if (rootArg === undefined || logFile === undefined) {
  console.error('usage: extension-repository-server.mjs <root> <logFile>');
  process.exit(2);
}
const root = realpathSync(rootArg);

/**
 * @param {string} pathname
 * @returns {string | undefined}
 */
function resolveFile(pathname) {
  let relative;
  try {
    relative = decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    return undefined;
  }
  const file = path.resolve(root, relative);
  const inside = path.relative(root, file);
  if (inside === '' || inside.startsWith('..') || path.isAbsolute(inside)) return undefined;
  try {
    return statSync(file).isFile() ? file : undefined;
  } catch {
    return undefined;
  }
}

const server = http.createServer((req, res) => {
  const pathname = (req.url ?? '').split(/[?#]/, 1)[0] ?? '';
  appendFileSync(logFile, `${pathname}\n`);
  const file = req.method === 'GET' || req.method === 'HEAD' ? resolveFile(pathname) : undefined;
  if (file === undefined) {
    // A 404 with a body. The blocking build's Node loader copies the answer
    // into a shared buffer and waits forever when the body is empty.
    const body = Buffer.from('not found\n');
    res.writeHead(404, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Length': String(body.length),
    });
    res.end(req.method === 'HEAD' ? undefined : body);
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'application/wasm',
    'Content-Length': String(statSync(file).size),
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (address === null || typeof address === 'string') process.exit(1);
  process.stdout.write(`${String(address.port)}\n`);
});

process.on('SIGTERM', () => {
  server.close();
  process.exit(0);
});
