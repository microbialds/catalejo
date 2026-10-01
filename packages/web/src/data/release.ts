// Access to the release files (data contract §6). Every table and summary is
// read from the same-origin /data/ path (requirements §10): a file is
// registered once per database as an HTTP file, which DuckDB-WASM reads with
// range requests, and queried as `read_parquet('<path>')`.
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

export const DATA_PREFIX = '/data/';

/** The same-origin URL path of a release file, segments percent-encoded. */
export function dataUrl(path: string): string {
  const segments = path.split('/').filter((segment) => segment !== '');
  return `${DATA_PREFIX}${segments.map((segment) => encodeURIComponent(segment)).join('/')}`;
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
 * The part of a release the set engine and the search read: SQL over
 * registered files. The browser implementation is `createBrowserSource`; the
 * tests build one over the Node engine.
 */
export interface ReleaseSource {
  /** Whether the release includes a file (manifest `files`, contract §6.4). */
  has(path: string): boolean;
  /** The SQL relation for a release file, `read_parquet('<name>')`. */
  relation(path: string): Promise<string>;
  /** Rows of a query, with BIGINT values as numbers where safe. */
  query(sql: string): Promise<Row[]>;
}

const registered = new WeakMap<AsyncDuckDB, Map<string, Promise<string>>>();

/**
 * Registers a release file with the database once and returns its relation,
 * `read_parquet('<path>')`.
 */
export function openParquet(db: AsyncDuckDB, path: string, origin?: string): Promise<string> {
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
    const url = new URL(dataUrl(path), base).href;
    await db.registerFileURL(path, url, DuckDBDataProtocol.HTTP, false);
    return `read_parquet(${sqlString(path)})`;
  })();
  files.set(path, pending);
  pending.catch(() => files.delete(path));
  return pending;
}

/** A release source over the browser database for a manifest's release. */
export function createBrowserSource(db: AsyncDuckDB, manifest: Manifest): ReleaseSource {
  const files = new Set(manifest.files.map((file) => file.path));
  let connection: Promise<AsyncDuckDBConnection> | undefined;
  // DuckDB runs one statement at a time per connection; chaining keeps the
  // order of statements that create tables before the queries that read them.
  let queue: Promise<unknown> = Promise.resolve();
  return {
    has: (path) => files.has(path),
    relation: (path) => openParquet(db, path),
    query: (sql) => {
      const run = async () => {
        connection ??= db.connect();
        const table = await (await connection).query(sql);
        return arrowRows(table);
      };
      const result = queue.then(run, run);
      queue = result.catch(() => undefined);
      return result;
    },
  };
}
