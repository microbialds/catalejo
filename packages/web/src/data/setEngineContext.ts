// React access to the set engine (./setEngine.ts). The engine is created once
// per manifest on first use, over the database that DatabaseContext opens;
// tests provide another factory through SetEngineContext. The whole-release
// count comes from the manifest, so a page without filters never opens the
// database for the set bar (requirements §6.1 Data, §9).
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { filtersKey, isWholeRelease } from '../set/filters';
import type { GenomeFilters } from '../set/filters';
import { DatabaseContext } from './database';
import type { OpenDatabase } from './database';
import { useManifest } from './manifest';
import type { Manifest } from './manifest';
import { createBrowserSource } from './release';
import { createSetEngine } from './setEngine';
import type { SetEngine } from './setEngine';

export type SetEngineFactory = (manifest: Manifest, open: OpenDatabase) => Promise<SetEngine>;

const engines = new WeakMap<Manifest, Promise<SetEngine>>();

/** The engine over the browser database, one per manifest. */
export const browserEngineFactory: SetEngineFactory = (manifest, open) => {
  let engine = engines.get(manifest);
  if (engine === undefined) {
    engine = open().then((db) => createSetEngine(createBrowserSource(db, manifest), manifest));
    engines.set(manifest, engine);
    engine.catch(() => engines.delete(manifest));
  }
  return engine;
};

export const SetEngineContext = createContext<SetEngineFactory>(browserEngineFactory);

/** A function returning the engine, or undefined until the manifest is ready. */
export function useSetEngine(): (() => Promise<SetEngine>) | undefined {
  const manifest = useManifest();
  const open = useContext(DatabaseContext);
  const factory = useContext(SetEngineContext);
  return useMemo(
    () => (manifest === undefined ? undefined : () => factory(manifest, open)),
    [manifest, open, factory],
  );
}

export type EngineResult<T> =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'ready'; value: T }
  | { status: 'error'; error: unknown };

/**
 * The result of an engine request named by `key`; a null key asks nothing.
 * `run` must be stable for a key (wrap it in useCallback); a new key starts a
 * new request and the result of an older one is discarded.
 */
export function useEngineQuery<T>(
  key: string | null,
  run: (engine: SetEngine) => Promise<T>,
): EngineResult<T> {
  const getEngine = useSetEngine();
  const [state, setState] = useState<{ key: string | null; result: EngineResult<T> }>({
    key: null,
    result: { status: 'idle' },
  });
  useEffect(() => {
    if (key === null || getEngine === undefined) return;
    let active = true;
    getEngine()
      .then(run)
      .then(
        (value) => {
          if (active) setState({ key, result: { status: 'ready', value } });
        },
        (error: unknown) => {
          if (active) setState({ key, result: { status: 'error', error } });
        },
      );
    return () => {
      active = false;
    };
  }, [key, getEngine, run]);
  if (key === null) return { status: 'idle' };
  return state.key === key ? state.result : { status: 'pending' };
}

/**
 * Genomes in a set: the manifest count for the whole release, else the
 * engine's count; undefined while pending or when the count failed.
 */
export function useSetCount(filters: GenomeFilters): number | undefined {
  const manifest = useManifest();
  const whole = isWholeRelease(filters);
  const key = whole ? null : `count:${filtersKey(filters)}`;
  const run = useMemo(() => (engine: SetEngine) => engine.countSet(filters), [filters]);
  const result = useEngineQuery(key, run);
  if (whole) return manifest?.genome_count;
  return result.status === 'ready' ? result.value : undefined;
}
