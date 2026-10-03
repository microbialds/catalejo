// A release replaced while the page is open (requirements §10). The
// application requests every release file at /data/r/<release_id>/<path>,
// which the server answers only for the release named in the pointer; once a
// new release is published, a request for the old one is refused with 404 and
// the header X-Catalejo-Release: stale, and the application asks the reader to
// reload instead of showing the failure.
//
// DuckDB-WASM reports a refused read as a query error without its headers, so
// when a read fails the data layer calls `checkRelease`, which asks the server
// whether the release is still current: a HEAD of the release's manifest at
// its scoped path (stale when the answer carries the header), then a fresh
// read of /data/manifest.json (stale when it names another release). A stale
// release is recorded once in this module's store, which App.tsx reads with
// `useReleaseStale` to show the reload statement in place of the page.
import { useSyncExternalStore } from 'react';

export const STALE_HEADER = 'X-Catalejo-Release';
export const STALE_VALUE = 'stale';

const DATA_PREFIX = '/data/';
const MANIFEST_URL = `${DATA_PREFIX}manifest.json`;

/** The scoped URL of a release's own manifest, /data/r/<release_id>/manifest.json. */
export function scopedManifestUrl(releaseId: string): string {
  return `${DATA_PREFIX}r/${encodeURIComponent(releaseId)}/manifest.json`;
}

/** Whether a response is the server's refusal of a release that is no longer current. */
export function isStaleResponse(response: Pick<Response, 'status' | 'headers'>): boolean {
  return response.status === 404 && response.headers.get(STALE_HEADER) === STALE_VALUE;
}

/**
 * Whether the release `releaseId` has been replaced on the server. A network
 * failure or an unreadable answer counts as not replaced, so that an outage
 * shows as the read error it is. Never rejects.
 */
export async function detectStaleRelease(
  releaseId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const head = await fetchImpl(scopedManifestUrl(releaseId), {
      method: 'HEAD',
      cache: 'no-store',
    });
    if (isStaleResponse(head)) return true;
  } catch {
    // Fall through to the manifest.
  }
  try {
    const response = await fetchImpl(MANIFEST_URL, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return false;
    const json: unknown = await response.json();
    const current =
      typeof json === 'object' && json !== null && 'release_id' in json
        ? json.release_id
        : undefined;
    return typeof current === 'string' && current !== releaseId;
  } catch {
    return false;
  }
}

// The store: false until a check finds the release replaced, then true for
// the rest of the page's life.

let stale = false;
const listeners = new Set<() => void>();
let pending: Promise<boolean> | undefined;

export function isReleaseStale(): boolean {
  return stale;
}

export function markReleaseStale(): void {
  if (stale) return;
  stale = true;
  for (const listener of listeners) listener();
}

export function subscribeReleaseChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Checks once whether `releaseId` is still current and records a replaced
 * release in the store. Failures that arrive while a check runs share it.
 */
export function checkRelease(releaseId: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (stale) return Promise.resolve(true);
  pending ??= detectStaleRelease(releaseId, fetchImpl).then((found) => {
    pending = undefined;
    if (found) markReleaseStale();
    return found;
  });
  return pending;
}

/** Whether the release the page loaded has been replaced. */
export function useReleaseStale(): boolean {
  return useSyncExternalStore(subscribeReleaseChange, isReleaseStale, isReleaseStale);
}

/** Forgets a recorded change (for tests). */
export function resetReleaseChange(): void {
  stale = false;
  pending = undefined;
  for (const listener of listeners) listener();
}
