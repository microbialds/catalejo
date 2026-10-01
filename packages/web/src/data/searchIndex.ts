// The global search index (requirements §5.8; data contract §6.2). The rows
// of summaries/search_index.parquet hold one term per species; the index
// joins rows with the same kind, term and target (summing their counts, so a
// gene carried by three species is one result) and keeps sequence types
// apart, since their targets name the species. Matching is case-insensitive:
// exact and prefix for identifiers, accessions, gene symbols, element names,
// clusters and sequence types; substring for products. Results are grouped by
// kind in a fixed order, exact matches first, then by genome count.

export type SearchKind =
  'genome_id' | 'accession' | 'gene' | 'element' | 'cluster' | 'product' | 'st';

/** Kinds in the order of requirements §5.8, which is the order of the groups. */
export const searchKinds: readonly SearchKind[] = [
  'genome_id',
  'accession',
  'gene',
  'element',
  'cluster',
  'product',
  'st',
];

const KINDS: ReadonlySet<string> = new Set(searchKinds);

export interface SearchRow {
  term: string;
  kind: SearchKind;
  target: string;
  species_code: string;
  count: number;
}

export interface SearchEntry {
  term: string;
  kind: SearchKind;
  target: string;
  /** Species carrying the term, sorted. */
  speciesCodes: string[];
  /** Genomes carrying the term, summed over species. */
  count: number;
  /** The term in lower case, for matching. */
  folded: string;
}

export interface SearchMatch {
  entry: SearchEntry;
  exact: boolean;
}

export interface SearchGroup {
  kind: SearchKind;
  /** Matches in the group before the cap. */
  total: number;
  matches: SearchMatch[];
}

export type SearchIndex = ReadonlyMap<SearchKind, readonly SearchEntry[]>;

/** Rows from a query result, dropping rows of unknown kinds. */
export function readSearchRows(rows: readonly Record<string, unknown>[]): SearchRow[] {
  const out: SearchRow[] = [];
  for (const row of rows) {
    const { term, kind, target, species_code: species, count } = row;
    if (typeof term !== 'string' || typeof kind !== 'string' || typeof target !== 'string') {
      continue;
    }
    if (!KINDS.has(kind)) continue;
    out.push({
      term,
      kind: kind as SearchKind,
      target,
      species_code: typeof species === 'string' ? species : '',
      count: typeof count === 'number' ? count : Number(count ?? 0),
    });
  }
  return out;
}

/** The index of a set of rows. */
export function buildSearchIndex(rows: readonly SearchRow[]): SearchIndex {
  const joined = new Map<string, SearchEntry>();
  for (const row of rows) {
    const key = `${row.kind}\u0000${row.term}\u0000${row.target}`;
    const known = joined.get(key);
    if (known === undefined) {
      joined.set(key, {
        term: row.term,
        kind: row.kind,
        target: row.target,
        speciesCodes: row.species_code === '' ? [] : [row.species_code],
        count: row.count,
        folded: row.term.toLowerCase(),
      });
    } else {
      known.count += row.count;
      if (row.species_code !== '' && !known.speciesCodes.includes(row.species_code)) {
        known.speciesCodes.push(row.species_code);
        known.speciesCodes.sort();
      }
    }
  }
  const index = new Map<SearchKind, SearchEntry[]>(searchKinds.map((kind) => [kind, []]));
  for (const entry of joined.values()) index.get(entry.kind)?.push(entry);
  return index;
}

/** Kinds matched by substring; every other kind by exact value or prefix. */
const SUBSTRING_KINDS: ReadonlySet<SearchKind> = new Set<SearchKind>(['product']);

function rank(a: SearchMatch, b: SearchMatch): number {
  if (a.exact !== b.exact) return a.exact ? -1 : 1;
  if (a.entry.count !== b.entry.count) return b.entry.count - a.entry.count;
  if (a.entry.folded.length !== b.entry.folded.length) {
    return a.entry.folded.length - b.entry.folded.length;
  }
  return a.entry.term < b.entry.term ? -1 : a.entry.term > b.entry.term ? 1 : 0;
}

/** The groups matching a query, each capped at `limit` results. */
export function matchSearch(index: SearchIndex, query: string, limit = 5): SearchGroup[] {
  const folded = query.trim().toLowerCase();
  if (folded === '') return [];
  const groups: SearchGroup[] = [];
  for (const kind of searchKinds) {
    const entries = index.get(kind) ?? [];
    const substring = SUBSTRING_KINDS.has(kind);
    const matches: SearchMatch[] = [];
    for (const entry of entries) {
      const hit = substring ? entry.folded.includes(folded) : entry.folded.startsWith(folded);
      if (hit) matches.push({ entry, exact: entry.folded === folded });
    }
    if (matches.length === 0) continue;
    matches.sort(rank);
    groups.push({ kind, total: matches.length, matches: matches.slice(0, limit) });
  }
  return groups;
}

/** The genome when the query is exactly one genome identifier, else undefined. */
export function exactGenomeMatch(index: SearchIndex, query: string): SearchEntry | undefined {
  const folded = query.trim().toLowerCase();
  if (folded === '') return undefined;
  const found = (index.get('genome_id') ?? []).filter((entry) => entry.folded === folded);
  return found.length === 1 ? found[0] : undefined;
}

const SET_PARAM_NAMES: ReadonlySet<string> = new Set(['q', 'ids', 'set']);

function paramName(part: string): string {
  const mark = part.indexOf('=');
  const raw = mark >= 0 ? part.slice(0, mark) : part;
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    return raw;
  }
}

/**
 * The href a search result opens (requirements §5.9). A target that carries
 * set parameters (a sequence type, `/?q=...`) is itself a filter and replaces
 * the query; any other target keeps the current query, with the target's own
 * parameters (`/genes?search=...`) replacing those of the same name.
 */
export function searchTargetHref(target: string, currentSearch: string): string {
  const mark = target.indexOf('?');
  const path = mark >= 0 ? target.slice(0, mark) : target;
  const own = (mark >= 0 ? target.slice(mark + 1) : '').split('&').filter((part) => part !== '');
  const current = (currentSearch.startsWith('?') ? currentSearch.slice(1) : currentSearch)
    .split('&')
    .filter((part) => part !== '');
  const ownNames = new Set(own.map(paramName));
  if ([...ownNames].some((name) => SET_PARAM_NAMES.has(name))) return target;
  const parts = [...current.filter((part) => !ownNames.has(paramName(part))), ...own];
  return parts.length === 0 ? path : `${path}?${parts.join('&')}`;
}
