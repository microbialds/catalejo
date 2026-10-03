// @vitest-environment jsdom
// Requirements §5.3 (the genome list, the collection table on a full page),
// §6.1 Controls, §5.2 and checklist C5, G5, G8: /genomes shows the genome
// table alone, with no facet rail or drawer, the Genomes navigation item
// active and the table export menu; it pages by 50 and sorts in the query,
// "Use as set" replaces the set after a confirmation, an empty set shows the
// shell's message, and a page that loads slowly is marked as updating.
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AggregateBuilder, SetEngine } from '../src/data/setEngine';
import { decodeFilters, encodeFilters } from '../src/set/filters';
import type { GenomeFilters } from '../src/set/filters';
import { strings } from '../src/strings';
import { stubEngine } from './support/engine';
import { tableAggregate } from './support/genomeTable';
import { manifestFixture, ready } from './support/manifest';
import { renderApp } from './support/render';

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const synth = ready(manifestFixture());

// A new table page is drawn at low priority (a transition), as on the
// collection page; allow it time to settle on a slow runner.
const pageWait = { timeout: 5000 };

function main() {
  return screen.getByRole('main');
}

function table() {
  return within(main()).getByRole('table', { name: strings.panelGenomes });
}

async function rendered(path = '/genomes', engine: SetEngine = stubEngine()) {
  renderApp(path, synth, engine);
  await within(main()).findByRole('table', { name: strings.panelGenomes }, pageWait);
}

describe('genome list page (/genomes)', () => {
  it('shows the table alone, with the Genomes item active and the export menu', async () => {
    const sql: string[] = [];
    await rendered('/genomes', stubEngine({ aggregate: tableAggregate(sql) }));
    expect(
      within(main()).getByRole('heading', { level: 1, name: strings.pageGenomes }),
    ).toBeTruthy();
    expect(within(table()).getAllByRole('row')).toHaveLength(51);
    expect(screen.queryByRole('complementary', { name: strings.facetsLabel })).toBeNull();
    const setBar = screen.getByRole('banner', { name: strings.setBarLabel });
    expect(within(setBar).queryByRole('button', { name: strings.drawerToggle })).toBeNull();
    expect(within(main()).queryByLabelText(strings.countersLabel)).toBeNull();
    const nav = screen.getByRole('navigation', { name: strings.navigationLabel });
    expect(
      within(nav).getByRole('link', { name: strings.pageGenomes }).getAttribute('aria-current'),
    ).toBe('page');
    const region = within(main()).getByRole('region', { name: strings.panelGenomes });
    expect(within(region).queryByRole('button', { name: /^Expand / })).toBeNull();
    const menu = within(region).getByRole('group', { name: strings.exportMenuLabel });
    expect(
      within(menu)
        .getAllByRole('button')
        .map((entry) => entry.textContent),
    ).toEqual([strings.exportCsvShown, strings.exportCsvSet]);
    expect(sql.at(-1)).toMatch(/ORDER BY t\.genome_id ASC LIMIT 50 OFFSET 0$/);
  });

  it('links identifiers, species and STs as on the collection page, keeping the set', async () => {
    const filters = { country: ['CL'] };
    await rendered(
      `/genomes${encodeFilters(filters)}`,
      stubEngine({ aggregate: tableAggregate() }),
    );
    const id = within(table()).getByRole('link', { name: 'KPN0001' });
    expect(id.getAttribute('href')).toBe(`/genomes/KPN0001${encodeFilters(filters)}`);
    const species = within(table()).getAllByTitle('Klebsiella pneumoniae')[0];
    expect(species?.closest('a')?.getAttribute('href')).toBe(
      `/${encodeFilters({ species_code: ['KPN'] })}`,
    );
    const st = within(table()).getAllByRole('link', { name: 'ST258' })[0];
    expect(st?.getAttribute('href')).toBe(
      `/${encodeFilters({ species_code: ['KPN'], st: ['258'] })}`,
    );
  });

  it('pages by 50 and sorts in the query', async () => {
    const sql: string[] = [];
    await rendered('/genomes', stubEngine({ aggregate: tableAggregate(sql) }));
    expect(within(main()).getByText(strings.tablePageOf('1', '2'))).toBeTruthy();
    fireEvent.click(within(main()).getByRole('button', { name: strings.tableNext }));
    await within(table()).findByRole('link', { name: 'KPN0051' }, pageWait);
    expect(sql.at(-1)).toMatch(/LIMIT 50 OFFSET 50$/);
    fireEvent.click(
      within(table()).getByRole('button', { name: strings.tableSortBy(strings.tableColumnAmr) }),
    );
    await waitFor(() => {
      expect(sql.at(-1)).toMatch(
        /ORDER BY t\.amr_gene_count DESC NULLS LAST, t\.genome_id ASC LIMIT 50 OFFSET 0$/,
      );
    }, pageWait);
  });

  it('prints completeness and contamination as integer percents, exact on hover (§6.1)', async () => {
    await rendered(
      '/genomes?cols=genome_id,checkm2_completeness,checkm2_contamination',
      stubEngine({ aggregate: tableAggregate() }),
    );
    const row = within(table()).getAllByRole('row')[1];
    if (row === undefined) throw new Error('no body row');
    const cells = within(row).getAllByRole('cell');
    // Select, genome, completeness 99.12, contamination 0.5.
    expect(cells[2]?.textContent).toBe('99%');
    expect(cells[2]?.querySelector('[title]')?.getAttribute('title')).toBe(
      strings.valuePercent('99.12'),
    );
    expect(cells[3]?.textContent).toBe('1%');
    expect(cells[3]?.querySelector('[title]')?.getAttribute('title')).toBe(
      strings.valuePercent('0.50'),
    );
  });

  it('shows the typing chip values of the page in a Typing column (§6.1)', async () => {
    const typingSql: string[] = [];
    const engine = stubEngine({
      aggregate: tableAggregate([], {
        sql: typingSql,
        rows: [
          { genome_id: 'KPN0001', source_tool: 'kleborate', key: 'O_locus', value: 'O2afg' },
          { genome_id: 'KPN0001', source_tool: 'kleborate', key: 'K_locus', value: 'KL64' },
        ],
      }),
    });
    const withTyping = ready(
      manifestFixture({ files: [{ path: 'tables/typing.parquet', bytes: 1, sha256: 'x' }] }),
    );
    renderApp('/genomes', withTyping, engine);
    await within(main()).findByText(`KL64${strings.separator}O2afg`, {}, pageWait);
    const header = within(table()).getByRole('columnheader', { name: strings.tableColumnTyping });
    // Not sortable: a plain header.
    expect(within(header).queryByRole('button')).toBeNull();
    const cell = within(main()).getByText(`KL64${strings.separator}O2afg`);
    expect(cell.className.split(/\s+/)).toContain('font-mono');
    // A genome without typing values shows the missing-value mark.
    const second = within(table()).getAllByRole('row')[2];
    const typingIndex = within(table())
      .getAllByRole('columnheader')
      .findIndex((th) => th.textContent === strings.tableColumnTyping);
    expect(second?.querySelectorAll('td')[typingIndex]?.textContent).toBe(strings.valueMissing);
    expect(typingSql).toHaveLength(1);
    expect(typingSql[0]).toContain("'KPN0001'");
    expect(typingSql[0]).toContain("'KPN0050'");
  });

  it('asks for no typing when the release has no typing table', async () => {
    const typingSql: string[] = [];
    await rendered('/genomes', stubEngine({ aggregate: tableAggregate([], { sql: typingSql }) }));
    expect(typingSql).toHaveLength(0);
    expect(
      within(table()).getByRole('columnheader', { name: strings.tableColumnTyping }),
    ).toBeTruthy();
  });

  it('keeps the sort, the page and the columns in the URL (§5.3)', async () => {
    const sql: string[] = [];
    const filters = { country: ['CL'] };
    // Two pages of the set.
    const engine = stubEngine({
      countSet: () => Promise.resolve(100),
      aggregate: tableAggregate(sql),
    });
    await rendered(`/genomes${encodeFilters(filters)}`, engine);
    const pushes = vi.spyOn(window.history, 'pushState');
    fireEvent.click(
      within(table()).getByRole('button', { name: strings.tableSortBy(strings.tableColumnAmr) }),
    );
    await waitFor(() => {
      expect(new URL(window.location.href).searchParams.get('sort')).toBe('amr_gene_count:desc');
    });
    fireEvent.click(within(main()).getByRole('button', { name: strings.tableNext }));
    await within(table()).findByRole('link', { name: 'KPN0051' }, pageWait);
    fireEvent.click(within(main()).getByRole('button', { name: strings.tableColumns }));
    fireEvent.click(within(main()).getByRole('checkbox', { name: strings.tableColumnN50 }));
    expect(pushes).toHaveBeenCalledTimes(3);
    const search = new URL(window.location.href).searchParams;
    expect(search.get('page')).toBe('2');
    expect(search.get('cols')?.split(',')).toContain('n50');
    expect(decodeFilters(window.location.search)).toEqual(filters);
    expect(window.location.search.indexOf('q=')).toBe(1);
    expect(sql.at(-1)).toMatch(
      /ORDER BY t\.amr_gene_count DESC NULLS LAST, t\.genome_id ASC LIMIT 50 OFFSET 50$/,
    );

    // Back undoes the column, then the page.
    await act(async () => {
      window.history.back();
      await new Promise((done) => setTimeout(done, 50));
    });
    await waitFor(() => {
      expect(new URL(window.location.href).searchParams.get('cols')).toBeNull();
    });
    expect(
      within(table()).queryByRole('columnheader', { name: new RegExp(strings.tableColumnN50) }),
    ).toBeNull();
  });

  it('opens a URL with a view in that view, and a new set returns to the first page', async () => {
    const sql: string[] = [];
    await rendered(
      '/genomes?sort=n50:asc&page=2&cols=genome_id,n50',
      stubEngine({ aggregate: tableAggregate(sql) }),
    );
    await within(table()).findByRole('link', { name: 'KPN0051' }, pageWait);
    expect(sql.at(-1)).toMatch(
      /ORDER BY t\.n50 ASC NULLS LAST, t\.genome_id ASC LIMIT 50 OFFSET 50$/,
    );
    expect(
      within(table())
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual([
      '',
      strings.tableColumnGenome,
      `${strings.tableColumnN50}${strings.tableSortedAscending}`,
    ]);
    const st = within(table()).queryAllByRole('link', { name: 'ST258' });
    expect(st).toHaveLength(0);
    // A species link of the table is a new set: no page, same sort and columns.
    fireEvent.click(within(main()).getByRole('button', { name: strings.tableColumns }));
    fireEvent.click(within(main()).getByRole('checkbox', { name: strings.tableColumnSpecies }));
    const species = within(table()).getAllByTitle('Klebsiella pneumoniae')[0]?.closest('a');
    expect(species?.getAttribute('href')).toBe(
      `/${encodeFilters({ species_code: ['KPN'] })}&sort=n50:asc&cols=genome_id,species_code,n50`,
    );
  });

  it('uses the selection as the set after confirming', async () => {
    await rendered('/genomes', stubEngine({ aggregate: tableAggregate() }));
    for (const id of ['KPN0003', 'KPN0001']) {
      fireEvent.click(within(table()).getByRole('checkbox', { name: strings.tableSelectRow(id) }));
    }
    fireEvent.click(within(main()).getByRole('button', { name: strings.useAsSet }));
    const dialog = within(main()).getByRole('alertdialog', { name: strings.useAsSet });
    expect(within(dialog).getByText(strings.useAsSetConfirm('2', 2))).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: strings.useAsSetApply }));
      await Promise.resolve();
    });
    expect(window.location.pathname).toBe('/genomes');
    expect(decodeFilters(window.location.search)).toEqual({ genome_id: ['KPN0001', 'KPN0003'] });
  });

  it('shows the empty-set message and no table for a set without genomes', async () => {
    renderApp(
      `/genomes${encodeFilters({ country: ['XX'] })}`,
      synth,
      stubEngine({ countSet: () => Promise.resolve(0), aggregate: tableAggregate() }),
    );
    expect(await within(main()).findByText(strings.emptySetStatement)).toBeTruthy();
    expect(within(main()).queryByRole('table')).toBeNull();
  });

  it('says it is updating while a slow page loads, then clears (held view)', async () => {
    let release: () => void = () => undefined;
    const answer = tableAggregate();
    const aggregate = async <T,>(filters: GenomeFilters, build: AggregateBuilder) => {
      const rows = await answer<T>(filters, build);
      // The second page waits until the test lets it go.
      if ((rows[0] as { genome_id?: string } | undefined)?.genome_id === 'KPN0051') {
        await new Promise<void>((done) => {
          release = done;
        });
      }
      return rows;
    };
    await rendered('/genomes', stubEngine({ aggregate }));
    const region = within(main()).getByRole('region', { name: strings.panelGenomes });
    expect(region.getAttribute('aria-busy')).toBeNull();
    fireEvent.click(within(main()).getByRole('button', { name: strings.tableNext }));
    expect(await within(region).findByText(strings.panelUpdating, {}, pageWait)).toBeTruthy();
    expect(region.getAttribute('aria-busy')).toBe('true');
    // The previous rows stay on screen while the view is held.
    expect(within(table()).getByRole('link', { name: 'KPN0001' })).toBeTruthy();
    await act(async () => {
      release();
      await Promise.resolve();
    });
    await within(table()).findByRole('link', { name: 'KPN0051' }, pageWait);
    await waitFor(() => {
      expect(within(region).queryByText(strings.panelUpdating)).toBeNull();
    });
    expect(region.getAttribute('aria-busy')).toBeNull();
  });
});
