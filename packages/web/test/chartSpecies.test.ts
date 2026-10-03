// Requirements §5.4, §6.1 and checklist C7 against the synthetic release with
// the engine the browser runs: the species without a registry color (no
// color_index, data contract §4.9) carry the Other gray in the summaries, and
// the chart groups put them in "Other" however large they are in the set.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OTHER_KEY, speciesGroups } from '../src/collection/species';
import { createSetEngine } from '../src/data/setEngine';
import type { SetEngine } from '../src/data/setEngine';
import { palette } from '../src/generated/palette';
import {
  type ExtensionRepository,
  type NodeDatabase,
  openNodeDatabase,
  startExtensionRepository,
} from './support/duckdbNode';
import { nodeSource, readSynthManifest } from './support/releaseSource';

let repository: ExtensionRepository | undefined;
let database: NodeDatabase | undefined;
let engine: SetEngine;

beforeAll(async () => {
  repository = await startExtensionRepository();
  database = await openNodeDatabase(repository.url);
  engine = createSetEngine(nodeSource(database), readSynthManifest());
});

afterAll(async () => {
  database?.close();
  await repository?.stop();
});

describe('chart species of the release summaries (C7)', () => {
  it('groups the species without a registry color as "Other"', async () => {
    const uncolored = (await engine.releaseSummaries()).bySpecies
      .filter((entry) => entry.color.toLowerCase() === palette.species.other.toLowerCase())
      .map((entry) => entry.species_code)
      .sort();
    expect(uncolored).toEqual(['EHO', 'SPN']);
    const groups = speciesGroups((await engine.summarize({})).bySpecies);
    expect(groups.at(-1)?.key).toBe(OTHER_KEY);
    expect([...(groups.at(-1)?.codes ?? [])].sort()).toEqual(uncolored);
    expect(groups.filter((group) => group.isSpecies)).toHaveLength(8);
  });

  it('draws a set filtered to an uncolored species as "Other" alone', async () => {
    const groups = speciesGroups((await engine.summarize({ species_code: ['SPN'] })).bySpecies);
    expect(groups.map((group) => [group.key, group.codes])).toEqual([[OTHER_KEY, ['SPN']]]);
  });
});
