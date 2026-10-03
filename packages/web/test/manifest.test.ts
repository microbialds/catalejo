// Data contract §2 and §6.4: the supported schema range, the semantic version
// check, reading the manifest, and the loader's states (ready, mismatch,
// unavailable) for a fetched /data/manifest.json.
import { describe, expect, it, vi } from 'vitest';
import {
  isSupportedSchema,
  loadManifest,
  MANIFEST_URL,
  manifestStateOf,
  satisfiesRange,
  SUPPORTED_SCHEMA_RANGE,
} from '../src/data/manifest';
import { manifestFixture } from './support/manifest';

describe('schema range', () => {
  it('is the 0.1 series', () => {
    expect(SUPPORTED_SCHEMA_RANGE).toBe('>=0.1.0 <0.2.0');
  });

  it.each(['0.1.0', '0.1.1', '0.1.27', '0.1.3+build.7'])('supports %s', (version) => {
    expect(isSupportedSchema(version)).toBe(true);
  });

  it.each(['0.0.9', '0.2.0', '0.2.0-rc.1', '0.1.0-rc.1', '1.0.0', '0.10.0', '0.1', 'v0.1.0', ''])(
    'rejects %s',
    (version) => {
      expect(isSupportedSchema(version)).toBe(false);
    },
  );

  it('compares numerically and orders prereleases below releases', () => {
    expect(satisfiesRange('0.10.0', '>0.9.0')).toBe(true);
    expect(satisfiesRange('1.0.0-alpha', '>=1.0.0-alpha <1.0.0')).toBe(true);
    expect(satisfiesRange('1.0.0-alpha', '<1.0.0')).toBe(false);
    expect(satisfiesRange('1.0.0-alpha.2', '>1.0.0-alpha.10')).toBe(false);
    expect(satisfiesRange('1.0.0-beta', '>1.0.0-alpha.10')).toBe(true);
    expect(satisfiesRange('1.0.0-alpha', '<1.0.0-alpha.1')).toBe(true);
    expect(satisfiesRange('2.0.0', '=2.0.0')).toBe(true);
    expect(satisfiesRange('2.0.0', '2.0.0')).toBe(true);
    expect(satisfiesRange('2.0.0', '<=2.0.0 >=2.0.0')).toBe(true);
  });

  it('fails an unparsable range', () => {
    expect(satisfiesRange('0.1.0', '')).toBe(false);
    expect(satisfiesRange('0.1.0', '>=0.1')).toBe(false);
    expect(satisfiesRange('0.1.0', '~0.1.0')).toBe(false);
  });
});

describe('manifestStateOf', () => {
  it('reads the synthetic manifest shape', () => {
    const manifest = manifestFixture();
    expect(manifestStateOf(JSON.parse(JSON.stringify(manifest)))).toEqual({
      status: 'ready',
      manifest,
    });
  });

  it('reads the optional annotation versions of a species', () => {
    const base = manifestFixture();
    const manifest = manifestFixture({
      species: base.species.map((species) => ({
        ...species,
        annotation_versions: { bakta: ['5.1', '6.0'] },
      })),
    });
    expect(manifestStateOf(manifest)).toEqual({ status: 'ready', manifest });
  });

  it('reports a schema outside the range before reading the rest', () => {
    expect(manifestStateOf({ schema_version: '1.0.0', something: 'else' })).toEqual({
      status: 'mismatch',
      schemaVersion: '1.0.0',
      range: SUPPORTED_SCHEMA_RANGE,
    });
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['no schema version', { ...manifestFixture(), schema_version: undefined }],
    ['no release id', { ...manifestFixture(), release_id: 7 }],
    ['no pipeline', { ...manifestFixture(), pipeline: undefined }],
    ['a malformed species', { ...manifestFixture(), species: [{ species_code: 'KPN' }] }],
    ['no embedding models', { ...manifestFixture(), embedding_models: undefined }],
  ])('is unavailable for %s', (_name, json) => {
    expect(manifestStateOf(json)).toEqual({ status: 'unavailable' });
  });
});

function response(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
}

describe('loadManifest', () => {
  it('fetches the same-origin manifest', async () => {
    const manifest = manifestFixture();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(JSON.stringify(manifest)));
    await expect(loadManifest(fetchImpl)).resolves.toEqual({ status: 'ready', manifest });
    expect(MANIFEST_URL).toBe('/data/manifest.json');
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('/data/manifest.json');
  });

  it('reports a mismatch', async () => {
    const body = JSON.stringify(manifestFixture({ schema_version: '0.2.0' }));
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(body));
    await expect(loadManifest(fetchImpl)).resolves.toEqual({
      status: 'mismatch',
      schemaVersion: '0.2.0',
      range: '>=0.1.0 <0.2.0',
    });
  });

  it.each([
    ['a missing file', () => Promise.resolve(response('not found', 404))],
    ['unreadable JSON', () => Promise.resolve(response('{"schema_version":'))],
    ['a network failure', () => Promise.reject(new TypeError('failed to fetch'))],
  ])('is unavailable for %s', async (_name, impl) => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(impl);
    await expect(loadManifest(fetchImpl)).resolves.toEqual({ status: 'unavailable' });
  });
});
