// Requirements §5.6 and data contract §6.4: the annotation version warning is
// the union of the Bakta and AMRFinderPlus database versions over the species
// of the set, shown when either tool has more than one version.
import { describe, expect, it } from 'vitest';
import { annotationVersionWarning } from '../src/data/annotationVersions';
import { manifestFixture } from './support/manifest';
import { hasSynthFile, readSynthManifest } from './support/releaseSource';

const manifest = manifestFixture({
  species: [
    {
      species_code: 'KPN',
      canonical_name: 'Klebsiella pneumoniae',
      genome_count: 28,
      has_pangenome: false,
      tree_ids: [],
      annotation_versions: { amrfinderplus: ['2025-12-03.1'], bakta: ['6.0'] },
    },
    {
      species_code: 'SEN',
      canonical_name: 'Salmonella enterica',
      genome_count: 19,
      has_pangenome: false,
      tree_ids: [],
      annotation_versions: {
        amrfinderplus: ['2024-07-22.1', '2025-12-03.1'],
        bakta: ['5.1', '6.0'],
      },
    },
    {
      species_code: 'ECO',
      canonical_name: 'Escherichia coli',
      genome_count: 8,
      has_pangenome: false,
      tree_ids: [],
      annotation_versions: { amrfinderplus: ['2024-07-22.1'], bakta: [] },
    },
  ],
});

describe('annotation version warning', () => {
  it('warns for SEN alone with two versions of each database', () => {
    expect(annotationVersionWarning(manifest, ['SEN'])).toEqual({
      amrfinderplus: ['2024-07-22.1', '2025-12-03.1'],
      bakta: ['5.1', '6.0'],
    });
  });

  it('does not warn for KPN alone', () => {
    expect(annotationVersionWarning(manifest, ['KPN'])).toBeNull();
  });

  it('warns when single-version species differ', () => {
    expect(annotationVersionWarning(manifest, ['KPN', 'ECO'])).toEqual({
      amrfinderplus: ['2024-07-22.1', '2025-12-03.1'],
      bakta: ['6.0'],
    });
  });

  it('does not warn for species without versions or unknown species', () => {
    expect(annotationVersionWarning(manifestFixture(), ['KPN', 'ECO'])).toBeNull();
    expect(annotationVersionWarning(manifest, ['XYZ'])).toBeNull();
  });

  it('reads the synthetic release manifest when it carries the versions', () => {
    const synth = hasSynthFile('manifest.json') ? readSynthManifest() : undefined;
    const sen = synth?.species.find((species) => species.species_code === 'SEN');
    if (synth === undefined || sen?.annotation_versions === undefined) {
      console.warn('skipped: releases/synth/manifest.json has no annotation_versions yet');
      return;
    }
    const warning = annotationVersionWarning(synth, ['SEN']);
    expect(warning?.bakta).toHaveLength(2);
    expect(warning?.amrfinderplus).toHaveLength(2);
    expect(annotationVersionWarning(synth, ['KPN'])).toBeNull();
  });
});
