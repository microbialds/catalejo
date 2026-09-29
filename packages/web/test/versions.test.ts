// CLAUDE.md, Toolchain pins: the package pins equal config/versions.yaml.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { repoRoot, webRoot } from './files';

interface Versions {
  node: string;
  duckdb_wasm_npm: string;
  duckdb_engine_minor: string;
}

interface PackageJson {
  version: string;
  engines?: { node?: string };
  dependencies?: Record<string, string>;
}

const versions = parse(
  readFileSync(path.join(repoRoot, 'config', 'versions.yaml'), 'utf8'),
) as Versions;
const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as PackageJson;
const pkg = readJson(path.join(webRoot, 'package.json'));

describe('versions', () => {
  it('pins @duckdb/duckdb-wasm exactly to versions.yaml', () => {
    expect(pkg.dependencies?.['@duckdb/duckdb-wasm']).toBe(versions.duckdb_wasm_npm);
    const installed = readJson(
      path.join(webRoot, 'node_modules', '@duckdb', 'duckdb-wasm', 'package.json'),
    );
    expect(installed.version).toBe(versions.duckdb_wasm_npm);
  });

  it('runs on the Node major of versions.yaml', () => {
    expect(pkg.engines?.node).toBe(`>=${versions.node} <${String(Number(versions.node) + 1)}`);
    expect(process.versions.node.split('.')[0]).toBe(versions.node);
  });

  it('has a .node-version at the repository root matching versions.yaml', () => {
    const file = path.join(repoRoot, '.node-version');
    if (!existsSync(file)) return;
    expect(readFileSync(file, 'utf8').trim().startsWith(versions.node)).toBe(true);
  });
});
