// Access to the release files (data contract §6). Every table and summary is
// read from the same-origin /data/ path (requirements §10): the manifest at
// /data/manifest.json and every other file at /data/r/<release_id>/<path>,
// with the release_id of the manifest the application loaded. A file is
// registered once per database as an HTTP file, which DuckDB-WASM reads with
// range requests, and queried as `read_parquet('<path>')`. When a query fails,
// the source asks ./releaseChange.ts whether the release is still current, so
// that a reader whose release was replaced is asked to reload.
//
// Partitioned tables are reached only through `speciesTable`, which takes
// exactly one species code; nothing in the application scans `feature`
// across species (contract §6.1, requirements §9), and `relation` refuses a
// path that would.
//
// The engine code is imported dynamically here, so that importing this
// module does not pull DuckDB-WASM into the first bundle.
import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';
import type { Manifest } from './manifest';
import { checkRelease } from './releaseChange';

export const DATA_PREFIX = '/data/';

/** The only release file requested outside the release scope. */
export const MANIFEST_DATA_URL = `${DATA_PREFIX}manifest.json`;

/** The first segment of the release-scoped paths, /data/r/<release_id>/<path>. */
export const RELEASE_SCOPE = 'r';

function encodedSegments(path: string): string[] {
  return path
    .split('/')
    .filter((segment) => segment !== '')
    .map((segment) => encodeURIComponent(segment));
}

/** /data/r/<release_id>/<path>, segments percent-encoded, for any file. */
export function releaseFileUrl(path: string, releaseId: string): string {
  const scope = [RELEASE_SCOPE, encodeURIComponent(releaseId)];
  return `${DATA_PREFIX}${[...scope, ...encodedSegments(path)].join('/')}`;
}

/**
 * The same-origin URL path the application requests a release file at
 * (requirements §10): /data/manifest.json for the manifest, and
 * /data/r/<release_id>/<path> for every other file.
 */
export function dataUrl(path: string, releaseId: string): string {
  const segments = encodedSegments(path);
  if (segments.length === 1 && segments[0] === 'manifest.json') return MANIFEST_DATA_URL;
  return releaseFileUrl(path, releaseId);
}

/** Tables written as one file per species (contract §6.1). */
export type PartitionedTable =
  'contig' | 'feature' | 'annotation_hit' | 'region' | 'pangenome_cluster' | 'cluster_membership';

const SPECIES_CODE = /^[A-Z]{3,5}$/;

export class CrossSpeciesScanError extends Error {
  constructor(what: string) {
    super(`${what}: partitioned tables are read one species at a time (data contract §6.1)`);
    this.name = 'CrossSpeciesScanError';
  }
}

/**
 * The path of one species' partition of a table. Throws unless exactly one
 * valid species code is given.
 */
export function speciesTable(table: PartitionedTable, speciesCode: string): string {
  const code: unknown = speciesCode;
  if (typeof code !== 'string' || !SPECIES_CODE.test(code)) {
    throw new CrossSpeciesScanError(`${table} without one species code`);
  }
  return `tables/${table}/${code}.parquet`;
}

const PARTITIONED =
  /^tables\/(contig|feature|annotation_hit|region|pangenome_cluster|cluster_membership)\//;
const ONE_PARTITION =
  /^tables\/(contig|feature|annotation_hit|region|pangenome_cluster|cluster_membership)\/[A-Z]{3,5}\.parquet$/;

/** Throws for a path that is a glob, a directory, or more than one partition. */
export function assertSingleFile(path: string): void {
  if (/[*?[\]{}]/.test(path) || path.endsWith('/') || path.includes('..')) {
    throw new CrossSpeciesScanError(`${path} is not one file`);
  }
  if (PARTITIONED.test(path) && !ONE_PARTITION.test(path)) {
    throw new CrossSpeciesScanError(path);
  }
}

/** A SQL string literal. */
export function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** A SQL quoted identifier, for column names such as aac(6')-Ib-cr5. */
export function sqlIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export type Row = Record<string, unknown>;

interface ArrowVectorLike {
  toArray(): ArrayLike<unknown>;
}

interface ArrowRowLike {
  toJSON(): Row;
}

export interface ArrowTableLike {
  toArray(): ArrayLike<unknown>;
}

function isVector(value: unknown): value is ArrowVectorLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<ArrowVectorLike>).toArray === 'function'
  );
}

/** A value read through Arrow as plain JavaScript. */
export function plainValue(value: unknown): unknown {
  if (typeof value === 'bigint') {
    const small = Number(value);
    return Number.isSafeInteger(small) ? small : value;
  }
  if (value instanceof Uint8Array) return value;
  if (isVector(value)) return Array.from(value.toArray(), plainValue);
  if (typeof value === 'object' && value !== null) {
    const json = (value as Partial<ArrowRowLike>).toJSON;
    if (typeof json === 'function') return plainRow(json.call(value));
  }
  return value;
}

function plainRow(row: Row): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) out[key] = plainValue(value);
  return out;
}

/** Plain rows from an Arrow table; BIGINT values become numbers when safe. */
export function arrowRows(table: ArrowTableLike): Row[] {
  return Array.from(table.toArray(), (row) => plainRow((row as ArrowRowLike).toJSON()));
}

/**
 * The order of queued queries: high (the default) before low. The facet
 * rail's counts are high; the genome table's page and the QC points, which
 * render behind them, are low (requirements §6.1, §9; checklist C4).
 */
export type QueryPriority = 'high' | 'low';

/**
 * The part of a release the set engine and the search read: SQL over
 * registered files. The browser implementation is `createBrowserSource`; the
 * tests build one over the Node engine.
 */
export interface ReleaseSource {
  /** Whether the release includes a file (manifest `files`, contract §6.4). */
  has(path: string): boolean;
  /** The SQL relation for a release file, `read_parquet('<name>')`. */
  relation(path: string): Promise<string>;
  /**
   * Rows of a query, with BIGINT values as numbers where safe. A low-priority
   * query waits until no high-priority query is queued.
   */
  query(sql: string, priority?: QueryPriority): Promise<Row[]>;
}

const registered = new WeakMap<AsyncDuckDB, Map<string, Promise<string>>>();

/**
 * Registers a release file with the database once, at its URL in the release
 * `releaseId`, and returns its relation, `read_parquet('<path>')`.
 */
export function openParquet(
  db: AsyncDuckDB,
  path: string,
  releaseId: string,
  origin?: string,
): Promise<string> {
  try {
    assertSingleFile(path);
  } catch (error) {
    return Promise.reject(
      error instanceof Error ? error : new CrossSpeciesScanError(String(error)),
    );
  }
  let files = registered.get(db);
  if (files === undefined) {
    files = new Map();
    registered.set(db, files);
  }
  const known = files.get(path);
  if (known !== undefined) return known;
  const base = origin ?? window.location.origin;
  const pending = (async () => {
    const { DuckDBDataProtocol } = await import('@duckdb/duckdb-wasm');
    const url = new URL(dataUrl(path, releaseId), base).href;
    await db.registerFileURL(path, url, DuckDBDataProtocol.HTTP, false);
    return `read_parquet(${sqlString(path)})`;
  })();
  files.set(path, pending);
  pending.catch(() => files.delete(path));
  return pending;
}

export interface BrowserSourceOptions {
  /**
   * Called with the error of a failed read; by default, checks whether the
   * manifest's release is still current (./releaseChange.ts).
   */
  onReadError?: (error: unknown) => void;
}

/** A release source over the browser database for a manifest's release. */
export function createBrowserSource(
  db: AsyncDuckDB,
  manifest: Manifest,
  options: BrowserSourceOptions = {},
): ReleaseSource {
  const files = new Set(manifest.files.map((file) => file.path));
  const onReadError =
    options.onReadError ??
    (() => {
      void checkRelease(manifest.release_id);
    });
  let connection: Promise<AsyncDuckDBConnection> | undefined;
  // DuckDB runs one statement at a time per connection. Queries wait in two
  // first-in first-out queues, and the next one is taken from the high queue
  // while it holds any. Statements that create tables are high and are
  // awaited before the queries that read them are issued.
  const queues: Record<QueryPriority, (() => Promise<void>)[]> = { high: [], low: [] };
  let running = false;
  const drain = async () => {
    if (running) return;
    running = true;
    for (;;) {
      const next = queues.high.shift() ?? queues.low.shift();
      if (next === undefined) break;
      await next();
    }
    running = false;
  };
  return {
    has: (path) => files.has(path),
    relation: (path) =>
      openParquet(db, path, manifest.release_id).catch((error: unknown) => {
        if (!(error instanceof CrossSpeciesScanError)) onReadError(error);
        throw error;
      }),
    query: (sql, priority = 'high') =>
      new Promise<Row[]>((resolve, reject) => {
        queues[priority].push(async () => {
          try {
            connection ??= db.connect();
            resolve(arrowRows(await (await connection).query(sql)));
          } catch (error) {
            onReadError(error);
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        });
        void drain();
      }),
  };
}
