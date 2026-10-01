// Requirements §5.8 and data contract §6.2: the global search joins index rows
// of the same kind, term and target, keeps sequence types per species,
// matches exact and prefix (substring for products) without regard to case,
// groups results by kind in a fixed order with counts, and completes well
// within 200 ms on a loaded index of 50,000 rows.
import { describe, expect, it } from 'vitest';
import {
  buildSearchIndex,
  exactGenomeMatch,
  matchSearch,
  readSearchRows,
  searchKinds,
} from '../src/data/searchIndex';
import type { SearchKind, SearchRow } from '../src/data/searchIndex';

function row(kind: SearchKind, term: string, target: string, species: string, count = 1) {
  return { kind, term, target, species_code: species, count } satisfies SearchRow;
}

const rows: SearchRow[] = [
  row('genome_id', 'KPN0001', '/genomes/KPN0001', 'KPN'),
  row('genome_id', 'KPN0010', '/genomes/KPN0010', 'KPN'),
  row('genome_id', 'kpn0100', '/genomes/kpn0100', 'KPN'),
  row('accession', 'SAMN0001', '/genomes/KPN0001', 'KPN'),
  row('gene', 'gyrA', '/genes/symbol/gyrA', 'KPN', 28),
  row('gene', 'gyrA', '/genes/symbol/gyrA', 'ECO', 8),
  row('gene', 'gyrB', '/genes/symbol/gyrB', 'ECO', 8),
  row('element', 'blaKPC-2', '/genes/element/blaKPC-2', 'KPN', 8),
  row('product', 'DNA gyrase subunit A', '/genes?search=DNA%20gyrase%20subunit%20A', 'KPN', 28),
  row('product', 'DNA gyrase subunit A', '/genes?search=DNA%20gyrase%20subunit%20A', 'ECO', 8),
  row(
    'st',
    'ST11',
    '/?q=%7B%22species_code%22%3A%5B%22KPN%22%5D%2C%22st%22%3A%5B%2211%22%5D%7D',
    'KPN',
    4,
  ),
  row(
    'st',
    'ST11',
    '/?q=%7B%22species_code%22%3A%5B%22SEN%22%5D%2C%22st%22%3A%5B%2211%22%5D%7D',
    'SEN',
    4,
  ),
];

describe('search index', () => {
  const index = buildSearchIndex(rows);

  it('joins rows of one kind, term and target and sums their counts', () => {
    const [group] = matchSearch(index, 'gyrA');
    expect(group?.kind).toBe('gene');
    expect(group?.matches[0]?.entry).toMatchObject({
      term: 'gyrA',
      count: 36,
      speciesCodes: ['ECO', 'KPN'],
    });
  });

  it('keeps sequence types of different species apart', () => {
    const st = matchSearch(index, 'st11').find((group) => group.kind === 'st');
    expect(st?.total).toBe(2);
    expect(st?.matches.map((match) => match.entry.speciesCodes)).toEqual([['KPN'], ['SEN']]);
  });

  it('matches by prefix without regard to case, exact first', () => {
    const [genomes] = matchSearch(index, 'kpn00');
    expect(genomes?.kind).toBe('genome_id');
    expect(genomes?.matches.map((match) => match.entry.term)).toEqual(['KPN0001', 'KPN0010']);
    const exact = matchSearch(index, 'KPN0010')[0]?.matches[0];
    expect(exact).toMatchObject({ exact: true, entry: { term: 'KPN0010' } });
  });

  it('matches products by substring only', () => {
    const groups = matchSearch(index, 'gyrase');
    expect(groups.map((group) => group.kind)).toEqual(['product']);
    expect(groups[0]?.matches[0]?.entry.count).toBe(36);
    expect(matchSearch(index, 'yrA').map((group) => group.kind)).toEqual(['product']);
  });

  it('groups in the fixed order of kinds with counts before the cap', () => {
    const many = buildSearchIndex([
      ...Array.from({ length: 12 }, (_, i) =>
        row('genome_id', `G${String(i).padStart(3, '0')}`, `/genomes/G${String(i)}`, 'KPN'),
      ),
      row('gene', 'gA', '/genes/symbol/gA', 'KPN'),
      row('product', 'protein G', '/genes?search=protein%20G', 'KPN'),
    ]);
    const groups = matchSearch(many, 'g', 5);
    expect(groups.map((group) => group.kind)).toEqual(['genome_id', 'gene', 'product']);
    expect(groups[0]?.total).toBe(12);
    expect(groups[0]?.matches).toHaveLength(5);
    expect(searchKinds).toEqual([
      'genome_id',
      'accession',
      'gene',
      'element',
      'cluster',
      'product',
      'st',
    ]);
  });

  it('finds a single exact genome identifier', () => {
    expect(exactGenomeMatch(index, ' kpn0001 ')?.target).toBe('/genomes/KPN0001');
    expect(exactGenomeMatch(index, 'KPN000')).toBeUndefined();
  });

  it('returns nothing for an empty query', () => {
    expect(matchSearch(index, '   ')).toEqual([]);
  });

  it('reads rows of known kinds only', () => {
    expect(
      readSearchRows([
        { term: 'x', kind: 'gene', target: '/genes/symbol/x', species_code: 'KPN', count: 2 },
        { term: 'y', kind: 'other', target: '/', species_code: 'KPN', count: 1 },
      ]),
    ).toEqual([row('gene', 'x', '/genes/symbol/x', 'KPN', 2)]);
  });
});

describe('search timing (requirements §5.8)', () => {
  it('matches within 200 ms on a 50,000-row index', () => {
    const species = ['KPN', 'ECO', 'SEN', 'SAU', 'PAE'];
    const words = ['protein', 'transporter', 'kinase', 'regulator', 'subunit', 'putative'];
    const synthetic: SearchRow[] = [];
    for (let i = 0; i < 50_000; i += 1) {
      const code = species[i % species.length] ?? 'KPN';
      const kind = searchKinds[i % searchKinds.length] ?? 'gene';
      const term =
        kind === 'product'
          ? `${words[i % words.length] ?? ''} ${words[(i * 7) % words.length] ?? ''} ${String(i)}`
          : `${code}${String(i).padStart(6, '0')}`;
      synthetic.push(row(kind, term, `/genomes/${term}`, code, (i % 50) + 1));
    }
    const built = performance.now();
    const index = buildSearchIndex(synthetic);
    const buildTime = performance.now() - built;
    const queries = ['k', 'KPN0001', 'kinase', 'sub', 'ECO04999', 'zzz', 'protein transporter'];
    // One call before timing, so the bound measures matching on a loaded
    // index (§5.8) and not the first compilation of the matcher, which the
    // parallel test workers can delay well past the requirement's 200 ms.
    matchSearch(index, queries[0] ?? '');
    for (const query of queries) {
      const start = performance.now();
      matchSearch(index, query);
      exactGenomeMatch(index, query);
      const elapsed = performance.now() - start;
      expect(elapsed, query).toBeLessThan(200);
    }
    expect(buildTime).toBeLessThan(1000);
  });
});
