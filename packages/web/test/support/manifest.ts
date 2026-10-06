// Manifest fixtures for component tests (data contract §6.4). The default
// mirrors the synthetic release: no trees, pangenomes or embedding models.
import type { Manifest, ManifestState } from '../../src/data/manifest';

export function manifestFixture(overrides: Partial<Manifest> = {}): Manifest {
  return {
    schema_version: '0.1.0',
    release_id: 'synth',
    group_id: null,
    created: '2026-09-30T22:36:24Z',
    platform_name: 'Catalejo',
    pipeline: { name: 'gene2dis/mgap', versions: ['2.0.0'] },
    genome_count: 100,
    species: [
      {
        species_code: 'KPN',
        canonical_name: 'Klebsiella pneumoniae',
        genome_count: 28,
        has_pangenome: false,
        tree_ids: [],
      },
      {
        species_code: 'ECO',
        canonical_name: 'Escherichia coli',
        genome_count: 8,
        has_pangenome: false,
        tree_ids: [],
      },
    ],
    tool_versions: [],
    embedding_models: [],
    curated_sets: [{ set_id: 'index-isolate', name: 'Index isolate', genome_count: 1 }],
    files: [],
    previous_release: null,
    release_notes: null,
    checks: { validated: true, validated_at: '2026-09-30T22:36:24Z', warnings: 0 },
    ...overrides,
  };
}

/** A manifest declaring a tree, a pangenome and an embedding model. */
export function manifestWithProducts(overrides: Partial<Manifest> = {}): Manifest {
  const base = manifestFixture();
  return manifestFixture({
    release_id: '2026-09',
    genome_count: 4812,
    species: base.species.map((species, index) =>
      index === 0 ? { ...species, has_pangenome: true, tree_ids: ['KPN-core-2026-09'] } : species,
    ),
    embedding_models: [{ model: 'bacformer', model_version: '1.0', dim: 1024, genome_count: 4812 }],
    ...overrides,
  });
}

export function ready(manifest: Manifest): ManifestState {
  return { status: 'ready', manifest };
}
