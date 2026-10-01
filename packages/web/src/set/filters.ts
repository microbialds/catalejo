// The filter object of a genome set (data contract §7.5; requirements §5.2,
// §5.3). One key per row of the contract table, in the order of the "add
// filter" menu; values within a key are alternatives and keys combine.
//
// Canonical form (contract §7.5): keys in sorted order, arrays sorted by code
// unit and without repeats, empty arrays, an empty year and false flags left
// out, so that one set has one URL. In the URL (requirements §5.3) the `set`
// and `genome_id` keys travel as `set=` and `ids=` (comma-separated, each
// value percent-encoded) and every other key as `q=`, the compact JSON of the
// canonical object percent-encoded as a whole, the same form the search index
// writes for its sequence type targets (contract §6.2). Other query
// parameters are kept as written. A missing query means the whole release;
// decoding never throws, and a malformed `q` or an unknown key is ignored.

/** Keys whose value is an array of alternatives. */
export type ListKey =
  | 'species_code'
  | 'st'
  | 'source_type'
  | 'country'
  | 'platform'
  | 'assembly_status'
  | 'presence_amr'
  | 'drug_class'
  | 'mutation'
  | 'replicon'
  | 'presence_mob'
  | 'cluster'
  | 'set'
  | 'genome_id';

/** Keys whose value is `true` when present. */
export type FlagKey = 'plasmid_contig' | 'prophage';

/** Keys whose value is one number, in percent. */
export type NumberKey = 'completeness_min' | 'contamination_max';

export interface YearRange {
  min?: number;
  max?: number;
}

export type FilterKey = ListKey | FlagKey | NumberKey | 'year';

export type GenomeFilters = Partial<Record<ListKey, string[]>> &
  Partial<Record<FlagKey, true>> &
  Partial<Record<NumberKey, number>> & { year?: YearRange };

export type FilterKind = 'list' | 'flag' | 'number' | 'year';

export interface FilterField {
  key: FilterKey;
  kind: FilterKind;
}

/** The fields in the order of the "add filter" menu (contract §7.5 table order). */
export const filterFields: readonly FilterField[] = [
  { key: 'species_code', kind: 'list' },
  { key: 'st', kind: 'list' },
  { key: 'source_type', kind: 'list' },
  { key: 'country', kind: 'list' },
  { key: 'year', kind: 'year' },
  { key: 'platform', kind: 'list' },
  { key: 'assembly_status', kind: 'list' },
  { key: 'completeness_min', kind: 'number' },
  { key: 'contamination_max', kind: 'number' },
  { key: 'presence_amr', kind: 'list' },
  { key: 'drug_class', kind: 'list' },
  { key: 'mutation', kind: 'list' },
  { key: 'replicon', kind: 'list' },
  { key: 'plasmid_contig', kind: 'flag' },
  { key: 'presence_mob', kind: 'list' },
  { key: 'prophage', kind: 'flag' },
  { key: 'cluster', kind: 'list' },
  { key: 'set', kind: 'list' },
  { key: 'genome_id', kind: 'list' },
];

export const filterKeys: readonly FilterKey[] = filterFields.map((field) => field.key);

const kindOf = new Map<FilterKey, FilterKind>(filterFields.map((f) => [f.key, f.kind]));

export function fieldKind(key: FilterKey): FilterKind {
  return kindOf.get(key) ?? 'list';
}

export function isListKey(key: FilterKey): key is ListKey {
  return fieldKind(key) === 'list';
}

export function isFilterKey(key: string): key is FilterKey {
  return kindOf.has(key as FilterKey);
}

/** The keys that travel outside `q=`. */
const OUTSIDE_Q: ReadonlySet<FilterKey> = new Set<FilterKey>(['set', 'genome_id']);

/** Query parameter names that carry the set (requirements §5.3). */
export const SET_PARAMS = ['q', 'ids', 'set'] as const;

/** Code-unit order, the same on every engine. */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Whether a string can be a filter value (DuckDB literals hold no NUL). */
function usableText(value: string): boolean {
  return value !== '' && !value.includes('\u0000');
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values.filter(usableText))].sort(compareText);
}

/** The canonical form of a filter object: a new object, keys sorted. */
export function canonicalFilters(filters: GenomeFilters): GenomeFilters {
  const out: Record<string, unknown> = {};
  for (const key of [...filterKeys].sort(compareText)) {
    const kind = fieldKind(key);
    const value = (filters as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (kind === 'list') {
      const values = sortedUnique(value as string[]);
      if (values.length > 0) out[key] = values;
    } else if (kind === 'flag') {
      if (value === true) out[key] = true;
    } else if (kind === 'number') {
      if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    } else {
      const range = value as YearRange;
      const year: YearRange = {};
      if (range.max !== undefined && Number.isInteger(range.max)) year.max = range.max;
      if (range.min !== undefined && Number.isInteger(range.min)) year.min = range.min;
      // Keys of the year object are sorted too: max before min.
      if (year.min !== undefined || year.max !== undefined) out[key] = year;
    }
  }
  return out;
}

/** Whether the filters select the whole release. */
export function isWholeRelease(filters: GenomeFilters): boolean {
  return Object.keys(canonicalFilters(filters)).length === 0;
}

/** A stable key for a filter object, equal for equal sets of filters. */
export function filtersKey(filters: GenomeFilters): string {
  return JSON.stringify(canonicalFilters(filters));
}

export function sameFilters(a: GenomeFilters, b: GenomeFilters): boolean {
  return filtersKey(a) === filtersKey(b);
}

// Reading values tolerantly from parsed JSON.

function readList(value: unknown): string[] | undefined {
  const items = Array.isArray(value) ? value : [value];
  const strings: string[] = [];
  for (const item of items) {
    if (typeof item === 'string') strings.push(item);
    else if (typeof item === 'number' && Number.isFinite(item)) strings.push(String(item));
  }
  const values = sortedUnique(strings);
  return values.length > 0 ? values : undefined;
}

function readYear(value: unknown): YearRange | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const year: YearRange = {};
  if (typeof record.min === 'number' && Number.isInteger(record.min)) year.min = record.min;
  if (typeof record.max === 'number' && Number.isInteger(record.max)) year.max = record.max;
  return year.min === undefined && year.max === undefined ? undefined : year;
}

/** The filter keys of a parsed `q` object; unknown keys and bad values dropped. */
export function readFilterObject(json: unknown, keys: Iterable<FilterKey> = filterKeys) {
  const out: GenomeFilters = {};
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return out;
  const record = json as Record<string, unknown>;
  const target = out as Record<string, unknown>;
  for (const key of keys) {
    if (!Object.hasOwn(record, key)) continue;
    const value = record[key];
    switch (fieldKind(key)) {
      case 'list': {
        const list = readList(value);
        if (list !== undefined) target[key] = list;
        break;
      }
      case 'flag':
        if (value === true) target[key] = true;
        break;
      case 'number':
        if (typeof value === 'number' && Number.isFinite(value)) target[key] = value;
        break;
      case 'year': {
        const year = readYear(value);
        if (year !== undefined) target[key] = year;
        break;
      }
    }
  }
  return canonicalFilters(out);
}

// The query string.

interface RawParam {
  /** The decoded name. */
  name: string;
  /** The raw value as written, without decoding. */
  raw: string;
  /** The part as written, kept for parameters this module does not own. */
  text: string;
}

function decodeComponent(text: string): string | undefined {
  try {
    return decodeURIComponent(text.replace(/\+/g, ' '));
  } catch {
    return undefined;
  }
}

function rawParams(search: string): RawParam[] {
  const bare = search.startsWith('?') ? search.slice(1) : search;
  if (bare === '') return [];
  const params: RawParam[] = [];
  for (const text of bare.split('&')) {
    if (text === '') continue;
    const mark = text.indexOf('=');
    const rawName = mark >= 0 ? text.slice(0, mark) : text;
    const raw = mark >= 0 ? text.slice(mark + 1) : '';
    params.push({ name: decodeComponent(rawName) ?? rawName, raw, text });
  }
  return params;
}

/** Comma-separated values, each percent-decoded; undecodable pieces dropped. */
function splitList(raw: string): string[] {
  const values: string[] = [];
  for (const piece of raw.split(',')) {
    const value = decodeComponent(piece);
    if (value !== undefined) values.push(value.trim());
  }
  return values;
}

/** The filters a query string carries (requirements §5.3). Never throws. */
export function decodeFilters(search: string): GenomeFilters {
  const out: GenomeFilters = {};
  const qKeys = filterKeys.filter((key) => !OUTSIDE_Q.has(key));
  for (const param of rawParams(search)) {
    if (param.name === 'q') {
      const text = decodeComponent(param.raw);
      if (text === undefined) continue;
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        continue;
      }
      Object.assign(out, readFilterObject(json, qKeys));
    } else if (param.name === 'ids') {
      // Genome identifiers hold no comma (contract §3.1), so a list written
      // with %2C separators reads the same.
      const text = decodeComponent(param.raw) ?? '';
      out.genome_id = [...(out.genome_id ?? []), ...text.split(',').map((id) => id.trim())];
    } else if (param.name === 'set') {
      out.set = [...(out.set ?? []), ...splitList(param.raw)];
    }
  }
  return canonicalFilters(out);
}

function encodeList(values: readonly string[]): string {
  return values.map((value) => encodeURIComponent(value)).join(',');
}

/**
 * The query string for a filter object, with "?" or "" when empty. The set
 * parameters come first, as q, ids, set; every other parameter of `current`
 * follows unchanged and in its order.
 */
export function encodeFilters(filters: GenomeFilters, current = ''): string {
  const canonical = canonicalFilters(filters);
  const parts: string[] = [];
  const inQ: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(canonical)) {
    if (!OUTSIDE_Q.has(key as FilterKey)) inQ[key] = value;
  }
  if (Object.keys(inQ).length > 0) parts.push(`q=${encodeURIComponent(JSON.stringify(inQ))}`);
  if (canonical.genome_id !== undefined) parts.push(`ids=${encodeList(canonical.genome_id)}`);
  if (canonical.set !== undefined) parts.push(`set=${encodeList(canonical.set)}`);
  const owned = new Set<string>(SET_PARAMS);
  for (const param of rawParams(current)) {
    if (!owned.has(param.name)) parts.push(param.text);
  }
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

// Editing.

/** A filter object with one value added to a list key. */
export function withValue(filters: GenomeFilters, key: ListKey, value: string): GenomeFilters {
  return canonicalFilters({ ...filters, [key]: [...(filters[key] ?? []), value] });
}

/**
 * A filter object without one value of a list key, or without the whole key
 * when `value` is undefined or the key is not a list.
 */
export function withoutValue(
  filters: GenomeFilters,
  key: FilterKey,
  value?: string,
): GenomeFilters {
  const next: Record<string, unknown> = { ...filters };
  if (value !== undefined && isListKey(key)) {
    next[key] = (filters[key] ?? []).filter((item) => item !== value);
  } else {
    Reflect.deleteProperty(next, key);
  }
  return canonicalFilters(next);
}

/** A filter object with one key set, or removed when `value` is undefined. */
export function withKey<K extends FilterKey>(
  filters: GenomeFilters,
  key: K,
  value: GenomeFilters[K] | undefined,
): GenomeFilters {
  const next: Record<string, unknown> = { ...filters };
  if (value === undefined) Reflect.deleteProperty(next, key);
  else next[key] = value;
  return canonicalFilters(next);
}

/**
 * One entry per filter value, in menu order and canonical value order: a list
 * key gives one entry per value, except `genome_id`, which is one entry for
 * the whole list; every other key gives one entry.
 */
export type FilterEntry =
  | { key: Exclude<ListKey, 'genome_id'>; value: string }
  | { key: 'genome_id'; values: string[] }
  | { key: FlagKey }
  | { key: NumberKey; value: number }
  | { key: 'year'; value: YearRange };

export function filterEntries(filters: GenomeFilters): FilterEntry[] {
  const canonical = canonicalFilters(filters);
  const entries: FilterEntry[] = [];
  for (const { key } of filterFields) {
    switch (key) {
      case 'genome_id':
        if (canonical.genome_id) entries.push({ key, values: canonical.genome_id });
        break;
      case 'plasmid_contig':
      case 'prophage':
        if (canonical[key] === true) entries.push({ key });
        break;
      case 'completeness_min':
      case 'contamination_max': {
        const value = canonical[key];
        if (value !== undefined) entries.push({ key, value });
        break;
      }
      case 'year':
        if (canonical.year) entries.push({ key, value: canonical.year });
        break;
      default:
        for (const value of canonical[key] ?? []) entries.push({ key, value });
    }
  }
  return entries;
}

/** A stable identity for an entry, used to track insertion order. */
export function entryId(entry: FilterEntry): string {
  switch (entry.key) {
    case 'genome_id':
    case 'plasmid_contig':
    case 'prophage':
      return entry.key;
    case 'completeness_min':
    case 'contamination_max':
    case 'year':
      return `${entry.key}\u0000${JSON.stringify(entry.value)}`;
    default:
      return `${entry.key}\u0000${entry.value}`;
  }
}

/** The filters without one entry. */
export function withoutEntry(filters: GenomeFilters, entry: FilterEntry): GenomeFilters {
  if ('value' in entry && typeof entry.value === 'string') {
    return withoutValue(filters, entry.key, entry.value);
  }
  return withoutValue(filters, entry.key);
}

/** The "complete genomes only" state (requirements §5.5). */
export function isCompleteOnly(filters: GenomeFilters): boolean {
  const status = filters.assembly_status;
  return status?.length === 1 && status[0] === 'complete';
}

/** The filters with the "complete genomes only" toggle set or cleared. */
export function withCompleteOnly(filters: GenomeFilters, on: boolean): GenomeFilters {
  if (on) return withKey(filters, 'assembly_status', ['complete']);
  return withoutValue(filters, 'assembly_status', 'complete');
}
