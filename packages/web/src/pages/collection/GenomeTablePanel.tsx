// Genome table of the collection page (requirements §6.1, §5.2, §5.3, §5.9;
// checklist C5, G2, G11; collection board, table). TanStack Table in manual
// mode draws the sorting, paging, column visibility and row selection state,
// while sorting and paging run in DuckDB (collection/genomeTable.ts): one
// page of 50 rows per request, total pages from the set count. The sort, the
// page and the visible columns live in the URL after the set parameters
// (src/tableView.ts, §5.3): each change pushes a history entry, so Back
// restores it, a reload keeps it, and a change of set drops the page and
// keeps the sort and the columns. After the rows of a page, the Typing
// column's values are read for its genomes (src/data/typing.ts), so the page
// settles once. Completeness and contamination print integer percents with
// the exact value in the cell's title (§6.1). Genome
// identifiers link to their genome page keeping the set; species and STs
// link to the collection filtered by them (links that are themselves
// filters), in the quiet link tier of tables (§5.4). Selection is kept by
// genome identifier across pages and sorts
// and cleared when the set changes; "Use as set" asks, in the page, for a
// confirmation that states the new count, then replaces the set with the
// selected identifiers. The "Columns" chooser closes on Escape, which returns
// the focus to its button, and on a pointer down outside it
// (components/useDismiss.ts).
//
// The panel reads the store of the page's view (see ../Collection.tsx) and
// renders its results at low priority, behind the facet rail (§6.1, §9;
// checklist C4). While a page of rows for the current view loads, the
// previous rows stay and the panel says it is updating (Panel `updating`).
// On the genome list page (/genomes, §5.3; ../Genomes.tsx) it stands alone,
// without the expand control and with the table export menu shown. The rows are memoized and each draws its cells in its own
// render, so that a change of the count or of the pending state does not
// redraw the page of rows, and drawing a new page gives way to a click.
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
import { Checkbox } from '../../components/Checkbox';
import { useDismiss } from '../../components/useDismiss';
import { Link } from '../../components/Link';
import { Panel } from '../../components/Panel';
import type { PanelExpansion } from '../../components/Panel';
import { SpeciesName, Swatch } from '../../components/Species';
import { Table } from '../../components/Table';
import type { TableColumn, TableRow } from '../../components/Table';
import { useManifest } from '../../data/manifest';
import type { SetEngine } from '../../data/setEngine';
import { useEngineQuery, useSetCount } from '../../data/setEngineContext';
import { TYPING_FILE, readTyping } from '../../data/typing';
import { formatCount } from '../../format';
import { QUIET_LINK } from '../../linkTier';
import { palette } from '../../generated/palette';
import { useRouter } from '../../router';
import { vocabularyLabel } from '../../set/fields';
import { decodeFilters, filtersKey } from '../../set/filters';
import type { GenomeFilters } from '../../set/filters';
import { useGenomeSet } from '../../set/store';
import { strings } from '../../strings';
import { canonicalColumns, decodeTableView, encodeTableView, tableViewKey } from '../../tableView';
import type { TableView } from '../../tableView';
import { useSettled } from './data';

const features = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  columnVisibilityFeature,
});

const helper = createColumnHelper<typeof features, GenomeRow>();

const EMPTY: GenomeRow[] = [];
const NO_SELECTION: RowSelectionState = {};
const COLUMN_BY_ID = new Map(GENOME_COLUMNS.map((column) => [column.id, column]));

// The table's results render at low priority, behind the facet rail (C4).
const LOW_PRIORITY = { priority: 'low' } as const;

function visibilityOf(columns: readonly string[]): ColumnVisibilityState {
  const shown = new Set(columns);
  return Object.fromEntries(GENOME_COLUMNS.map((column) => [column.id, shown.has(column.id)]));
}

function resolve<T>(updater: Updater<T>, current: T): T {
  return typeof updater === 'function' ? (updater as (old: T) => T)(current) : updater;
}

function fixed(value: number | null, digits: number): string | null {
  return value === null ? null : value.toFixed(digits);
}

function missing(): ReactNode {
  return <span className="text-text-label">{strings.valueMissing}</span>;
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

/**
 * A CheckM2 percent as an integer, with the exact value (two decimals, the
 * precision CheckM2 writes; the FLOAT column reads back with float noise) in
 * the title (§6.1).
 */
function wholePercent(value: number | null): ReactNode {
  if (value === null) return missing();
  return (
    <span className="font-mono" title={strings.valuePercent(value.toFixed(2))}>
      {strings.valuePercent(String(Math.round(value)))}
    </span>
  );
}

function useCellRenderer() {
  const { queryFor } = useGenomeSet();
  return useCallback(
    (column: GenomeColumn, row: GenomeRow): ReactNode => cell(queryFor, column, row),
    [queryFor],
  );
}

function cell(
  queryFor: (filters: GenomeFilters) => string,
  column: GenomeColumn,
  row: GenomeRow,
): ReactNode {
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
      return row.source_type === null ? missing() : vocabularyLabel('source_type', row.source_type);
    case 'year':
      return mono(row.year === null ? null : String(row.year));
    case 'amr_gene_count':
      return count(row.amr_gene_count);
    case 'plasmid_contig_count':
      return count(row.plasmid_contig_count);
    case 'checkm2_completeness':
      return wholePercent(row.checkm2_completeness);
    case 'typing':
      return row.typing === null ? (
        missing()
      ) : (
        <span className="font-mono text-text-secondary">{row.typing}</span>
      );
    case 'country':
      return mono(row.country);
    case 'platform':
      return row.platform === null ? missing() : vocabularyLabel('platform', row.platform);
    case 'assembly_status':
      return row.assembly_status === null
        ? missing()
        : vocabularyLabel('assembly_status', row.assembly_status);
    case 'checkm2_contamination':
      return wholePercent(row.checkm2_contamination);
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
}

interface Keyed<T> {
  key: string;
  value: T;
}

/** The view a set is drawn with, and the set it was taken for. */
interface AdoptedView {
  key: string;
  view: TableView;
  viewKey: string;
}

/**
 * The table view to draw for the set `setKey`. On the collection page the
 * table may draw an older set than the URL's while the new one loads (see
 * ../Collection.tsx); the URL's view belongs to the URL's set, so it is taken
 * only once the table draws that set, and until then the table keeps the view
 * it had, on the first page for a set other than the one it was taken for.
 */
function useTableView(setKey: string): TableView {
  const { search } = useRouter();
  const urlView = useMemo(() => decodeTableView(search), [search]);
  const urlSetKey = useMemo(() => filtersKey(decodeFilters(search)), [search]);
  const urlViewKey = tableViewKey(urlView);
  const [adopted, setAdopted] = useState<AdoptedView>({
    key: setKey,
    view: urlView,
    viewKey: urlViewKey,
  });
  let current = adopted;
  if (urlSetKey === setKey && (adopted.key !== setKey || adopted.viewKey !== urlViewKey)) {
    current = { key: setKey, view: urlView, viewKey: urlViewKey };
    setAdopted(current);
  }
  return current.key === setKey ? current.view : { ...current.view, pageIndex: 0 };
}

/** Pushes a new table view onto the history, keeping the rest of the query (§5.3). */
function useWriteTableView(): (next: TableView) => void {
  const { navigate } = useRouter();
  return useCallback(
    (next: TableView) => {
      const { pathname, search, hash } = window.location;
      navigate(`${pathname}${hash}`, { replaceQuery: encodeTableView(next, search) });
    },
    [navigate],
  );
}

export function GenomeTablePanel({ expansion }: { expansion?: PanelExpansion }) {
  const { filters, replaceWithIds } = useGenomeSet();
  const manifest = useManifest();
  const hasTyping = manifest?.files.some((file) => file.path === TYPING_FILE) ?? false;
  const setKey = filtersKey(filters);
  const total = useSetCount(filters, LOW_PRIORITY);
  const view = useTableView(setKey);
  const writeView = useWriteTableView();

  // The selection belongs to one set: a new set starts with nothing selected
  // (derived during render). The sort, the page and the columns are the URL's.
  const [selection, setSelection] = useState<Keyed<RowSelectionState>>({ key: setKey, value: {} });
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
  const pages = pageCount(total ?? 0);
  const sort = view.sort;
  // A page past the last one, from an edited URL, shows the last page.
  const page = total === undefined ? view.pageIndex : Math.min(view.pageIndex, pages - 1);
  const sortingState: SortingState = useMemo(
    () => (sort === undefined ? [] : [{ id: sort.id, desc: sort.desc }]),
    [sort],
  );
  const visibility = useMemo(() => visibilityOf(view.columns), [view.columns]);
  const selected = selection.key === setKey ? selection.value : NO_SELECTION;
  const pagination: PaginationState = { pageIndex: page, pageSize: TABLE_PAGE_SIZE };
  // As a row's selection toggle does in TanStack Table: true when on, absent when off.
  const toggleRow = useCallback(
    (id: string, on: boolean) => {
      setSelection((current) => {
        const kept = Object.entries(current.key === setKey ? current.value : NO_SELECTION).filter(
          ([other]) => other !== id,
        );
        return { key: setKey, value: Object.fromEntries(on ? [...kept, [id, true]] : kept) };
      });
    },
    [setKey],
  );

  const sortKey = sort === undefined ? '' : `${sort.id}:${sort.desc ? 'desc' : 'asc'}`;
  const run = useMemo(
    () => async (engine: SetEngine) => {
      const rows = (
        await engine.aggregate(filters, (context) => genomePageSql(context, sort, page), 'low')
      ).map(genomeRow);
      // The Typing column's values for this page; without them the cells
      // show the missing-value mark, and the page still shows.
      const typing = hasTyping
        ? await readTyping(
            engine,
            filters,
            rows.map((row) => row.genome_id),
          ).catch(() => new Map<string, string>())
        : new Map<string, string>();
      // The rows carry their page, which the pager states (see below).
      return {
        page,
        rows: rows.map((row) => ({ ...row, typing: typing.get(row.genome_id) ?? null })),
      };
    },
    [filters, sort, page, hasTyping],
  );
  const result = useEngineQuery(`table:${setKey}:${sortKey}:${String(page)}`, run, LOW_PRIORITY);
  const rowsState = useSettled(result);
  // The rows on screen and the page they are: while a new page loads, the
  // previous rows stay with their own page number, never mixed with the new.
  const shown = rowsState.value;
  const shownPage = shown?.page ?? page;
  const render = useCellRenderer();

  const columns = useMemo(
    () =>
      helper.columns(
        GENOME_COLUMNS.map((column) =>
          helper.accessor(column.id, {
            id: column.id,
            header: column.header,
            enableHiding: column.id !== 'genome_id',
            enableSorting: column.orderBy.length > 0,
            sortDescFirst: column.numeric,
          }),
        ),
      ),
    [],
  );

  const table = useTable({
    features,
    columns,
    data: shown?.rows ?? EMPTY,
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
    // A new sort starts on the first page; a new page or new columns keep the rest.
    onSortingChange: (updater) => {
      const next = resolve(updater, sortingState)[0];
      writeView({
        ...view,
        sort: next === undefined ? undefined : { id: next.id, desc: next.desc },
        pageIndex: 0,
      });
    },
    onPaginationChange: (updater) => {
      writeView({ ...view, pageIndex: resolve(updater, pagination).pageIndex });
    },
    onRowSelectionChange: (updater) => {
      setSelection({ key: setKey, value: resolve(updater, selected) });
    },
    onColumnVisibilityChange: (updater) => {
      const next = resolve(updater, visibility);
      const shownIds = GENOME_COLUMNS.filter((column) => next[column.id] === true).map(
        (column) => column.id,
      );
      writeView({ ...view, columns: canonicalColumns(shownIds) ?? view.columns });
    },
  });

  const selectedIds = Object.keys(selected).filter((id) => selected[id] === true);
  const visibleColumns = table.getVisibleLeafColumns();

  const pageRows = table.getRowModel().rows;
  const pageSelected = pageRows.filter((row) => row.getIsSelected()).length;
  const somePageRowsSelected = pageSelected > 0 && pageSelected < pageRows.length;

  const headerColumns: TableColumn[] = [
    {
      id: 'select',
      header: (
        <Checkbox
          aria-label={strings.tableSelectPage}
          checked={pageRows.length > 0 && pageSelected === pageRows.length}
          indeterminate={somePageRowsSelected}
          onChange={(event) => {
            table.toggleAllPageRowsSelected(event.target.checked);
          }}
        />
      ),
      className: 'w-6',
    },
    ...visibleColumns.map((column) => {
      const definition = COLUMN_BY_ID.get(column.id as GenomeColumn['id']);
      const header = definition?.header ?? column.id;
      return {
        id: column.id,
        header,
        numeric: definition?.numeric ?? false,
        ...(column.getCanSort()
          ? {
              sort: column.getIsSorted(),
              onSort: () => {
                column.toggleSorting(undefined, false);
              },
              sortName: strings.tableSortBy(header),
            }
          : {}),
      };
    }),
  ];

  // One row object per genome, kept while the page, the selection, the
  // visible columns and the links stay the same; each draws its cells when
  // the table renders it.
  const pageData = shown?.rows ?? EMPTY;
  const visibleIds = visibleColumns.map((column) => column.id).join(' ');
  const rows = useMemo<TableRow[]>(() => {
    const definitions = visibleIds
      .split(' ')
      .map((id) => COLUMN_BY_ID.get(id as GenomeColumn['id']));
    return pageData.map((original) => {
      const isSelected = selected[original.genome_id] === true;
      return {
        id: original.genome_id,
        selected: isSelected,
        cells: () => [
          <Checkbox
            key="select"
            aria-label={strings.tableSelectRow(original.genome_id)}
            checked={isSelected}
            onChange={(event) => {
              toggleRow(original.genome_id, event.target.checked);
            }}
          />,
          ...definitions.map((definition) =>
            definition === undefined ? null : render(definition, original),
          ),
        ],
      };
    });
  }, [pageData, selected, visibleIds, render, toggleRow]);

  return (
    <Panel
      title={strings.panelGenomes}
      name={strings.panelGenomes}
      {...(expansion === undefined ? { exportKind: 'table' as const } : { expansion })}
      updating={rowsState.pending && shown !== undefined}
    >
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
                const definition = COLUMN_BY_ID.get(column.id as GenomeColumn['id']);
                return (
                  <label key={column.id} className="flex items-center gap-2 text-control">
                    <Checkbox
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
      {shown === undefined ? (
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
          {strings.tablePageOf(formatCount(shownPage + 1), formatCount(pages))}
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
