// The release manifest (data contract §6.4) and the schema range this
// application supports (data contract §2). The application reads only the
// manifest at startup, from the same-origin /data/ path; a release whose
// schema_version is outside the range shows the mismatch and nothing else.
//
// Components read the manifest through `useManifestState()` (every status) or
// `useManifest()` (the manifest once ready, else undefined).
import { createContext, createElement, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

export const MANIFEST_URL = '/data/manifest.json';

/** The range of release schema versions this application reads (contract §2). */
export const SUPPORTED_SCHEMA_RANGE = '>=0.1.0 <0.2.0';

export interface ManifestPipeline {
  name: string;
  versions: string[];
}

export interface ManifestSpecies {
  species_code: string;
  canonical_name: string;
  genome_count: number;
  has_pangenome: boolean;
  tree_ids: string[];
  /** Annotation database versions by tool (contract addition pending in milestone 1b). */
  annotation_versions?: Record<string, string[]>;
}

export interface ManifestToolVersion {
  tool: string;
  versions: string[];
  database_versions: string[];
}

export interface ManifestEmbeddingModel {
  model: string;
  model_version: string;
  dim: number;
  genome_count: number;
}

export interface ManifestCuratedSet {
  set_id: string;
  name: string;
  genome_count: number;
}

export interface ManifestFile {
  path: string;
  bytes: number;
  sha256: string;
}

export interface ManifestChecks {
  validated: boolean;
  validated_at: string;
  warnings: number;
}

export interface Manifest {
  schema_version: string;
  release_id: string;
  group_id: string | null;
  created: string;
  platform_name: string;
  pipeline: ManifestPipeline;
  genome_count: number;
  species: ManifestSpecies[];
  tool_versions: ManifestToolVersion[];
  embedding_models: ManifestEmbeddingModel[];
  curated_sets: ManifestCuratedSet[];
  files: ManifestFile[];
  previous_release: string | null;
  release_notes: string | null;
  checks: ManifestChecks;
}

export type ManifestState =
  | { status: 'loading' }
  | { status: 'ready'; manifest: Manifest }
  | { status: 'mismatch'; schemaVersion: string; range: string }
  | { status: 'unavailable' };

// Semantic versions (semver.org §2, §9, §11), enough for the schema check.

interface Version {
  core: [number, number, number];
  prerelease: string[];
}

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(text: string): Version | undefined {
  const match = SEMVER.exec(text.trim());
  if (!match) return undefined;
  const [, major = '', minor = '', patch = '', pre] = match;
  return {
    core: [Number(major), Number(minor), Number(patch)],
    prerelease: pre === undefined ? [] : pre.split('.'),
  };
}

function compareIdentifiers(a: string, b: string): number {
  const numeric = /^\d+$/;
  const aNum = numeric.test(a);
  const bNum = numeric.test(b);
  if (aNum && bNum) return Number(a) - Number(b);
  if (aNum) return -1;
  if (bNum) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareVersions(a: Version, b: Version): number {
  for (let i = 0; i < 3; i += 1) {
    const diff = (a.core[i] ?? 0) - (b.core[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  // A version with a prerelease ranks below the same version without one.
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return Math.sign(b.prerelease.length - a.prerelease.length);
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < length; i += 1) {
    const x = a.prerelease[i];
    const y = b.prerelease[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const diff = compareIdentifiers(x, y);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

const COMPARATOR = /^(>=|<=|>|<|=)?\s*(\S+)$/;

/**
 * Whether a version satisfies a range of space-separated comparators, all of
 * which must hold (">=0.1.0 <0.2.0"). An unparsable version or range fails.
 * As in npm's semver, a prerelease version satisfies a range only when a
 * comparator names a prerelease of the same major.minor.patch, so 0.2.0-rc.1
 * is outside ">=0.1.0 <0.2.0".
 */
export function satisfiesRange(version: string, range: string): boolean {
  const parsed = parseVersion(version);
  if (parsed === undefined) return false;
  const comparators: { operator: string; limit: Version }[] = [];
  for (const text of range.trim().split(/\s+/)) {
    const match = COMPARATOR.exec(text);
    const limit = match ? parseVersion(match[2] ?? '') : undefined;
    if (!match || limit === undefined) return false;
    comparators.push({ operator: match[1] ?? '=', limit });
  }
  if (parsed.prerelease.length > 0) {
    const sameCore = comparators.some(
      ({ limit }) =>
        limit.prerelease.length > 0 && limit.core.every((part, i) => part === parsed.core[i]),
    );
    if (!sameCore) return false;
  }
  return comparators.every(({ operator, limit }) => {
    const order = compareVersions(parsed, limit);
    switch (operator) {
      case '>=':
        return order >= 0;
      case '<=':
        return order <= 0;
      case '>':
        return order > 0;
      case '<':
        return order < 0;
      default:
        return order === 0;
    }
  });
}

export function isSupportedSchema(version: string): boolean {
  return satisfiesRange(version, SUPPORTED_SCHEMA_RANGE);
}

// Structural reading of the manifest. Only the fields the shell relies on are
// checked strictly; the rest are trusted to the release check (contract §9).

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isSpecies(value: unknown): value is ManifestSpecies {
  return (
    isRecord(value) &&
    typeof value.species_code === 'string' &&
    typeof value.canonical_name === 'string' &&
    typeof value.genome_count === 'number' &&
    typeof value.has_pangenome === 'boolean' &&
    isStringArray(value.tree_ids)
  );
}

function isPipeline(value: unknown): value is ManifestPipeline {
  return isRecord(value) && typeof value.name === 'string' && isStringArray(value.versions);
}

/** The manifest from parsed JSON, or undefined when its shape is wrong. */
export function readManifest(json: unknown): Manifest | undefined {
  if (!isRecord(json)) return undefined;
  const ok =
    typeof json.schema_version === 'string' &&
    typeof json.release_id === 'string' &&
    typeof json.genome_count === 'number' &&
    isPipeline(json.pipeline) &&
    Array.isArray(json.species) &&
    json.species.every(isSpecies) &&
    Array.isArray(json.embedding_models) &&
    Array.isArray(json.curated_sets) &&
    Array.isArray(json.tool_versions);
  return ok ? (json as unknown as Manifest) : undefined;
}

/** The manifest state for a parsed manifest document. */
export function manifestStateOf(json: unknown): ManifestState {
  // The schema check comes first: a release of another major schema may have
  // another shape, and the reader must see the mismatch, not a failure.
  if (isRecord(json) && typeof json.schema_version === 'string') {
    if (!isSupportedSchema(json.schema_version)) {
      return {
        status: 'mismatch',
        schemaVersion: json.schema_version,
        range: SUPPORTED_SCHEMA_RANGE,
      };
    }
  }
  const manifest = readManifest(json);
  return manifest === undefined ? { status: 'unavailable' } : { status: 'ready', manifest };
}

export type LoadManifest = () => Promise<ManifestState>;

/** Fetches /data/manifest.json; never rejects. */
export async function loadManifest(fetchImpl: typeof fetch = fetch): Promise<ManifestState> {
  try {
    const response = await fetchImpl(MANIFEST_URL, { headers: { Accept: 'application/json' } });
    if (!response.ok) return { status: 'unavailable' };
    return manifestStateOf(await response.json());
  } catch {
    return { status: 'unavailable' };
  }
}

export const ManifestContext = createContext<ManifestState>({ status: 'loading' });

/** Loads the manifest once and provides its state to the application. */
export function ManifestProvider({
  children,
  load = loadManifest,
}: {
  children: ReactNode;
  load?: LoadManifest;
}) {
  const [state, setState] = useState<ManifestState>({ status: 'loading' });
  useEffect(() => {
    let active = true;
    void load().then((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
    };
  }, [load]);
  return createElement(ManifestContext, { value: state }, children);
}

export function useManifestState(): ManifestState {
  return useContext(ManifestContext);
}

/** The manifest once loaded and supported, else undefined. */
export function useManifest(): Manifest | undefined {
  const state = useContext(ManifestContext);
  return state.status === 'ready' ? state.manifest : undefined;
}
