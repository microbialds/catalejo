// Table (requirements §7, components; §5.4, §5.10; collection board, table).
// A heavy ink top rule, light row rules, sentence case bold column headers in
// secondary text, 30 px rows, and horizontal scroll inside its container so
// the page never scrolls sideways. Sortable headers are buttons that state
// the sort through aria-sort. Cells are given by the caller, which sets
// identifiers and counts in monospace and species names in italic sans;
// every link in a cell is in the quiet tier (§5.4), underlined on hover and
// focus only. Body rows are memoized and keyed by position: a row redraws
// when its row object or the columns change, a new page updates the rows in
// place, and a row given as a function draws its cells in its own render
// (requirements §9, checklist C4).
import { memo, useMemo } from 'react';
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
  /** The cells, or a function drawing them when the row renders. */
  cells: ReactNode[] | (() => ReactNode[]);
}

/** A body column: its identifier and the classes of its cells. */
type CellColumn = [id: string, className: string];

const CELL_CLASS = 'px-1 whitespace-nowrap';

function cellClass(column: TableColumn): string {
  return `${CELL_CLASS} ${column.numeric === true ? 'text-right' : ''} ${column.className ?? ''}`;
}

const BodyRow = memo(function BodyRow({
  row,
  columns,
}: {
  row: TableRow;
  columns: readonly CellColumn[];
}) {
  const cells = typeof row.cells === 'function' ? row.cells() : row.cells;
  return (
    <tr
      {...(row.selected === true ? { 'data-selected': '' } : {})}
      className={`h-7.5 border-b border-rule-light ${row.selected === true ? 'bg-background' : ''}`}
    >
      {cells.map((cell, index) => {
        const column = columns[index];
        return (
          <td key={column?.[0] ?? index} className={column?.[1] ?? CELL_CLASS}>
            {cell}
          </td>
        );
      })}
    </tr>
  );
});

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
  // The body columns as a value, so that rows skip renders while they hold.
  const cellKey = JSON.stringify(columns.map((column) => [column.id, cellClass(column)]));
  const cellColumns = useMemo(() => JSON.parse(cellKey) as CellColumn[], [cellKey]);
  return (
    <div className="min-w-0 overflow-x-auto [&_a]:link-quiet">
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
                  className={`px-1 text-small font-bold tracking-label whitespace-nowrap text-text-secondary ${
                    column.numeric === true ? 'text-right' : 'text-left'
                  } ${column.className ?? ''}`}
                >
                  {column.onSort === undefined ? (
                    column.header
                  ) : (
                    <button
                      type="button"
                      className="inline-flex items-baseline gap-1 font-bold tracking-label hover:text-ink"
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
          {rows.map((row, index) => (
            // Rows are keyed by position, so a new page updates the rows in
            // place instead of mounting new ones; they hold no state.
            <BodyRow key={index} row={row} columns={cellColumns} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
