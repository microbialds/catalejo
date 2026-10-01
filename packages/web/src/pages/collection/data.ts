// Data of the collection page (requirements §6.1 Data, §9; contract §6.2).
// Every chart and counter reads the species-grain view of the set from
// `engine.summarize`: the summaries for the whole release, which is also the
// first render, and the genome-grain aggregation for any other set. The
// facet rail also reads the release summaries for its list of values, the
// mobile element counts come from `mobileCounts`, and the QC scatter from
// summaries/qc.parquet through `qcPoints`. The requests of one filter change
// start together, and while they run the previous results stay on screen.
import { useMemo, useState } from 'react';
import type { QcPoint, SetEngine, SetSummary, MobileCounts } from '../../data/setEngine';
import { useEngineQuery } from '../../data/setEngineContext';
import type { EngineResult } from '../../data/setEngineContext';
import { filtersKey } from '../../set/filters';
import type { GenomeFilters } from '../../set/filters';

export interface Settled<T> {
  /** The latest value, kept while a newer request runs. */
  value: T | undefined;
  /** A request for other filters is running. */
  pending: boolean;
  /** The latest request failed and no value is known. */
  failed: boolean;
}

/** The latest ready value of an engine request, kept across key changes. */
export function useSettled<T>(result: EngineResult<T>): Settled<T> {
  const [last, setLast] = useState<{ value: T } | undefined>(undefined);
  if (result.status === 'ready' && last?.value !== result.value) {
    setLast({ value: result.value });
  }
  const value = result.status === 'ready' ? result.value : last?.value;
  return {
    value,
    pending: result.status === 'pending',
    failed: result.status === 'error' && value === undefined,
  };
}

const releaseSummaries = (engine: SetEngine) => engine.releaseSummaries();

export interface CollectionData {
  summary: Settled<SetSummary>;
  release: Settled<SetSummary>;
  mobile: Settled<MobileCounts>;
  qc: Settled<QcPoint[]>;
}

export function useCollectionData(filters: GenomeFilters): CollectionData {
  const key = filtersKey(filters);
  const summarize = useMemo(() => (engine: SetEngine) => engine.summarize(filters), [filters]);
  const mobileCounts = useMemo(
    () => (engine: SetEngine) => engine.mobileCounts(filters),
    [filters],
  );
  const qcPoints = useMemo(() => (engine: SetEngine) => engine.qcPoints(filters), [filters]);
  return {
    summary: useSettled(useEngineQuery(`summary:${key}`, summarize)),
    release: useSettled(useEngineQuery('summary:release', releaseSummaries)),
    mobile: useSettled(useEngineQuery(`mobile:${key}`, mobileCounts)),
    qc: useSettled(useEngineQuery(`qc:${key}`, qcPoints)),
  };
}
