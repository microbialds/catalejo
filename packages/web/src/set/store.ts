// The genome-set store (requirements §5.2, §5.3, §5.9). The current set is
// the filter object decoded from the URL query; the store never writes the
// URL on its own, and every change goes through the router as a new history
// entry with the canonical query (./filters.ts), so Back restores the
// previous set and other query parameters are kept.
//
// "Clear the last filter" (§5.2, empty set) removes the most recently added
// value. Insertion order is tracked in memory: whenever the filters change,
// by this store or by navigation, the values that appeared are appended in
// menu order and the values that disappeared are dropped. After a reload the
// order starts as the menu order, so the last value is the last value of the
// last key in menu order.
import { createContext, createElement, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from '../router';
import {
  decodeFilters,
  encodeFilters,
  entryId,
  filterEntries,
  filtersKey,
  isCompleteOnly,
  withCompleteOnly,
  withKey,
  withoutEntry,
  withoutValue,
  withValue,
} from './filters';
import type { FilterEntry, FilterKey, GenomeFilters, ListKey } from './filters';

export interface GenomeSetStore {
  /** The canonical filters of the current set; {} is the whole release. */
  filters: GenomeFilters;
  /** One entry per value, in menu order (chips). */
  entries: FilterEntry[];
  /** The entry `clearLast` removes, if any. */
  lastEntry: FilterEntry | undefined;
  /** Replaces the filters. */
  setFilters: (next: GenomeFilters) => void;
  /** Adds one value to a list key. */
  addValue: (key: ListKey, value: string) => void;
  /** Removes one value of a list key, or the whole key without a value. */
  removeValue: (key: FilterKey, value?: string) => void;
  /** Sets or removes (undefined) one key. */
  setKey: <K extends FilterKey>(key: K, value: GenomeFilters[K] | undefined) => void;
  /** Removes one entry, as the remove control of a chip does. */
  removeEntry: (entry: FilterEntry) => void;
  /** Removes the most recently added value. */
  clearLast: () => void;
  /** Returns to the whole release. */
  clearAll: () => void;
  /** "Use as set": the set becomes exactly these genomes (ids= only). */
  replaceWithIds: (ids: readonly string[]) => void;
  /** Whether "complete genomes only" is on (§5.5). */
  completeOnly: boolean;
  setCompleteOnly: (on: boolean) => void;
  /** The query string, with "?", of other filters, keeping foreign parameters. */
  queryFor: (filters: GenomeFilters) => string;
}

const SetContext = createContext<GenomeSetStore | null>(null);

interface OrderState {
  key: string;
  /** Entry identities, oldest first. */
  order: string[];
}

function nextOrder(previous: string[], entries: FilterEntry[]): string[] {
  const present = entries.map(entryId);
  const presentSet = new Set(present);
  const kept = previous.filter((id) => presentSet.has(id));
  const keptSet = new Set(kept);
  return [...kept, ...present.filter((id) => !keptSet.has(id))];
}

/** Provides the genome-set store from the router's query. */
export function SetProvider({ children }: { children: ReactNode }) {
  const { pathname, search, navigate } = useRouter();
  const filters = useMemo(() => decodeFilters(search), [search]);
  const key = filtersKey(filters);
  const entries = useMemo(() => filterEntries(filters), [filters]);

  // Derived state: the order follows the filters during render.
  const [order, setOrder] = useState<OrderState>(() => ({
    key,
    order: entries.map(entryId),
  }));
  let current = order;
  if (order.key !== key) {
    current = { key, order: nextOrder(order.order, entries) };
    setOrder(current);
  }
  const lastId = current.order.at(-1);
  const lastEntry = entries.find((entry) => entryId(entry) === lastId) ?? entries.at(-1);

  const commit = useCallback(
    (next: GenomeFilters) => {
      const hash = window.location.hash;
      navigate(`${pathname}${hash}`, { replaceQuery: encodeFilters(next, search) });
    },
    [navigate, pathname, search],
  );

  const store = useMemo<GenomeSetStore>(
    () => ({
      filters,
      entries,
      lastEntry,
      setFilters: commit,
      addValue: (field, value) => {
        commit(withValue(filters, field, value));
      },
      removeValue: (field, value) => {
        commit(withoutValue(filters, field, value));
      },
      setKey: (field, value) => {
        commit(withKey(filters, field, value));
      },
      removeEntry: (entry) => {
        commit(withoutEntry(filters, entry));
      },
      clearLast: () => {
        if (lastEntry !== undefined) commit(withoutEntry(filters, lastEntry));
      },
      clearAll: () => {
        commit({});
      },
      replaceWithIds: (ids) => {
        commit({ genome_id: [...ids] });
      },
      completeOnly: isCompleteOnly(filters),
      setCompleteOnly: (on) => {
        commit(withCompleteOnly(filters, on));
      },
      queryFor: (next) => encodeFilters(next, search),
    }),
    [filters, entries, lastEntry, commit, search],
  );
  return createElement(SetContext, { value: store }, children);
}

/** The genome-set store. */
export function useGenomeSet(): GenomeSetStore {
  const store = useContext(SetContext);
  if (store === null) throw new Error('useGenomeSet outside SetProvider');
  return store;
}
