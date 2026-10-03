// Data contract §7.5 and requirements §5.3: the filter object, its canonical
// form, and its encoding in the query string (q=, ids=, set=), with tolerant
// decoding and other parameters kept as written.
import { describe, expect, it } from 'vitest';
import {
  canonicalFilters,
  decodeFilters,
  encodeFilters,
  filterEntries,
  filterKeys,
  isCompleteOnly,
  isWholeRelease,
  withCompleteOnly,
  withoutValue,
  withValue,
} from '../src/set/filters';
import type { GenomeFilters } from '../src/set/filters';

const every: GenomeFilters = {
  species_code: ['KPN', 'ECO'],
  st: ['258', 'ST258-1LV'],
  source_type: ['clinical'],
  country: ['CL', 'AR'],
  year: { min: 2015, max: 2022 },
  platform: ['ont', 'illumina'],
  assembly_status: ['complete'],
  completeness_min: 95,
  contamination_max: 5.5,
  presence_amr: ["aac(6')-Ib-cr5", 'blaKPC-2'],
  drug_class: ['carbapenem'],
  mutation: ['gyrA_S83L'],
  replicon: ['IncFIB(K)', 'Col440I'],
  plasmid_contig: true,
  presence_mob: ['AA107'],
  prophage: true,
  cluster: ['KPN.2026-09.group_1234'],
  set: ['kpc-plasmid-carriers', 'index-isolate'],
  genome_id: ['KPN0002', 'KPN0001'],
};

describe('the filter fields', () => {
  it('follow the rows of contract §7.5', () => {
    expect(filterKeys).toEqual([
      'species_code',
      'st',
      'source_type',
      'country',
      'year',
      'platform',
      'assembly_status',
      'completeness_min',
      'contamination_max',
      'presence_amr',
      'drug_class',
      'mutation',
      'replicon',
      'plasmid_contig',
      'presence_mob',
      'prophage',
      'cluster',
      'set',
      'genome_id',
    ]);
  });
});

describe('canonical form', () => {
  it('sorts keys and values, removes repeats and drops empty values', () => {
    const canonical = canonicalFilters({
      st: ['258', '11', '258'],
      species_code: ['KPN'],
      country: [],
      year: {},
      prophage: false,
    } as unknown as GenomeFilters);
    expect(JSON.stringify(canonical)).toBe('{"species_code":["KPN"],"st":["11","258"]}');
  });

  it('treats no filter as the whole release', () => {
    expect(isWholeRelease({})).toBe(true);
    expect(isWholeRelease({ country: [], year: {} })).toBe(true);
    expect(isWholeRelease({ prophage: true })).toBe(false);
  });

  it('encodes different orders identically', () => {
    const a = encodeFilters({ st: ['258', '11'], species_code: ['KPN', 'ECO'] });
    const b = encodeFilters({ species_code: ['ECO', 'KPN', 'KPN'], st: ['11', '258'] });
    expect(a).toBe(b);
  });

  it('writes the contract §7.5 example with sorted keys', () => {
    const canonical = canonicalFilters({
      species_code: ['KPN'],
      st: ['258'],
      presence_amr: ['blaKPC-2'],
    });
    expect(JSON.stringify(canonical)).toBe(
      '{"presence_amr":["blaKPC-2"],"species_code":["KPN"],"st":["258"]}',
    );
  });
});

describe('URL encoding (requirements §5.3)', () => {
  it('round-trips every key', () => {
    const search = encodeFilters(every);
    expect(decodeFilters(search)).toEqual(canonicalFilters(every));
    expect(encodeFilters(decodeFilters(search))).toBe(search);
  });

  it.each(filterKeys.map((key) => [key]))('round-trips %s alone', (key) => {
    const one = { [key]: (every as Record<string, unknown>)[key] } as GenomeFilters;
    const search = encodeFilters(one);
    expect(decodeFilters(search)).toEqual(canonicalFilters(one));
  });

  it('carries set and genome_id outside q', () => {
    const search = encodeFilters({
      species_code: ['KPN'],
      set: ['b', 'a'],
      genome_id: ['X2', 'X1'],
    });
    const params = new URLSearchParams(search);
    expect(JSON.parse(params.get('q') ?? '')).toEqual({ species_code: ['KPN'] });
    expect(params.get('ids')).toBe('X1,X2');
    expect(params.get('set')).toBe('a,b');
    expect(search.startsWith('?q=')).toBe(true);
    expect(search).toContain('&ids=X1,X2&set=a,b');
  });

  it('writes q as the percent-encoded compact JSON', () => {
    expect(encodeFilters({ species_code: ['KPN'], st: ['258'] })).toBe(
      '?q=%7B%22species_code%22%3A%5B%22KPN%22%5D%2C%22st%22%3A%5B%22258%22%5D%7D',
    );
  });

  it('encodes a set identifier holding a comma and reads it back', () => {
    const search = encodeFilters({ set: ['a,b', 'c'] });
    expect(search).toBe('?set=a%2Cb,c');
    expect(decodeFilters(search).set).toEqual(['a,b', 'c']);
  });

  it('reads ids written with encoded commas', () => {
    expect(decodeFilters('?ids=X1%2CX2').genome_id).toEqual(['X1', 'X2']);
  });

  it('keeps other parameters as written, after the set parameters', () => {
    const current = '?search=16S%20ribosomal&q=%7B%7D&tab=hits&ids=A1';
    const next = encodeFilters({ country: ['CL'] }, current);
    expect(next).toBe(
      `?q=${encodeURIComponent('{"country":["CL"]}')}&search=16S%20ribosomal&tab=hits`,
    );
    expect(encodeFilters({}, current)).toBe('?search=16S%20ribosomal&tab=hits');
    expect(encodeFilters({}, '')).toBe('');
  });

  it('reads a missing query as the whole release', () => {
    expect(decodeFilters('')).toEqual({});
    expect(decodeFilters('?')).toEqual({});
    expect(decodeFilters('?tab=hits')).toEqual({});
  });

  it.each(['?q=%7B', '?q=not-json', '?q=%E0%A4%A', '?q=%5B1%2C2%5D', '?q=null', '?q=42', '?q='])(
    'ignores a malformed q in %s without throwing',
    (search) => {
      expect(decodeFilters(search)).toEqual({});
    },
  );

  it('keeps ids and set when q is malformed', () => {
    expect(decodeFilters('?q=%7B&ids=A1&set=s1')).toEqual({ genome_id: ['A1'], set: ['s1'] });
  });

  it('drops unknown keys and values of the wrong type', () => {
    const q = JSON.stringify({
      cohort: ['x'],
      species_code: 'KPN',
      st: [258, '11', null, ''],
      year: { min: '2015', max: 2020 },
      completeness_min: '95',
      contamination_max: 5,
      prophage: 'yes',
      plasmid_contig: true,
      set: ['in-q'],
      genome_id: ['in-q'],
    });
    expect(decodeFilters(`?q=${encodeURIComponent(q)}`)).toEqual({
      contamination_max: 5,
      plasmid_contig: true,
      species_code: ['KPN'],
      st: ['11', '258'],
      year: { max: 2020 },
    });
  });

  it('reads a q with keys in any order and spaces', () => {
    const q = '{ "st": ["258"], "species_code": ["KPN"] }';
    expect(decodeFilters(`?q=${encodeURIComponent(q)}`)).toEqual({
      species_code: ['KPN'],
      st: ['258'],
    });
  });
});

describe('editing', () => {
  it('adds and removes values', () => {
    const added = withValue({ st: ['258'] }, 'st', '11');
    expect(added.st).toEqual(['11', '258']);
    expect(withoutValue(added, 'st', '11').st).toEqual(['258']);
    expect(withoutValue(added, 'st', '258')).toEqual({ st: ['11'] });
    expect(withoutValue({ year: { min: 2020 } }, 'year')).toEqual({});
  });

  it('lists entries in menu order, ids as one entry', () => {
    const entries = filterEntries({
      genome_id: ['B', 'A'],
      species_code: ['KPN', 'ECO'],
      completeness_min: 95,
      prophage: true,
    });
    expect(entries).toEqual([
      { key: 'species_code', value: 'ECO' },
      { key: 'species_code', value: 'KPN' },
      { key: 'completeness_min', value: 95 },
      { key: 'prophage' },
      { key: 'genome_id', values: ['A', 'B'] },
    ]);
  });

  it('toggles complete genomes only (requirements §5.5)', () => {
    expect(isCompleteOnly({ assembly_status: ['complete'] })).toBe(true);
    expect(isCompleteOnly({ assembly_status: ['complete', 'draft'] })).toBe(false);
    const on = withCompleteOnly({ assembly_status: ['draft'] }, true);
    expect(on.assembly_status).toEqual(['complete']);
    expect(withCompleteOnly(on, false)).toEqual({});
  });
});
