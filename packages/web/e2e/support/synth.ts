// The synthetic release on disk, read in Node for the expected values of the
// Playwright tests (requirements §13): the manifest as JSON, and DuckDB-WASM's
// blocking Node build over the release's Parquet files, opened through the
// same helpers the component tests use (test/support/duckdbNode.ts). The
// Vite `define` that names the engine version does not exist under the
// Playwright runner, so it is set here before the helpers are imported.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { duckdbWasmVersion } from '../../vite/duckdbAssets';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const synthDir = path.resolve(webRoot, '..', '..', 'releases', 'synth');

export interface SynthSpecies {
  species_code: string;
  canonical_name: string;
  genome_count: number;
  has_pangenome: boolean;
  tree_ids: string[];
  annotation_versions?: { bakta?: string[]; amrfinderplus?: string[] };
}

export interface SynthManifest {
  release_id: string;
  genome_count: number;
  pipeline: { name: string; versions: string[] };
  species: SynthSpecies[];
  curated_sets: { set_id: string; name: string; genome_count: number }[];
  embedding_models: unknown[];
}

export const manifest = JSON.parse(
  readFileSync(path.join(synthDir, 'manifest.json'), 'utf8'),
) as SynthManifest;

export function species(code: string): SynthSpecies {
  const found = manifest.species.find((row) => row.species_code === code);
  if (found === undefined) throw new Error(`species ${code} is not in the synthetic release`);
  return found;
}

/** `read_parquet('<absolute path>')` for a release file. */
export function parquet(relative: string): string {
  return `read_parquet('${path.join(synthDir, relative).replace(/'/g, "''")}')`;
}

export interface SynthDatabase {
  rows(sql: string): Record<string, unknown>[];
  /** The first row with every value as a number. */
  numbers(sql: string): Record<string, number>;
  close(): Promise<void>;
}

/** A Node DuckDB over the synthetic release; close it in afterAll. */
export async function openSynthDatabase(): Promise<SynthDatabase> {
  (globalThis as { __DUCKDB_WASM_VERSION__?: string }).__DUCKDB_WASM_VERSION__ =
    duckdbWasmVersion(webRoot);
  // Imported after the global exists: engineAssets.ts reads it on evaluation.
  const { openNodeDatabase, startExtensionRepository } =
    await import('../../test/support/duckdbNode');
  const repository = await startExtensionRepository();
  const database = await openNodeDatabase(repository.url);
  const rows = (sql: string) => database.query(sql);
  return {
    rows,
    numbers: (sql) =>
      Object.fromEntries(
        Object.entries(rows(sql)[0] ?? {}).map(([key, value]) => [key, Number(value)]),
      ),
    close: async () => {
      database.close();
      await repository.stop();
    },
  };
}
