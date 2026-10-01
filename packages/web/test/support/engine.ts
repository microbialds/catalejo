// A set engine for component tests (src/data/setEngine.ts), so that the shell
// never starts DuckDB in jsdom. Counts are fixed unless overridden.
import type { SetEngine } from '../../src/data/setEngine';
import type { SetEngineFactory } from '../../src/data/setEngineContext';
import { isWholeRelease } from '../../src/set/filters';

/** The count the stub gives any filtered set. */
export const STUB_COUNT = 7;

function unused(): Promise<never> {
  return Promise.reject(new Error('not provided by the stub engine'));
}

export function stubEngine(overrides: Partial<SetEngine> = {}): SetEngine {
  return {
    countSet: (filters) => Promise.resolve(isWholeRelease(filters) ? 100 : STUB_COUNT),
    setGenomeIds: () => Promise.resolve([]),
    setSpecies: () => Promise.resolve([]),
    aggregate: unused,
    releaseSummaries: unused,
    summarize: unused,
    counters: unused,
    mobileCounts: unused,
    qcPoints: unused,
    filterOptions: () => Promise.resolve([]),
    fieldAvailable: () => true,
    searchRows: () => Promise.resolve([]),
    ...overrides,
  };
}

export function stubFactory(engine: SetEngine = stubEngine()): SetEngineFactory {
  return () => Promise.resolve(engine);
}
