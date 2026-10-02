// @vitest-environment jsdom
// Release-scoped data paths and a release replaced while the page is open
// (requirements §10): the application requests the manifest at
// /data/manifest.json and every other file at /data/r/<release_id>/<path>;
// when a read fails and the server says the release is no longer current, the
// application shows one statement with a reload button in place of the page.
import type { AsyncDuckDB } from '@duckdb/duckdb-wasm';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Manifest } from '../src/data/manifest';
import { MANIFEST_URL } from '../src/data/manifest';
import { createBrowserSource, dataUrl, releaseFileUrl } from '../src/data/release';
import {
  checkRelease,
  detectStaleRelease,
  isReleaseStale,
  isStaleResponse,
  markReleaseStale,
  resetReleaseChange,
  scopedManifestUrl,
  STALE_HEADER,
} from '../src/data/releaseChange';
import { ReleaseChangeNotice } from '../src/ReleaseChangeNotice';
import { strings } from '../src/strings';
import { STALE_HEADER as FUNCTION_STALE_HEADER } from '../functions/data/[[path]]';
import { manifestFixture, ready } from './support/manifest';
import { renderApp } from './support/render';

interface Answer {
  status: number;
  headers?: Record<string, string>;
  json?: unknown;
}

/** A fetch that answers HEAD of the scoped manifest and GET of the manifest. */
function fakeFetch(answers: { head?: Answer | Error; manifest?: Answer | Error }) {
  const calls: { url: string; method: string; cache: RequestCache | undefined }[] = [];
  const respond = (answer: Answer | Error | undefined): Promise<Response> => {
    if (answer instanceof Error) return Promise.reject(answer);
    const { status, headers = {}, json } = answer ?? { status: 404 };
    const body = json === undefined || status === 304 ? null : JSON.stringify(json);
    return Promise.resolve(new Response(body, { status, headers }));
  };
  const impl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';
    calls.push({ url, method, cache: init?.cache });
    return respond(method === 'HEAD' ? answers.head : answers.manifest);
  });
  return { fetch: impl as unknown as typeof fetch, calls, impl };
}

const stale: Answer = { status: 404, headers: { [STALE_HEADER]: 'stale' } };
const current: Answer = { status: 200 };

beforeEach(() => {
  resetReleaseChange();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('dataUrl', () => {
  it('keeps /data/manifest.json for the manifest', () => {
    expect(dataUrl('manifest.json', '2026-09')).toBe('/data/manifest.json');
    expect(dataUrl('/manifest.json', '2026-09')).toBe(MANIFEST_URL);
  });

  it('scopes every other release file by the release identifier', () => {
    expect(dataUrl('tables/genome.parquet', '2026-09')).toBe(
      '/data/r/2026-09/tables/genome.parquet',
    );
    expect(dataUrl('summaries/counts_by_species.parquet', 'synth')).toBe(
      '/data/r/synth/summaries/counts_by_species.parquet',
    );
    expect(dataUrl('tables/genome/manifest.json', 'synth')).toBe(
      '/data/r/synth/tables/genome/manifest.json',
    );
  });

  it('percent-encodes each segment and the release identifier', () => {
    expect(dataUrl('tables/a b#.parquet', 'r 1')).toBe('/data/r/r%201/tables/a%20b%23.parquet');
  });

  it('names the scoped manifest the same way in both modules', () => {
    expect(scopedManifestUrl('2026-09')).toBe(releaseFileUrl('manifest.json', '2026-09'));
  });

  it('reads the header the Function sends', () => {
    expect(STALE_HEADER).toBe(FUNCTION_STALE_HEADER);
  });
});

describe('detectStaleRelease', () => {
  it('finds a stale release from the header on the scoped manifest', async () => {
    const { fetch, calls } = fakeFetch({ head: stale });
    expect(await detectStaleRelease('2026-09', fetch)).toBe(true);
    expect(calls).toEqual([
      { url: '/data/r/2026-09/manifest.json', method: 'HEAD', cache: 'no-store' },
    ]);
  });

  it('finds a stale release from a manifest naming another release', async () => {
    const { fetch, calls } = fakeFetch({
      head: current,
      manifest: { status: 200, json: { release_id: '2026-10' } },
    });
    expect(await detectStaleRelease('2026-09', fetch)).toBe(true);
    expect(calls.at(-1)).toEqual({ url: '/data/manifest.json', method: 'GET', cache: 'no-store' });
  });

  it('keeps a current release', async () => {
    const { fetch } = fakeFetch({
      head: current,
      manifest: { status: 200, json: { release_id: '2026-09' } },
    });
    expect(await detectStaleRelease('2026-09', fetch)).toBe(false);
  });

  it('does not take a plain 404 or a failure for a new release', async () => {
    const cases = [
      fakeFetch({ head: { status: 404 }, manifest: { status: 503 } }),
      fakeFetch({ head: new TypeError('offline'), manifest: new TypeError('offline') }),
      fakeFetch({ head: current, manifest: { status: 200, json: { other: 1 } } }),
      fakeFetch({ head: { status: 404, headers: { [STALE_HEADER]: 'fresh' } } }),
    ];
    for (const { fetch } of cases) expect(await detectStaleRelease('2026-09', fetch)).toBe(false);
  });

  it('reads the manifest when the HEAD request fails', async () => {
    const { fetch } = fakeFetch({
      head: new TypeError('offline'),
      manifest: { status: 200, json: { release_id: 'next' } },
    });
    expect(await detectStaleRelease('2026-09', fetch)).toBe(true);
  });

  it('recognizes the stale answer only on a 404', () => {
    const headers = new Headers({ [STALE_HEADER]: 'stale' });
    expect(isStaleResponse({ status: 404, headers })).toBe(true);
    expect(isStaleResponse({ status: 200, headers })).toBe(false);
  });
});

describe('checkRelease', () => {
  it('records a stale release in the store', async () => {
    const { fetch } = fakeFetch({ head: stale });
    expect(isReleaseStale()).toBe(false);
    expect(await checkRelease('2026-09', fetch)).toBe(true);
    expect(isReleaseStale()).toBe(true);
  });

  it('shares one check among failures that arrive together', async () => {
    const { fetch, impl } = fakeFetch({
      head: current,
      manifest: { status: 200, json: { release_id: '2026-09' } },
    });
    const results = await Promise.all([
      checkRelease('2026-09', fetch),
      checkRelease('2026-09', fetch),
      checkRelease('2026-09', fetch),
    ]);
    expect(results).toEqual([false, false, false]);
    expect(impl).toHaveBeenCalledTimes(2);
    expect(isReleaseStale()).toBe(false);
  });

  it('checks again after a check that found the release current', async () => {
    const first = fakeFetch({
      head: current,
      manifest: { status: 200, json: { release_id: '2026-09' } },
    });
    expect(await checkRelease('2026-09', first.fetch)).toBe(false);
    const second = fakeFetch({ head: stale });
    expect(await checkRelease('2026-09', second.fetch)).toBe(true);
  });
});

/** A database whose every statement fails. */
function failingDatabase(error: Error): AsyncDuckDB {
  const connection = { query: () => Promise.reject(error) };
  return { connect: () => Promise.resolve(connection) } as unknown as AsyncDuckDB;
}

describe('browser release source', () => {
  const manifest = { release_id: '2026-09', files: [] } as unknown as Manifest;

  it('reports a failed read and still rejects it', async () => {
    const onReadError = vi.fn();
    const failure = new Error('HTTP Error: 404');
    const source = createBrowserSource(failingDatabase(failure), manifest, { onReadError });
    await expect(source.query('SELECT 1')).rejects.toThrow('HTTP Error: 404');
    expect(onReadError).toHaveBeenCalledWith(failure);
  });

  it('checks the release of its manifest by default when a read fails', async () => {
    const { fetch, calls } = fakeFetch({ head: stale });
    vi.stubGlobal('fetch', fetch);
    const source = createBrowserSource(failingDatabase(new Error('HTTP 404')), manifest);
    await expect(source.query('SELECT 1')).rejects.toThrow();
    await vi.waitFor(() => {
      expect(isReleaseStale()).toBe(true);
    });
    expect(calls[0]?.url).toBe('/data/r/2026-09/manifest.json');
  });

  it('does not check the release for a refused cross-species read', async () => {
    const onReadError = vi.fn();
    const source = createBrowserSource(failingDatabase(new Error('unused')), manifest, {
      onReadError,
    });
    await expect(source.relation('tables/feature/*.parquet')).rejects.toThrow();
    expect(onReadError).not.toHaveBeenCalled();
  });
});

describe('ReleaseChangeNotice', () => {
  it('states the change and reloads on the button', () => {
    const reload = vi.fn();
    render(<ReleaseChangeNotice reload={reload} />);
    expect(screen.getByRole('alert').textContent).toBe(strings.releaseStale);
    fireEvent.click(screen.getByRole('button', { name: strings.releaseReload }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('replaces the page once the release is found stale', () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    renderApp('/', ready(manifestFixture()));
    expect(screen.queryByText(strings.releaseStale)).toBeNull();
    expect(screen.getByRole('navigation', { name: strings.navigationLabel })).toBeTruthy();
    act(() => {
      markReleaseStale();
    });
    expect(screen.getByRole('alert').textContent).toBe(strings.releaseStale);
    expect(screen.getByRole('button', { name: strings.releaseReload })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: strings.navigationLabel })).toBeNull();
  });
});
