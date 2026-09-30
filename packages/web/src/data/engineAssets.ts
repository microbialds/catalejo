// Same-origin locations of the DuckDB-WASM engine and its extensions
// (requirements §9, no request leaves the origin; §10, Cloudflare Pages).
//
// The engine files exceed the Pages limit of 25 MiB per file, so they are not
// part of the build. In production a Pages Function serves them from the R2
// bucket under /assets/duckdb-wasm/<package version>/, and in development the
// Vite plugin in vite/duckdbAssets.ts serves the same paths from node_modules.
// Extensions (parquet, json) come from the repository at
// /assets/duckdb-extensions/, laid out as DuckDB expects,
// v<engine>/<platform>/<name>.duckdb_extension.wasm. This module imports no
// engine code, so the browser and the Node tests share it.
import type { DuckDBBundles } from '@duckdb/duckdb-wasm';

/** The installed @duckdb/duckdb-wasm version, injected by vite.config.ts. */
export const DUCKDB_WASM_VERSION: string = __DUCKDB_WASM_VERSION__;

/** The directory of the engine files for this build. */
export const DUCKDB_WASM_PATH = `/assets/duckdb-wasm/${DUCKDB_WASM_VERSION}/`;

/** The extension repository path, without a trailing slash as DuckDB expects. */
export const DUCKDB_EXTENSIONS_PATH = '/assets/duckdb-extensions';

/**
 * The two bundles offered to selectBundle. The coi (threads) bundle is left
 * out because the application does not use cross-origin isolation.
 */
export function engineBundles(origin: string): DuckDBBundles {
  const file = (name: string) => new URL(`${DUCKDB_WASM_PATH}${name}`, origin).href;
  return {
    mvp: {
      mainModule: file('duckdb-mvp.wasm'),
      mainWorker: file('duckdb-browser-mvp.worker.js'),
    },
    eh: {
      mainModule: file('duckdb-eh.wasm'),
      mainWorker: file('duckdb-browser-eh.worker.js'),
    },
  };
}

/** The extension repository URL for an origin. */
export function extensionRepositoryUrl(origin: string): string {
  return new URL(DUCKDB_EXTENSIONS_PATH, origin).href;
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * The statements that make every extension install and autoload come from
 * `repository` and from nowhere else. Community extensions are disabled last,
 * after the repositories are set.
 */
export function extensionRepositoryStatements(repository: string): string[] {
  return [
    `SET custom_extension_repository = ${sqlString(repository)}`,
    `SET autoinstall_extension_repository = ${sqlString(repository)}`,
    'SET allow_community_extensions = false',
  ];
}

/** The part of a connection this module needs: AsyncDuckDB or blocking. */
export interface StatementRunner {
  query(sql: string): unknown;
}

/** Runs the extension repository statements on a connection. */
export async function configureExtensionRepository(
  connection: StatementRunner,
  repository: string,
): Promise<void> {
  for (const statement of extensionRepositoryStatements(repository)) {
    await connection.query(statement);
  }
}
