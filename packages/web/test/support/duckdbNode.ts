// DuckDB-WASM in Node for the tests, with extensions loaded only from the
// local repository (requirements §9). The repository server runs in a child
// process (see extension-repository-server.mjs) because the blocking build
// blocks the event loop while it loads an extension. (The browser build uses
// synchronous XMLHttpRequest inside its worker instead.)
//
// In Node, where XMLHttpRequest is undefined, the blocking build first looks
// for ~/.duckdb/extensions/<host:port>/<engine>/<platform>/<file>, and when the
// file is missing fetches it in a worker thread, waits on Atomics.wait without
// a timeout, and writes it there. Each database opened here therefore gets a
// temporary HOME, so that no stale file hides a request and nothing is written
// to the user's home directory. A fetch that fails outright (a closed port)
// never wakes the waiting thread and hangs the test process, which is why the
// negative test uses a repository that answers 404 instead.
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type * as DuckDBBlocking from '@duckdb/duckdb-wasm/blocking';
import { configureExtensionRepository } from '../../src/data/engineAssets';
import { extensionCacheDir } from '../../vite/duckdbAssets';
import { webRoot } from '../files';

const require = createRequire(import.meta.url);
const serverScript = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'extension-repository-server.mjs',
);

export interface ExtensionRepository {
  /** http://127.0.0.1:<port>, without a trailing slash. */
  url: string;
  /** Every path requested so far, in order. */
  requests(): string[];
  stop(): Promise<void>;
}

/** Starts the child-process repository serving .cache/duckdb-extensions. */
export async function startExtensionRepository(
  root: string = extensionCacheDir(webRoot),
): Promise<ExtensionRepository> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'catalejo-extensions-'));
  const logFile = path.join(tmp, 'requests.log');
  writeFileSync(logFile, '');
  const child: ChildProcess = spawn(process.execPath, [serverScript, root, logFile], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const port = await new Promise<number>((resolve, reject) => {
    let buffered = '';
    child.once('error', reject);
    child.once('exit', (code) => {
      reject(new Error(`extension repository exited with ${String(code)}`));
    });
    child.stdout?.on('data', (chunk: Buffer) => {
      buffered += chunk.toString('utf8');
      const line = buffered.split('\n', 1)[0];
      if (buffered.includes('\n') && line !== undefined) resolve(Number(line));
    });
  });
  return {
    url: `http://127.0.0.1:${String(port)}`,
    requests: () => readFileSync(logFile, 'utf8').split('\n').filter(Boolean),
    stop: async () => {
      if (child.exitCode === null) {
        const exited = new Promise((resolve) => child.once('exit', resolve));
        child.kill('SIGTERM');
        await exited;
      }
      rmSync(tmp, { recursive: true, force: true });
    },
  };
}

export interface NodeDatabase {
  db: DuckDBBlocking.DuckDBBindings;
  conn: DuckDBBlocking.DuckDBConnection;
  query(sql: string): Record<string, unknown>[];
  close(): void;
}

const HOME_VARIABLES = ['HOME', 'USERPROFILE'] as const;
let homeUsers = 0;
let homeDir: string | undefined;
let savedHome: Partial<Record<(typeof HOME_VARIABLES)[number], string>> = {};

/** Points HOME at a temporary directory while any test database is open. */
function acquireTemporaryHome(): () => void {
  if (homeUsers === 0) {
    homeDir = mkdtempSync(path.join(os.tmpdir(), 'catalejo-home-'));
    savedHome = {};
    for (const name of HOME_VARIABLES) {
      const value = process.env[name];
      if (value !== undefined) savedHome[name] = value;
      process.env[name] = homeDir;
    }
  }
  homeUsers += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    homeUsers -= 1;
    if (homeUsers > 0) return;
    for (const name of HOME_VARIABLES) {
      const value = savedHome[name];
      if (value === undefined) Reflect.deleteProperty(process.env, name);
      else process.env[name] = value;
    }
    if (homeDir !== undefined) rmSync(homeDir, { recursive: true, force: true });
    homeDir = undefined;
  };
}

/**
 * A fresh blocking database whose extension repository is `repository`, set
 * through the same function the browser uses.
 */
export async function openNodeDatabase(repository: string): Promise<NodeDatabase> {
  const releaseHome = acquireTemporaryHome();
  const duckdb =
    require('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs') as typeof DuckDBBlocking;
  const dist = path.dirname(require.resolve('@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm'));
  const bundles = {
    mvp: {
      mainModule: path.join(dist, 'duckdb-mvp.wasm'),
      mainWorker: path.join(dist, 'duckdb-node-mvp.worker.cjs'),
    },
    eh: {
      mainModule: path.join(dist, 'duckdb-eh.wasm'),
      mainWorker: path.join(dist, 'duckdb-node-eh.worker.cjs'),
    },
  };
  let db: DuckDBBlocking.DuckDBBindings;
  let conn: DuckDBBlocking.DuckDBConnection;
  try {
    db = await duckdb.createDuckDB(bundles, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME);
    await db.instantiate(() => undefined);
    conn = db.connect();
    await configureExtensionRepository(conn, repository);
  } catch (error) {
    releaseHome();
    throw error;
  }
  return {
    db,
    conn,
    query: (sql) =>
      conn
        .query(sql)
        .toArray()
        .map((row: { toJSON(): Record<string, unknown> }) => row.toJSON()),
    close: () => {
      try {
        conn.close();
        db.reset();
      } finally {
        releaseHome();
      }
    },
  };
}

export function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
