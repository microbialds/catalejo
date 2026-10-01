// Table (requirements §7, components; §5.10; collection board, table). A
// heavy ink top rule, light row rules, uppercase letterspaced column headers
// in secondary text, 30 px rows, and horizontal scroll inside its container
// so the page never scrolls sideways. Sortable headers are buttons that
// state the sort through aria-sort. Cells are given by the caller, which sets
// identifiers and counts in monospace and species names in italic serif.
import type { ReactNode } from 'react';
import { strings } from '../strings';

export type SortDirection = 'asc' | 'desc' | false;

export interface TableColumn {
  id: string;
  header: ReactNode;
  /** Right-aligned (counts). */
  numeric?: boolean;
  /** The current sort, when the column sorts. */
  sort?: SortDirection;
  onSort?: () => void;
  /** Accessible name of the sort control. */
  sortName?: string;
  /** Classes of the header and cells of this column (widths). */
  className?: string;
}

export interface TableRow {
  id: string;
  selected?: boolean;
  cells: ReactNode[];
}

const ARIA_SORT = { asc: 'ascending', desc: 'descending' } as const;
const SORT_MARK = {
  asc: strings.tableSortedAscending,
  desc: strings.tableSortedDescending,
} as const;

export function Table({
  label,
  columns,
  rows,
  busy = false,
}: {
  label: string;
  columns: TableColumn[];
  rows: TableRow[];
  busy?: boolean;
}) {
  return (
    <div className="min-w-0 overflow-x-auto">
      <table
        aria-label={label}
        aria-busy={busy}
        className="w-full border-collapse border-t border-t-ink text-control"
      >
        <thead>
          <tr className="h-7.5 border-b border-border-strong">
            {columns.map((column) => {
              const sort = column.sort ?? false;
              return (
                <th
                  key={column.id}
                  scope="col"
                  {...(sort === false ? {} : { 'aria-sort': ARIA_SORT[sort] })}
                  className={`px-1 text-small font-semibold tracking-label whitespace-nowrap text-text-secondary uppercase ${
                    column.numeric === true ? 'text-right' : 'text-left'
                  } ${column.className ?? ''}`}
                >
                  {column.onSort === undefined ? (
                    column.header
                  ) : (
                    <button
                      type="button"
                      className="inline-flex items-baseline gap-1 font-semibold tracking-label uppercase hover:text-ink"
                      {...(column.sortName === undefined ? {} : { 'aria-label': column.sortName })}
                      onClick={column.onSort}
                    >
                      {column.header}
                      {sort !== false && (
                        <span aria-hidden="true" className="text-micro">
                          {SORT_MARK[sort]}
                        </span>
                      )}
                    </button>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              {...(row.selected === true ? { 'data-selected': '' } : {})}
              className={`h-7.5 border-b border-rule-light ${row.selected === true ? 'bg-background' : ''}`}
            >
              {row.cells.map((cell, index) => {
                const column = columns[index];
                return (
                  <td
                    key={column?.id ?? index}
                    className={`px-1 whitespace-nowrap ${column?.numeric === true ? 'text-right' : ''} ${
                      column?.className ?? ''
                    }`}
                  >
                    {cell}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
