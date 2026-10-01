// @vitest-environment jsdom
// Requirements §5.2, §5.3: the genome-set store reads the filters from the
// URL, writes every change as a new history entry with the canonical query,
// keeps other parameters, removes the most recently added value with
// clearLast (menu order after a reload), and "Use as set" replaces the set
// with explicit identifiers.
import { act, cleanup, render } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouterProvider } from '../src/router';
import { decodeFilters, encodeFilters } from '../src/set/filters';
import { SetProvider, useGenomeSet } from '../src/set/store';
import type { GenomeSetStore } from '../src/set/store';

const holder: { store?: GenomeSetStore | undefined } = {};

function Probe() {
  const store = useGenomeSet();
  useEffect(() => {
    holder.store = store;
  }, [store]);
  return null;
}

function mount(path: string) {
  window.history.replaceState(null, '', path);
  render(
    <RouterProvider>
      <SetProvider>
        <Probe />
      </SetProvider>
    </RouterProvider>,
  );
}

function current(): GenomeSetStore {
  if (holder.store === undefined) throw new Error('store not mounted');
  return holder.store;
}

function run(action: (s: GenomeSetStore) => void) {
  act(() => {
    action(current());
  });
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  holder.store = undefined;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('genome-set store', () => {
  it('reads the whole release from a missing query', () => {
    mount('/');
    expect(current().filters).toEqual({});
    expect(current().entries).toEqual([]);
    expect(current().lastEntry).toBeUndefined();
  });

  it('decodes the filters of the URL without rewriting it', () => {
    mount('/genomes?q=%7B%7D&set=index-isolate');
    expect(current().filters).toEqual({ set: ['index-isolate'] });
    expect(window.location.search).toBe('?q=%7B%7D&set=index-isolate');
  });

  it('writes the canonical query as a new history entry and keeps other parameters', () => {
    mount('/genes?search=gyrase');
    const length = window.history.length;
    run((s) => {
      s.addValue('st', '258');
    });
    run((s) => {
      s.addValue('species_code', 'KPN');
    });
    expect(window.location.pathname).toBe('/genes');
    expect(window.location.search).toBe(
      `${encodeFilters({ species_code: ['KPN'], st: ['258'] })}&search=gyrase`,
    );
    expect(window.history.length).toBe(length + 2);
    expect(current().filters).toEqual({ species_code: ['KPN'], st: ['258'] });
  });

  it('removes the most recently added value', () => {
    mount('/');
    run((s) => {
      s.addValue('st', '258');
    });
    run((s) => {
      s.addValue('species_code', 'KPN');
    });
    run((s) => {
      s.setKey('completeness_min', 95);
    });
    run((s) => {
      s.addValue('species_code', 'ECO');
    });
    expect(current().lastEntry).toEqual({ key: 'species_code', value: 'ECO' });
    run((s) => {
      s.clearLast();
    });
    expect(current().filters).toEqual({
      completeness_min: 95,
      species_code: ['KPN'],
      st: ['258'],
    });
    run((s) => {
      s.clearLast();
    });
    expect(current().filters).toEqual({ species_code: ['KPN'], st: ['258'] });
    run((s) => {
      s.clearLast();
    });
    expect(current().filters).toEqual({ st: ['258'] });
    run((s) => {
      s.clearLast();
    });
    expect(current().filters).toEqual({});
    expect(window.location.search).toBe('');
  });

  it('falls back to the last value in menu order after a reload', () => {
    mount(`/${encodeFilters({ st: ['11', '258'], species_code: ['KPN'], prophage: true })}`);
    expect(current().lastEntry).toEqual({ key: 'prophage' });
    run((s) => {
      s.clearLast();
    });
    expect(current().lastEntry).toEqual({ key: 'st', value: '258' });
    run((s) => {
      s.clearLast();
    });
    expect(current().filters).toEqual({ species_code: ['KPN'], st: ['11'] });
  });

  it('follows the filters when the URL changes by navigation', () => {
    mount('/');
    run((s) => {
      s.addValue('country', 'CL');
    });
    run((s) => {
      s.addValue('country', 'AR');
    });
    act(() => {
      window.history.replaceState(null, '', encodeFilters({ country: ['CL'], prophage: true }));
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(current().lastEntry).toEqual({ key: 'prophage' });
    run((s) => {
      s.clearLast();
    });
    expect(current().filters).toEqual({ country: ['CL'] });
  });

  it('replaces the set with explicit identifiers', () => {
    mount(`/genomes${encodeFilters({ species_code: ['KPN'] })}&tab=x`);
    run((s) => {
      s.replaceWithIds(['KPN0002', 'KPN0001']);
    });
    expect(window.location.search).toBe('?ids=KPN0001,KPN0002&tab=x');
    expect(decodeFilters(window.location.search)).toEqual({ genome_id: ['KPN0001', 'KPN0002'] });
  });

  it('removes one value or a whole key', () => {
    mount(`/${encodeFilters({ species_code: ['KPN', 'ECO'], year: { min: 2015 } })}`);
    run((s) => {
      s.removeValue('species_code', 'KPN');
    });
    expect(current().filters).toEqual({ species_code: ['ECO'], year: { min: 2015 } });
    run((s) => {
      s.removeValue('year');
    });
    expect(current().filters).toEqual({ species_code: ['ECO'] });
  });

  it('toggles complete genomes only', () => {
    mount('/');
    run((s) => {
      s.setCompleteOnly(true);
    });
    expect(current().completeOnly).toBe(true);
    expect(current().filters).toEqual({ assembly_status: ['complete'] });
    run((s) => {
      s.setCompleteOnly(false);
    });
    expect(current().filters).toEqual({});
  });
});
