// DuckDB extensions come only from the platform's own repository
// (requirements §9, no request leaves the origin; config/versions.yaml,
// duckdb_extensions). The engine is pointed at a local repository serving
// .cache/duckdb-extensions through the function the browser uses, reads a
// Parquet file, and must request exactly one file, the parquet extension for
// its platform, from that repository and nothing from anywhere else.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { extensionRepositoryStatements } from '../src/data/engineAssets';
import { repoRoot } from './files';
import {
  type ExtensionRepository,
  type NodeDatabase,
  openNodeDatabase,
  sqlString,
  startExtensionRepository,
} from './support/duckdbNode';

const versions = parse(readFileSync(path.join(repoRoot, 'config', 'versions.yaml'), 'utf8')) as {
  duckdb_extensions: { engine: string; platforms: string[] };
};
const parquetFile = path.join(repoRoot, 'tests', 'fixtures', 'crossread.parquet');
const expected = JSON.parse(
  readFileSync(path.join(repoRoot, 'tests', 'fixtures', 'crossread.expected.json'), 'utf8'),
) as { rows: unknown[] };

describe('extensionRepositoryStatements', () => {
  it('sets both repositories and disables community extensions', () => {
    expect(extensionRepositoryStatements("http://host/it's")).toEqual([
      "SET custom_extension_repository = 'http://host/it''s'",
      "SET autoinstall_extension_repository = 'http://host/it''s'",
      'SET allow_community_extensions = false',
    ]);
  });
});

describe('Parquet with the extension from the local repository', () => {
  let repository: ExtensionRepository;
  let database: NodeDatabase;

  beforeAll(async () => {
    repository = await startExtensionRepository();
    database = await openNodeDatabase(repository.url);
  });

  afterAll(async () => {
    database.close();
    await repository.stop();
  });

  it('applies the repository settings', () => {
    const [row] = database.query(
      `SELECT current_setting('custom_extension_repository') AS custom,
              current_setting('autoinstall_extension_repository') AS autoinstall,
              current_setting('allow_community_extensions') AS community`,
    );
    expect(row).toEqual({ custom: repository.url, autoinstall: repository.url, community: false });
  });

  it('reads the fixture and loads parquet from the local repository only', () => {
    const rows = database.query(`SELECT * FROM read_parquet(${sqlString(parquetFile)})`);
    expect(rows).toHaveLength(expected.rows.length);

    const [loaded] = database.query(
      "SELECT loaded FROM duckdb_extensions() WHERE extension_name = 'parquet'",
    );
    // DuckDB-WASM loads an extension straight from the repository without
    // installing it, so only `loaded` is checked.
    expect(loaded).toEqual({ loaded: true });

    const [platform] = database.query('SELECT platform FROM pragma_platform()');
    const name = String(platform?.platform);
    expect(versions.duckdb_extensions.platforms).toContain(name);
    expect(repository.requests()).toEqual([
      `/${versions.duckdb_extensions.engine}/${name}/parquet.duckdb_extension.wasm`,
    ]);
  });
});

describe('a repository without the extension', () => {
  // The negative case uses a local repository that answers 404 for every
  // file. A closed port would be the plainer test, but the blocking build
  // then waits forever (see support/duckdbNode.ts), so it is not used.
  let empty: string;
  let repository: ExtensionRepository;

  beforeAll(async () => {
    empty = mkdtempSync(path.join(os.tmpdir(), 'catalejo-empty-repository-'));
    repository = await startExtensionRepository(empty);
  });

  afterAll(async () => {
    await repository.stop();
    rmSync(empty, { recursive: true, force: true });
  });

  it('makes read_parquet fail after asking only the local repository', async () => {
    const database = await openNodeDatabase(repository.url);
    try {
      const started = Date.now();
      expect(() =>
        database.query(`SELECT count(*) FROM read_parquet(${sqlString(parquetFile)})`),
      ).toThrow(/parquet/i);
      expect(Date.now() - started).toBeLessThan(10_000);
      const requests = repository.requests();
      expect(requests.length).toBeGreaterThan(0);
      const allowed = versions.duckdb_extensions.platforms.map(
        (platform) =>
          `/${versions.duckdb_extensions.engine}/${platform}/parquet.duckdb_extension.wasm`,
      );
      for (const request of requests) expect(allowed).toContain(request);
    } finally {
      database.close();
    }
  });
});
