// A release source (src/data/release.ts) over the Node engine and a release
// directory on disk, so the set engine and the predicate run in the tests
// exactly as in the browser, against releases/synth by default.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { readManifest } from '../../src/data/manifest';
import type { Manifest } from '../../src/data/manifest';
import { arrowRows, assertSingleFile, sqlString } from '../../src/data/release';
import type { ArrowTableLike, ReleaseSource } from '../../src/data/release';
import { repoRoot } from '../files';
import type { NodeDatabase } from './duckdbNode';

export const synthDir = path.join(repoRoot, 'releases', 'synth');

export function synthFile(relative: string): string {
  return path.join(synthDir, relative);
}

export function hasSynthFile(relative: string): boolean {
  return existsSync(synthFile(relative));
}

/** The manifest of the release on disk. */
export function readSynthManifest(): Manifest {
  const manifest = readManifest(JSON.parse(readFileSync(synthFile('manifest.json'), 'utf8')));
  if (manifest === undefined) throw new Error(`${synthDir}/manifest.json is not a manifest`);
  return manifest;
}

/** `read_parquet('<absolute path>')` for a release file. */
export function parquet(relative: string): string {
  return `read_parquet(${sqlString(synthFile(relative))})`;
}

export function nodeSource(database: NodeDatabase): ReleaseSource {
  return {
    has: (relative) => hasSynthFile(relative),
    relation: async (relative) => {
      await Promise.resolve();
      assertSingleFile(relative);
      return parquet(relative);
    },
    query: (sql) =>
      Promise.resolve(arrowRows(database.conn.query(sql) as unknown as ArrowTableLike)),
  };
}
