// Genome table of the collection page (requirements §6.1, §5.2, §5.9;
// checklist C5, G2, G11; collection board, table). TanStack Table in manual
// mode holds the sorting, paging, column visibility and row selection state,
// while sorting and paging run in DuckDB (collection/genomeTable.ts): one
// page of 50 rows per request, total pages from the set count. Genome
// identifiers link to their genome page keeping the set; species and STs
// link to the collection filtered by them (links that are themselves
// filters), in the quiet link tier of tables (§5.4). Selection is kept by
// genome identifier across pages and sorts
// and cleared when the set changes; "Use as set" asks, in the page, for a
// confirmation that states the new count, then replaces the set with the
// selected identifiers. The "Columns" chooser closes on Escape, which returns
// the focus to its button, and on a pointer down outside it
// (components/useDismiss.ts).
import { useCallback, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { ReactNode } from 'react';
import {
  columnVisibilityFeature,
  createColumnHelper,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import type {
  PaginationState,
  RowSelectionState,
  SortingState,
  Updater,
  ColumnVisibilityState,
} from '@tanstack/react-table';
import {
  GENOME_COLUMNS,
  TABLE_PAGE_SIZE,
  genomePageSql,
  genomeRow,
  pageCount,
} from '../../collection/genomeTable';
import type { GenomeColumn, GenomeRow } from '../../collection/genomeTable';
import { Button } from '../../components/Button';
import { useDismiss } from '../../components/useDismiss';
import { Link } from '../../components/Link';
import { Panel } from '../../components/Panel';
import type { PanelExpansion } from '../../components/Panel';
import { SpeciesName, Swatch } from '../../components/Species';
import { Table } from '../../components/Table';
import type { TableColumn } from '../../components/Table';
import type { SetEngine } from '../../data/setEngine';
import { useEngineQuery, useSetCount } from '../../data/setEngineContext';
import { formatCount } from '../../format';
import { QUIET_LINK } from '../../linkTier';
import { palette } from '../../generated/palette';
import { vocabularyLabel } from '../../set/fields';
import { filtersKey } from '../../set/filters';
import { useGenomeSet } from '../../set/store';
import { strings } from '../../strings';
import { useSettled } from './data';

const features = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  columnVisibilityFeature,
});

const helper = createColumnHelper<typeof features, GenomeRow>();

const EMPTY: GenomeRow[] = [];

const initialVisibility: ColumnVisibilityState = Object.fromEntries(
  GENOME_COLUMNS.map((column) => [column.id, column.defaultVisible]),
);

function resolve<T>(updater: Updater<T>, current: T): T {
  return typeof updater === 'function' ? (updater as (old: T) => T)(current) : updater;
}

function fixed(value: number | null, digits: number): string | null {
  return value === null ? null : value.toFixed(digits);
}

function missing(): ReactNode {
  return <span className="text-text-faint">{strings.valueMissing}</span>;
}

function mono(text: string | null): ReactNode {
  return text === null ? missing() : <span className="font-mono">{text}</span>;
}

function count(value: number | null): ReactNode {
  return mono(value === null ? null : formatCount(value));
}

function percent(value: number | null): ReactNode {
  const text = fixed(value, 1);
  return mono(text === null ? null : strings.valuePercent(text));
}

function useCellRenderer() {
  const { queryFor } = useGenomeSet();
  return (column: GenomeColumn, row: GenomeRow): ReactNode => {
    switch (column.id) {
      case 'genome_id':
        return (
          <Link
            to={`/genomes/${encodeURIComponent(row.genome_id)}`}
            className={`font-mono ${QUIET_LINK}`}
          >
            {row.genome_id}
          </Link>
        );
      case 'species_code': {
        const name = row.canonical_name ?? row.species_code;
        return (
          <Link
            to="/"
            query={queryFor({ species_code: [row.species_code] })}
            className={`inline-flex items-center gap-1.5 ${QUIET_LINK}`}
          >
            <Swatch color={row.color ?? palette.species.other} />
            <SpeciesName name={name} short className="text-base" />
          </Link>
        );
      }
      case 'st':
        return row.st === null ? (
          missing()
        ) : (
          <Link
            to="/"
            query={queryFor({ species_code: [row.species_code], st: [row.st] })}
            className={`font-mono ${QUIET_LINK}`}
          >
            {strings.chipSt(row.st)}
          </Link>
        );
      case 'source_type':
        return row.source_type === null
          ? missing()
          : vocabularyLabel('source_type', row.source_type);
      case 'year':
        return mono(row.year === null ? null : String(row.year));
      case 'amr_gene_count':
        return count(row.amr_gene_count);
      case 'plasmid_contig_count':
        return count(row.plasmid_contig_count);
      case 'checkm2_completeness':
        return percent(row.checkm2_completeness);
      case 'country':
        return mono(row.country);
      case 'platform':
        return row.platform === null ? missing() : vocabularyLabel('platform', row.platform);
      case 'assembly_status':
        return row.assembly_status === null
          ? missing()
          : vocabularyLabel('assembly_status', row.assembly_status);
      case 'checkm2_contamination':
        return percent(row.checkm2_contamination);
      case 'genome_size': {
        const text = row.genome_size === null ? null : (row.genome_size / 1e6).toFixed(2);
        return mono(text === null ? null : strings.valueMegabases(text));
      }
      case 'contig_count':
        return count(row.contig_count);
      case 'n50':
        return count(row.n50);
      case 'gc_content':
        return percent(row.gc_content);
    }
  };
}

interface Keyed<T> {
  key: string;
  value: T;
}

export function GenomeTablePanel({ expansion }: { expansion: PanelExpansion }) {
  const { filters, replaceWithIds } = useGenomeSet();
  const setKey = filtersKey(filters);
  const total = useSetCount(filters);

  // Sorting, the page and the selection belong to one set: a new set starts
  // on the first page with nothing selected (derived during render).
  const [sorting, setSorting] = useState<Keyed<SortingState>>({ key: setKey, value: [] });
  const [pageIndex, setPageIndex] = useState<Keyed<number>>({ key: setKey, value: 0 });
  const [selection, setSelection] = useState<Keyed<RowSelectionState>>({ key: setKey, value: {} });
  const [visibility, setVisibility] = useState<ColumnVisibilityState>(initialVisibility);
  const [confirming, setConfirming] = useState(false);
  const useAsSetButton = useRef<HTMLButtonElement>(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  const chooserRoot = useRef<HTMLDivElement>(null);
  const chooserButton = useRef<HTMLButtonElement>(null);
  const closeChooser = useCallback(() => {
    setChooserOpen(false);
  }, []);
  // Escape closes the column chooser and returns the focus to "Columns"; a
  // pointer down outside it closes it (requirements §9).
  useDismiss(chooserOpen, { root: chooserRoot, trigger: chooserButton, onClose: closeChooser });
  const sortingState = sorting.key === setKey ? sorting.value : [];
  const page = pageIndex.key === setKey ? pageIndex.value : 0;
  const selected = selection.key === setKey ? selection.value : {};
  const pagination: PaginationState = { pageIndex: page, pageSize: TABLE_PAGE_SIZE };

  const sort = sortingState[0];
  const sortKey = sort === undefined ? '' : `${sort.id}:${sort.desc ? 'desc' : 'asc'}`;
  const run = useMemo(
    () => async (engine: SetEngine) => {
      const rows = await engine.aggregate(filters, (context) => genomePageSql(context, sort, page));
      return rows.map(genomeRow);
    },
    [filters, sort, page],
  );
  const result = useEngineQuery(`table:${setKey}:${sortKey}:${String(page)}`, run);
  const rowsState = useSettled(result);
  const render = useCellRenderer();

  const columns = useMemo(
    () =>
      helper.columns(
        GENOME_COLUMNS.map((column) =>
          helper.accessor(column.id, {
            id: column.id,
            header: column.header,
            enableHiding: column.id !== 'genome_id',
            sortDescFirst: column.numeric,
          }),
        ),
      ),
    [],
  );

  const table = useTable({
    features,
    columns,
    data: rowsState.value ?? EMPTY,
    getRowId: (row) => row.genome_id,
    manualSorting: true,
    manualPagination: true,
    enableSortingRemoval: false,
    enableMultiSort: false,
    rowCount: total ?? 0,
    state: {
      sorting: sortingState,
      pagination,
      rowSelection: selected,
      columnVisibility: visibility,
    },
    onSortingChange: (updater) => {
      setSorting({ key: setKey, value: resolve(updater, sortingState) });
      setPageIndex({ key: setKey, value: 0 });
    },
    onPaginationChange: (updater) => {
      setPageIndex({ key: setKey, value: resolve(updater, pagination).pageIndex });
    },
    onRowSelectionChange: (updater) => {
      setSelection({ key: setKey, value: resolve(updater, selected) });
    },
    onColumnVisibilityChange: (updater) => {
      setVisibility((current) => resolve(updater, current));
    },
  });

  const selectedIds = Object.keys(selected).filter((id) => selected[id] === true);
  const pages = pageCount(total ?? 0);
  const visibleColumns = table.getVisibleLeafColumns();
  const byId = new Map(GENOME_COLUMNS.map((column) => [column.id, column]));

  const pageRows = table.getRowModel().rows;
  const pageSelected = pageRows.filter((row) => row.getIsSelected()).length;
  const somePageRowsSelected = pageSelected > 0 && pageSelected < pageRows.length;

  const headerColumns: TableColumn[] = [
    {
      id: 'select',
      header: (
        <input
          type="checkbox"
          className="m-0 size-3.25 accent-ink align-middle"
          aria-label={strings.tableSelectPage}
          checked={pageRows.length > 0 && pageSelected === pageRows.length}
          ref={(element) => {
            if (element !== null) element.indeterminate = somePageRowsSelected;
          }}
          onChange={(event) => {
            table.toggleAllPageRowsSelected(event.target.checked);
          }}
        />
      ),
      className: 'w-6',
    },
    ...visibleColumns.map((column) => {
      const definition = byId.get(column.id as GenomeColumn['id']);
      const header = definition?.header ?? column.id;
      return {
        id: column.id,
        header,
        numeric: definition?.numeric ?? false,
        sort: column.getIsSorted(),
        onSort: () => {
          column.toggleSorting(undefined, false);
        },
        sortName: strings.tableSortBy(header),
      };
    }),
  ];

  const rows = pageRows.map((row) => ({
    id: row.id,
    selected: row.getIsSelected(),
    cells: [
      <input
        key="select"
        type="checkbox"
        className="m-0 size-3.25 accent-ink align-middle"
        aria-label={strings.tableSelectRow(row.original.genome_id)}
        checked={row.getIsSelected()}
        onChange={(event) => {
          row.toggleSelected(event.target.checked);
        }}
      />,
      ...visibleColumns.map((column) => {
        const definition = byId.get(column.id as GenomeColumn['id']);
        return definition === undefined ? null : render(definition, row.original);
      }),
    ],
  }));

  return (
    <Panel title={strings.panelGenomes} name={strings.panelGenomes} expansion={expansion}>
      <div className="flex flex-wrap items-center gap-x-panel-gap gap-y-2 pb-2">
        <div ref={chooserRoot} className="relative">
          <Button
            ref={chooserButton}
            variant="secondary"
            className="py-0.5"
            aria-expanded={chooserOpen}
            onClick={() => {
              setChooserOpen(!chooserOpen);
            }}
          >
            {strings.tableColumns}
          </Button>
          {chooserOpen && (
            <fieldset className="absolute top-full left-0 z-20 mt-1 flex w-48 flex-col gap-1 border border-border-strong bg-panel p-2">
              <legend className="sr-only">{strings.tableColumnsLabel}</legend>
              {table.getAllLeafColumns().map((column) => {
                const definition = byId.get(column.id as GenomeColumn['id']);
                return (
                  <label key={column.id} className="flex items-center gap-2 text-control">
                    <input
                      type="checkbox"
                      className="m-0 accent-ink"
                      checked={column.getIsVisible()}
                      disabled={!column.getCanHide()}
                      onChange={(event) => {
                        column.toggleVisibility(event.target.checked);
                      }}
                    />
                    {definition?.header ?? column.id}
                  </label>
                );
              })}
            </fieldset>
          )}
        </div>
        {selectedIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span role="status" className="font-mono text-control">
              {strings.tableSelected(formatCount(selectedIds.length))}
            </span>
            <Button
              ref={useAsSetButton}
              variant="primary"
              className="py-0.5"
              disabled={confirming}
              onClick={() => {
                setConfirming(true);
              }}
            >
              {strings.useAsSet}
            </Button>
            <Button
              variant="link"
              disabled={confirming}
              onClick={() => {
                table.resetRowSelection(true);
              }}
            >
              {strings.tableClearSelection}
            </Button>
          </div>
        )}
      </div>
      {confirming && selectedIds.length > 0 && (
        <div
          role="alertdialog"
          aria-label={strings.useAsSet}
          className="mb-2 flex flex-wrap items-center gap-3 border border-border-strong bg-background px-3 py-2"
        >
          <p className="text-control">
            {strings.useAsSetConfirm(formatCount(selectedIds.length), selectedIds.length)}
          </p>
          <Button
            variant="primary"
            className="py-0.5"
            autoFocus
            onClick={() => {
              setConfirming(false);
              replaceWithIds([...selectedIds].sort());
            }}
          >
            {strings.useAsSetApply}
          </Button>
          <Button
            variant="secondary"
            className="py-0.5"
            onClick={() => {
              // Back to the control that opened the confirmation.
              flushSync(() => {
                setConfirming(false);
              });
              useAsSetButton.current?.focus();
            }}
          >
            {strings.useAsSetCancel}
          </Button>
        </div>
      )}
      {rowsState.value === undefined ? (
        <p
          className="text-control text-text-secondary"
          {...(rowsState.failed ? { role: 'alert' } : {})}
        >
          {rowsState.failed ? strings.tableLoadFailed : strings.tableLoading}
        </p>
      ) : (
        <Table
          label={strings.panelGenomes}
          columns={headerColumns}
          rows={rows}
          busy={rowsState.pending}
        />
      )}
      <nav
        aria-label={strings.tablePagerLabel}
        className="flex items-center justify-end gap-3 pt-2"
      >
        <Button
          variant="link"
          disabled={!table.getCanPreviousPage()}
          onClick={() => {
            table.previousPage();
          }}
        >
          {strings.tablePrevious}
        </Button>
        <span className="font-mono text-control text-text-secondary">
          {strings.tablePageOf(formatCount(page + 1), formatCount(pages))}
        </span>
        <Button
          variant="link"
          disabled={!table.getCanNextPage()}
          onClick={() => {
            table.nextPage();
          }}
        >
          {strings.tableNext}
        </Button>
      </nav>
    </Panel>
  );
}
