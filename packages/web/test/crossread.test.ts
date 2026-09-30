// Parquet cross-read (requirements §13; CLAUDE.md, Toolchain pins). The ingest
// package writes tests/fixtures/crossread.parquet with DuckDB Python and the
// values it wrote to crossread.expected.json; this test reads the file with
// the pinned @duckdb/duckdb-wasm in Node and requires every type and value to
// match. It also requires the wasm engine and the writer named in the Parquet
// footer to share the DuckDB major.minor of config/versions.yaml, so a
// version drift in either package fails. The parquet extension comes from the
// local repository (.cache/duckdb-extensions) through the same settings the
// browser uses, so the test makes no request outside this machine.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { repoRoot } from './files';
import {
  type ExtensionRepository,
  type NodeDatabase,
  openNodeDatabase,
  sqlString,
  startExtensionRepository,
} from './support/duckdbNode';

interface Expected {
  writer: { duckdb_version: string };
  columns: { name: string; duckdb_type: string }[];
  rows: Record<string, unknown>[];
}

// CATALEJO_CROSSREAD_DIR points the test at another fixture directory.
const fixtureDir = process.env.CATALEJO_CROSSREAD_DIR ?? path.join(repoRoot, 'tests', 'fixtures');
const parquetFile = path.join(fixtureDir, 'crossread.parquet');
const expectedFile = path.join(fixtureDir, 'crossread.expected.json');
const versions = parse(readFileSync(path.join(repoRoot, 'config', 'versions.yaml'), 'utf8')) as {
  duckdb_engine_minor: string;
  duckdb_extensions: { engine: string; platforms: string[]; names: string[] };
};

function majorMinor(text: string): string | undefined {
  const match = /v?(\d+)\.(\d+)\.\d+/.exec(text);
  return match ? `${match[1] ?? ''}.${match[2] ?? ''}` : undefined;
}

interface ArrowVector {
  toArray(): ArrayLike<unknown>;
}

function isVector(value: unknown): value is ArrowVector {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<ArrowVector>).toArray === 'function'
  );
}

/** A value read through Arrow, in the encoding of crossread.expected.json. */
function normalize(value: unknown, duckdbType: string): unknown {
  if (value === null || value === undefined) return null;
  if (duckdbType.endsWith('[]')) {
    if (!isVector(value)) throw new Error(`expected a list for ${duckdbType}`);
    const element = duckdbType.slice(0, -2);
    return Array.from(value.toArray(), (item) => normalize(item, element));
  }
  switch (duckdbType) {
    case 'BIGINT':
      if (typeof value !== 'bigint') throw new Error('BIGINT must arrive as bigint');
      return value.toString();
    case 'DATE':
      if (typeof value !== 'number') throw new Error('DATE must arrive as milliseconds');
      return new Date(value).toISOString().slice(0, 10);
    default:
      return value;
  }
}

describe('Parquet cross-read with @duckdb/duckdb-wasm', () => {
  let repository: ExtensionRepository | undefined;
  let database: NodeDatabase | undefined;

  beforeAll(async () => {
    repository = await startExtensionRepository();
    database = await openNodeDatabase(repository.url);
  });

  afterAll(async () => {
    database?.close();
    await repository?.stop();
  });

  function query(sql: string): Record<string, unknown>[] {
    if (!database) throw new Error('DuckDB did not start');
    return database.query(sql);
  }

  it('finds the fixture written by the ingest package', () => {
    expect(existsSync(parquetFile), `${parquetFile} is missing; run the ingest tests`).toBe(true);
    expect(existsSync(expectedFile), `${expectedFile} is missing; run the ingest tests`).toBe(true);
  });

  it('runs the DuckDB engine minor of config/versions.yaml', () => {
    const [row] = query('SELECT version() AS v');
    expect(majorMinor(String(row?.v))).toBe(versions.duckdb_engine_minor);
  });

  describe('fixture', () => {
    const load = (): Expected => JSON.parse(readFileSync(expectedFile, 'utf8')) as Expected;
    const source = () => `read_parquet(${sqlString(parquetFile)})`;

    it('was written by the same DuckDB major.minor', () => {
      const expected = load();
      expect(majorMinor(expected.writer.duckdb_version)).toBe(versions.duckdb_engine_minor);
      const [meta] = query(
        `SELECT created_by FROM parquet_file_metadata(${sqlString(parquetFile)})`,
      );
      const createdBy = String(meta?.created_by);
      expect(createdBy).toMatch(/DuckDB/i);
      expect(majorMinor(createdBy)).toBe(versions.duckdb_engine_minor);
    });

    it('has the column names and types that were written', () => {
      const expected = load();
      const described = query(`DESCRIBE SELECT * FROM ${source()}`).map((row) => ({
        name: row.column_name,
        duckdb_type: row.column_type,
      }));
      expect(described).toEqual(expected.columns);
    });

    it('reads every value exactly as written', () => {
      const expected = load();
      const rows = query(`SELECT * FROM ${source()}`);
      expect(rows).toHaveLength(expected.rows.length);
      expected.rows.forEach((expectedRow, index) => {
        const row = rows[index] ?? {};
        for (const column of expected.columns) {
          const where = `row ${String(index)}, ${column.name} (${column.duckdb_type})`;
          const actual = normalize(row[column.name], column.duckdb_type);
          const want = expectedRow[column.name] ?? null;
          if (column.duckdb_type === 'BIGINT' && want !== null) {
            expect(typeof actual, where).toBe('string');
            expect(BigInt(actual as string), where).toBe(BigInt(want as string));
          } else {
            expect(actual, where).toEqual(want);
          }
        }
      });
    });
  });

  it('loaded extensions from the local repository only', () => {
    const { engine, platforms, names } = versions.duckdb_extensions;
    const allowed = platforms.flatMap((platform) =>
      names.map((name) => `/${engine}/${platform}/${name}.duckdb_extension.wasm`),
    );
    const requests = repository?.requests() ?? [];
    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) expect(allowed).toContain(request);
  });
});
