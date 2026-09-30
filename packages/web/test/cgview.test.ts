// @vitest-environment jsdom
// CGView JSON (contract §7.1): the release build writes cgview.json per genome
// with one multi-contig map and one map per contig. The ingest package writes
// tests/fixtures/cgview.json from the synthetic data; this test loads every
// map in it into the CGView.js version pinned in package.json and requires
// that nothing was dropped, clamped, renamed or created on load, because the
// library accepts malformed documents with at most a console message.
//
// Each feature resolves to a row through its metadata: feature_id for the
// feature table, or hit_id, mutation_id or region_id for features drawn from
// the other tables. At least one of the four is required.
//
// jsdom has no canvas, so getContext returns a recording stub whose methods do
// nothing; the test checks the loaded model, not the pixels.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Viewer, version } from 'cgview';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { repoRoot } from './files';

interface FeatureJson {
  name: string;
  type: string;
  source: string;
  contig?: string;
  start: number;
  stop: number;
  strand: number;
  legend: string;
  meta: FeatureMeta;
}

interface FeatureMeta extends Record<string, unknown> {
  feature_id?: string;
  hit_id?: string;
  mutation_id?: string;
  region_id?: string;
}

/** The identifier a click on the feature resolves through. */
function featureKey(meta: FeatureMeta): string | undefined {
  return meta.feature_id ?? meta.hit_id ?? meta.mutation_id ?? meta.region_id;
}

interface PlotJson {
  name: string;
  source: string;
  positions: number[];
  scores: number[];
}

interface TrackJson {
  name: string;
  dataType: 'feature' | 'plot';
}

interface MapDocument {
  cgview: {
    version: string;
    sequence: { contigs: { name: string; length: number }[] };
    features: FeatureJson[];
    plots: PlotJson[];
    tracks: TrackJson[];
    legend: { items: { name: string }[] };
  };
}

interface Fixture {
  format: string;
  format_version: number;
  genome: MapDocument;
  contigs: Record<string, MapDocument>;
}

// CATALEJO_CGVIEW_FIXTURE points the test at another file.
const fixtureFile =
  process.env.CATALEJO_CGVIEW_FIXTURE ?? path.join(repoRoot, 'tests', 'fixtures', 'cgview.json');

/** A 2D context whose methods do nothing; measureText returns a width. */
function stubContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const state: Record<string | symbol, unknown> = { canvas };
  const results: Record<string, (...args: unknown[]) => unknown> = {
    measureText: (text) => ({
      width: String(text).length * 6,
      actualBoundingBoxAscent: 8,
      actualBoundingBoxDescent: 2,
    }),
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    createRadialGradient: () => ({ addColorStop: () => undefined }),
    getLineDash: () => [],
    isPointInPath: () => false,
  };
  const context = new Proxy(state, {
    get(target, property) {
      if (property in target) return target[property];
      if (typeof property !== 'string') return undefined;
      return (...args: unknown[]) => results[property]?.(...args);
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    },
  });
  return context as unknown as CanvasRenderingContext2D;
}

let messages: unknown[][] = [];

beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    return stubContext(this);
  });
  // CGView.js logs progress with console.log; errors and warnings mean it
  // repaired or ignored part of the document.
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => messages.push(args));
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => messages.push(args));
});

afterAll(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  document.body.replaceChildren();
  messages = [];
});

function readFixture(): Fixture {
  expect(existsSync(fixtureFile), `${fixtureFile} is missing; run the ingest tests`).toBe(true);
  return JSON.parse(readFileSync(fixtureFile, 'utf8')) as Fixture;
}

let containers = 0;

function load(document_: MapDocument): Viewer {
  const container = document.createElement('div');
  // Element ids, not contig ids, which may not be valid in a selector.
  container.id = `cgview-${String(++containers)}`;
  document.body.append(container);
  const viewer = new Viewer(`#${container.id}`, { width: 600, height: 600 });
  viewer.io.loadJSON(structuredClone(document_));
  viewer.drawFull();
  return viewer;
}

function checkMap(document_: MapDocument): void {
  const map = document_.cgview;
  expect(map.version).toBe(version);
  const viewer = load(document_);
  expect(messages).toEqual([]);

  const contigs = viewer.sequence.contigs();
  expect(contigs.map((contig) => [contig.name, contig.length])).toEqual(
    map.sequence.contigs.map((contig) => [contig.name, contig.length]),
  );
  const multiContig = contigs.length > 1;

  expect(viewer.legend.items().map((item) => item.name)).toEqual(
    map.legend.items.map((item) => item.name),
  );

  const features = viewer.features();
  expect(features).toHaveLength(map.features.length);
  map.features.forEach((expected, index) => {
    const key = featureKey(expected.meta);
    const label = `feature ${String(index)} (${key ?? expected.name})`;
    expect(
      typeof key === 'string' && key.trim() !== '',
      `${label} has no feature_id, hit_id, mutation_id or region_id`,
    ).toBe(true);
    const feature = features[index];
    expect(feature, label).toBeDefined();
    if (!feature) return;
    if (multiContig) expect(expected.contig, label).toBeDefined();
    expect(
      {
        meta: feature.meta,
        contig: feature.contig?.name,
        start: feature.start,
        stop: feature.stop,
        strand: feature.strand,
        legend: feature.legend.name,
        tracks: feature.tracks().length > 0,
      },
      label,
    ).toEqual({
      meta: expected.meta,
      contig: expected.contig ?? contigs[0]?.name,
      start: expected.start,
      stop: expected.stop,
      strand: expected.strand,
      legend: expected.legend,
      tracks: true,
    });
  });

  const plots = viewer.plots();
  expect(plots.map((plot) => plot.source)).toEqual(map.plots.map((plot) => plot.source));
  for (const plot of plots) {
    // Plot positions are map coordinates, sorted, within the whole map.
    expect(plot.positions.length).toBe(plot.scores.length);
    expect(
      plot.positions.every((position, i, all) => i === 0 || position > (all[i - 1] ?? 0)),
    ).toBe(true);
    expect(plot.positions[0]).toBeGreaterThanOrEqual(1);
    expect(plot.positions.at(-1)).toBeLessThanOrEqual(viewer.sequence.length);
    expect(plot.tracks().length).toBeGreaterThan(0);
  }

  const tracks = viewer.tracks();
  expect(tracks.map((track) => [track.name, track.dataType])).toEqual(
    map.tracks.map((track) => [track.name, track.dataType]),
  );
  for (const track of tracks) {
    expect(track.position, track.name).toBeDefined();
    if (track.dataType === 'plot') expect(track.plot, track.name).toBeDefined();
  }
}

describe('cgview.json loads in the pinned CGView.js', () => {
  it('declares the catalejo-cgview format', () => {
    const fixture = readFixture();
    expect(fixture.format).toBe('catalejo-cgview');
    expect(fixture.format_version).toBe(1);
    expect(Object.keys(fixture.contigs).length).toBeGreaterThan(0);
  });

  it('loads the multi-contig map', () => {
    const fixture = readFixture();
    checkMap(fixture.genome);
    // Sorted: JSON object keys that look like integers lose their order.
    expect(fixture.genome.cgview.sequence.contigs.map((contig) => contig.name).sort()).toEqual(
      Object.keys(fixture.contigs).sort(),
    );
  });

  it('loads each contig map', () => {
    const fixture = readFixture();
    // In map order: the keys of fixture.contigs are sorted.
    for (const { name: contigId } of fixture.genome.cgview.sequence.contigs) {
      const map = fixture.contigs[contigId];
      expect(map, contigId).toBeDefined();
      if (!map) continue;
      expect(
        map.cgview.sequence.contigs.map((contig) => contig.name),
        contigId,
      ).toEqual([contigId]);
      checkMap(map);
    }
  });
});
