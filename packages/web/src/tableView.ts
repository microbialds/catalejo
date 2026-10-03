// The genome table's view in the URL (requirements §5.3, §6.1; checklist C5).
// View parameters follow the set parameters: `sort=<column>:<asc|desc>`,
// `page=<n>` (1-based, omitted for the first page) and `cols=<column ids>`
// (comma-separated in table order, omitted when the default columns are
// shown). The same parameters apply on / and /genomes, and route changes
// keep them since they are part of the query. A change of set drops `page`
// (src/set/filters.ts, encodeFilters) and keeps `sort` and `cols`.
//
// Decoding is tolerant: an unknown or unsortable column, a direction other
// than asc or desc, a page that is not a positive integer and unknown column
// identifiers are ignored, and the first occurrence of a parameter wins.
// Encoding is canonical: the set parameters first as written, then sort,
// page and cols, then every other parameter unchanged and in its order.
import {
  DEFAULT_COLUMN_IDS,
  GENOME_COLUMNS,
  isGenomeColumnId,
  isSortable,
} from './collection/genomeTable';
import type { GenomeColumnId, TableSort } from './collection/genomeTable';
import { SET_PARAMS } from './set/filters';

export const VIEW_PARAMS = ['sort', 'page', 'cols'] as const;

export interface TableView {
  /** The sorted column, or undefined for the default order (genome_id). */
  sort: TableSort | undefined;
  /** The page, 0-based. */
  pageIndex: number;
  /** The visible columns in table order; genome_id is always among them. */
  columns: readonly GenomeColumnId[];
}

export const DEFAULT_TABLE_VIEW: TableView = {
  sort: undefined,
  pageIndex: 0,
  columns: DEFAULT_COLUMN_IDS,
};

interface Param {
  name: string;
  raw: string;
  /** The part as written. */
  text: string;
}

function decode(text: string): string | undefined {
  try {
    return decodeURIComponent(text.replace(/\+/g, ' '));
  } catch {
    return undefined;
  }
}

function paramsOf(search: string): Param[] {
  const bare = search.startsWith('?') ? search.slice(1) : search;
  return bare
    .split('&')
    .filter((text) => text !== '')
    .map((text) => {
      const mark = text.indexOf('=');
      const rawName = mark >= 0 ? text.slice(0, mark) : text;
      return { name: decode(rawName) ?? rawName, raw: mark >= 0 ? text.slice(mark + 1) : '', text };
    });
}

function decodeSort(raw: string): TableSort | undefined {
  const text = decode(raw)?.trim() ?? '';
  const mark = text.lastIndexOf(':');
  if (mark < 0) return undefined;
  const id = text.slice(0, mark);
  const direction = text.slice(mark + 1);
  if (!isSortable(id) || (direction !== 'asc' && direction !== 'desc')) return undefined;
  return { id, desc: direction === 'desc' };
}

function decodePage(raw: string): number | undefined {
  const text = decode(raw)?.trim() ?? '';
  if (!/^\d+$/.test(text)) return undefined;
  const page = Number(text);
  return Number.isSafeInteger(page) && page >= 1 ? page - 1 : undefined;
}

/** Known identifiers in table order, with genome_id; undefined when none is known. */
export function canonicalColumns(ids: readonly string[]): GenomeColumnId[] | undefined {
  const known = new Set(ids.filter(isGenomeColumnId));
  if (known.size === 0) return undefined;
  known.add('genome_id');
  return GENOME_COLUMNS.map((column) => column.id).filter((id) => known.has(id));
}

function decodeColumns(raw: string): GenomeColumnId[] | undefined {
  const text = decode(raw) ?? '';
  return canonicalColumns(text.split(',').map((id) => id.trim()));
}

function sameColumns(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** The table view a query string carries. Never throws. */
export function decodeTableView(search: string): TableView {
  let sort: TableSort | undefined;
  let pageIndex: number | undefined;
  let columns: GenomeColumnId[] | undefined;
  const seen = new Set<string>();
  for (const param of paramsOf(search)) {
    if (seen.has(param.name)) continue;
    if (param.name === 'sort') sort = decodeSort(param.raw);
    else if (param.name === 'page') pageIndex = decodePage(param.raw);
    else if (param.name === 'cols') columns = decodeColumns(param.raw);
    else continue;
    seen.add(param.name);
  }
  return { sort, pageIndex: pageIndex ?? 0, columns: columns ?? DEFAULT_COLUMN_IDS };
}

/** The view parameters of a view, in canonical order, without the defaults. */
export function tableViewParams(view: TableView): string[] {
  const parts: string[] = [];
  if (view.sort !== undefined && isSortable(view.sort.id)) {
    parts.push(`sort=${view.sort.id}:${view.sort.desc ? 'desc' : 'asc'}`);
  }
  const page = Math.floor(view.pageIndex);
  if (Number.isSafeInteger(page) && page > 0) parts.push(`page=${String(page + 1)}`);
  const columns = canonicalColumns(view.columns) ?? DEFAULT_COLUMN_IDS;
  if (!sameColumns(columns, DEFAULT_COLUMN_IDS)) parts.push(`cols=${columns.join(',')}`);
  return parts;
}

/**
 * The query string, with "?" or "", for `current` with its table view
 * replaced by `view`: the set parameters as written, then the view, then
 * every other parameter of `current` in its order.
 */
export function encodeTableView(view: TableView, current = ''): string {
  const setNames = new Set<string>(SET_PARAMS);
  const viewNames = new Set<string>(VIEW_PARAMS);
  const params = paramsOf(current);
  const parts = [
    ...params.filter((param) => setNames.has(param.name)).map((param) => param.text),
    ...tableViewParams(view),
    ...params
      .filter((param) => !setNames.has(param.name) && !viewNames.has(param.name))
      .map((param) => param.text),
  ];
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

/** A string naming a view, equal for equal views. */
export function tableViewKey(view: TableView): string {
  return tableViewParams(view).join('&');
}
