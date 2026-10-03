// Requirements §5.3 and §6.1: the genome table's sort, page and columns in
// the URL after the set parameters (src/tableView.ts), canonical when
// written, tolerant when read, and a change of set drops the page
// (src/set/filters.ts, encodeFilters).
import { describe, expect, it } from 'vitest';
import { DEFAULT_COLUMN_IDS } from '../src/collection/genomeTable';
import { decodeFilters, encodeFilters } from '../src/set/filters';
import {
  DEFAULT_TABLE_VIEW,
  decodeTableView,
  encodeTableView,
  tableViewKey,
} from '../src/tableView';
import type { TableView } from '../src/tableView';

const q = (filters: object) => `q=${encodeURIComponent(JSON.stringify(filters))}`;

describe('table view in the URL', () => {
  it('omits the defaults', () => {
    expect(encodeTableView(DEFAULT_TABLE_VIEW, '')).toBe('');
    expect(decodeTableView('')).toEqual(DEFAULT_TABLE_VIEW);
    expect(encodeTableView({ ...DEFAULT_TABLE_VIEW, pageIndex: 0 }, '?tab=hits')).toBe('?tab=hits');
  });

  it('round-trips sort, page and columns', () => {
    const views: TableView[] = [
      { sort: { id: 'amr_gene_count', desc: true }, pageIndex: 1, columns: DEFAULT_COLUMN_IDS },
      {
        sort: { id: 'genome_id', desc: false },
        pageIndex: 0,
        columns: [...DEFAULT_COLUMN_IDS, 'n50'],
      },
      { sort: undefined, pageIndex: 41, columns: ['genome_id', 'species_code'] },
      { sort: { id: 'st', desc: false }, pageIndex: 3, columns: ['genome_id', 'typing', 'n50'] },
    ];
    for (const view of views) {
      const search = encodeTableView(view, `?${q({ country: ['CL'] })}`);
      expect(decodeTableView(search), search).toEqual(view);
      expect(decodeFilters(search)).toEqual({ country: ['CL'] });
      expect(encodeTableView(decodeTableView(search), search)).toBe(search);
    }
  });

  it('writes sort, page and cols after the set parameters, then the others', () => {
    const view: TableView = {
      sort: { id: 'amr_gene_count', desc: true },
      pageIndex: 1,
      columns: [...DEFAULT_COLUMN_IDS, 'n50'],
    };
    const current = `?tab=hits&page=9&${q({ country: ['CL'] })}&ids=A1&cols=year&set=s1`;
    expect(encodeTableView(view, current)).toBe(
      `?${q({ country: ['CL'] })}&ids=A1&set=s1&sort=amr_gene_count:desc&page=2` +
        `&cols=${[...DEFAULT_COLUMN_IDS, 'n50'].join(',')}&tab=hits`,
    );
  });

  it('writes the columns in table order with the genome identifier', () => {
    const search = encodeTableView(
      { sort: undefined, pageIndex: 0, columns: ['n50', 'species_code', 'n50'] },
      '',
    );
    expect(search).toBe('?cols=genome_id,species_code,n50');
  });

  it('ignores bad values', () => {
    expect(decodeTableView('?sort=typing:desc').sort).toBeUndefined();
    expect(decodeTableView('?sort=nonsense:asc').sort).toBeUndefined();
    expect(decodeTableView('?sort=amr_gene_count').sort).toBeUndefined();
    expect(decodeTableView('?sort=amr_gene_count:down').sort).toBeUndefined();
    expect(decodeTableView('?sort=%E0%A4%A').sort).toBeUndefined();
    for (const page of ['0', '-1', '1.5', 'two', '', '1e3', '99999999999999999999']) {
      expect(decodeTableView(`?page=${page}`).pageIndex, page).toBe(0);
    }
    expect(decodeTableView('?cols=nonsense').columns).toEqual(DEFAULT_COLUMN_IDS);
    expect(decodeTableView('?cols=').columns).toEqual(DEFAULT_COLUMN_IDS);
    expect(decodeTableView('?cols=nonsense,n50').columns).toEqual(['genome_id', 'n50']);
  });

  it('reads encoded separators and takes the first occurrence', () => {
    expect(decodeTableView('?sort=n50%3Aasc').sort).toEqual({ id: 'n50', desc: false });
    expect(decodeTableView('?cols=n50%2Cyear').columns).toEqual(['genome_id', 'year', 'n50']);
    expect(decodeTableView('?page=2&page=3').pageIndex).toBe(1);
  });

  it('names equal views equally', () => {
    expect(tableViewKey(decodeTableView('?cols=n50,genome_id&page=1'))).toBe(
      tableViewKey(decodeTableView('?cols=genome_id,n50')),
    );
  });
});

describe('a change of set', () => {
  it('drops the page and keeps the sort and the columns', () => {
    const current = `?${q({ country: ['CL'] })}&sort=amr_gene_count:desc&page=2&cols=genome_id,n50`;
    expect(encodeFilters({ country: ['CL', 'PE'] }, current)).toBe(
      `?${q({ country: ['CL', 'PE'] })}&sort=amr_gene_count:desc&cols=genome_id,n50`,
    );
    expect(encodeFilters({}, current)).toBe('?sort=amr_gene_count:desc&cols=genome_id,n50');
    expect(encodeFilters({ genome_id: ['A1'] }, '?page=3')).toBe('?ids=A1');
  });

  it('keeps the page when the set stays the same', () => {
    const current = `?${q({ country: ['CL'] })}&page=2`;
    expect(encodeFilters({ country: ['CL'] }, current)).toBe(current);
    expect(encodeFilters({}, '?page=2&tab=hits')).toBe('?page=2&tab=hits');
  });
});
