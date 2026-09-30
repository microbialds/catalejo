// Lazy DuckDB-WASM initializer (requirements §9 and §10; data contract §6).
//
// The engine files and browser workers are loaded from the application's own
// origin under /assets/duckdb-wasm/<package version>/ (see ./engineAssets.ts),
// never from a CDN, and only the mvp and eh bundles are offered to
// selectBundle. Right after the engine starts, the extension repository is set
// to /assets/duckdb-extensions on the same origin, so the parquet and json
// extensions load from there. This module is imported dynamically (see
// ./database.ts) so the engine is fetched only when a page first needs it.
import * as duckdb from '@duckdb/duckdb-wasm';
import {
  configureExtensionRepository,
  engineBundles,
  extensionRepositoryUrl,
} from './engineAssets';

let pending: Promise<duckdb.AsyncDuckDB> | undefined;

async function instantiate(): Promise<duckdb.AsyncDuckDB> {
  const origin = window.location.origin;
  const bundle = await duckdb.selectBundle(engineBundles(origin));
  if (bundle.mainWorker === null) throw new Error('DuckDB bundle without a worker');
  const worker = new Worker(bundle.mainWorker);
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  const connection = await db.connect();
  try {
    await configureExtensionRepository(connection, extensionRepositoryUrl(origin));
  } finally {
    await connection.close();
  }
  return db;
}

/** The single database instance, created on first use. */
export function getDatabase(): Promise<duckdb.AsyncDuckDB> {
  pending ??= instantiate().catch((error: unknown) => {
    pending = undefined;
    throw error;
  });
  return pending;
}
