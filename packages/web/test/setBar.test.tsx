// @vitest-environment jsdom
// Requirements §5.1, §5.2, §5.5, §5.8, §5.9 and data contract §7.5: the set
// bar shows the count (the manifest's for the whole release, the engine's for
// a filtered set, pending meanwhile), one chip per filter value with a remove
// control, the "add filter" menu in contract order, the complete-genomes
// toggle, "Share link" and "Save set"; an empty set replaces the main area
// with one message; the global search opens its targets with the right query.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnnotationVersionNote } from '../src/components/AnnotationVersionNote';
import type { SearchRow } from '../src/data/searchIndex';
import { RouterProvider } from '../src/router';
import { decodeFilters, encodeFilters } from '../src/set/filters';
import { fieldLabels, menuFields } from '../src/set/fields';
import { strings } from '../src/strings';
import { STUB_COUNT, stubEngine } from './support/engine';
import { manifestFixture, ready } from './support/manifest';
import { renderApp } from './support/render';

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const files = [
  'presence_amr.parquet',
  'presence_mob.parquet',
  'tables/mutation.parquet',
  'tables/genome_set_member.parquet',
  'summaries/amr_class_by_genome.parquet',
].map((path) => ({ path, bytes: 1, sha256: '' }));

const synth = ready(manifestFixture({ files }));

function setBar() {
  return screen.getByRole('banner', { name: strings.setBarLabel });
}

function main() {
  return screen.getByRole('main');
}

describe('set bar count', () => {
  it('shows the engine count for a filtered set, pending meanwhile', async () => {
    let resolve: (value: number) => void = () => undefined;
    const pending = new Promise<number>((done) => {
      resolve = done;
    });
    renderApp(
      `/${encodeFilters({ species_code: ['KPN'] })}`,
      synth,
      stubEngine({
        countSet: () => pending,
      }),
    );
    expect(setBar().textContent).toContain(strings.valuePending);
    await act(async () => {
      resolve(1234);
      await pending;
    });
    expect(within(setBar()).getByText('1,234')).toBeTruthy();
  });

  it('shows the manifest count for the whole release without the engine', () => {
    const countSet = vi.fn(() => Promise.resolve(0));
    renderApp('/', synth, stubEngine({ countSet }));
    expect(within(setBar()).getByText('100')).toBeTruthy();
    expect(countSet).not.toHaveBeenCalled();
  });
});

describe('filter chips', () => {
  const path = `/${encodeFilters({
    species_code: ['KPN'],
    presence_amr: ["aac(6')-Ib-cr5"],
    completeness_min: 95,
    set: ['index-isolate'],
    genome_id: ['KPN0001', 'KPN0002', 'KPN0003', 'KPN0004'],
  })}`;

  it('renders one chip per value with type-set values', async () => {
    renderApp(path, synth);
    const chips = within(setBar()).getByRole('list', { name: strings.activeFiltersLabel });
    const items = within(chips).getAllByRole('listitem');
    expect(items).toHaveLength(5);
    const species = within(chips).getByText('Klebsiella pneumoniae');
    expect(species.className.split(/\s+/)).toEqual(expect.arrayContaining(['font-sans', 'italic']));
    const element = within(chips).getByText("aac(6')-Ib-cr5");
    expect(element.className.split(/\s+/)).toEqual(expect.arrayContaining(['font-mono', 'italic']));
    expect(within(chips).getByText(strings.chipCompleteness('95'))).toBeTruthy();
    expect(within(chips).getByText('Index isolate')).toBeTruthy();
    expect(
      within(chips).getByText(strings.chipGenomeIds('4', 4, 'KPN0001, KPN0002, KPN0003…')),
    ).toBeTruthy();
    await screen.findByText(String(STUB_COUNT));
  });

  it('removes a value from its chip', () => {
    renderApp(path, synth);
    fireEvent.click(
      within(setBar()).getByRole('button', {
        name: strings.removeFilter('Klebsiella pneumoniae'),
      }),
    );
    const filters = decodeFilters(window.location.search);
    expect(filters.species_code).toBeUndefined();
    expect(filters.set).toEqual(['index-isolate']);
  });

  it('links an element name to its Genes page, keeping the set (§5.9)', () => {
    renderApp(path, synth);
    const chips = within(setBar()).getByRole('list', { name: strings.activeFiltersLabel });
    const link = within(chips).getByRole('link', { name: "aac(6')-Ib-cr5" });
    const href = new URL(link.getAttribute('href') ?? '', 'http://localhost');
    expect(href.pathname).toBe(`/genes/element/${encodeURIComponent("aac(6')-Ib-cr5")}`);
    expect(decodeFilters(href.search)).toEqual(decodeFilters(window.location.search));
    expect(within(chips).getAllByRole('link')).toHaveLength(1);
  });
});

describe('empty set (requirements §5.2)', () => {
  it('replaces the main area with the message, the chips and a link that clears the last filter', async () => {
    const filters = { species_code: ['KPN'], country: ['CL'] };
    renderApp(
      `/genes${encodeFilters(filters)}`,
      synth,
      stubEngine({
        countSet: () => Promise.resolve(0),
      }),
    );
    expect(await within(main()).findByText(strings.emptySetStatement)).toBeTruthy();
    expect(within(main()).queryByRole('heading')).toBeNull();
    expect(within(main()).queryByText(strings.placeholderStatement)).toBeNull();
    expect(within(main()).getByText('Klebsiella pneumoniae')).toBeTruthy();
    const link = within(main()).getByRole('link', { name: strings.emptySetClearLast });
    // After a load, the last value is the last in menu order: species, then country.
    expect(link.getAttribute('href')).toBe(`/genes${encodeFilters({ species_code: ['KPN'] })}`);
    fireEvent.click(link);
    expect(decodeFilters(window.location.search)).toEqual({ species_code: ['KPN'] });
    await waitFor(() => {
      expect(within(main()).queryByText(strings.emptySetStatement)).toBeNull();
    });
  });

  it('keeps the page for a non-empty set', async () => {
    renderApp(`/genes${encodeFilters({ species_code: ['KPN'] })}`, synth);
    await screen.findByText(String(STUB_COUNT));
    expect(within(main()).queryByText(strings.emptySetStatement)).toBeNull();
    expect(within(main()).getByText(strings.placeholderStatement)).toBeTruthy();
  });
});

describe('add filter menu', () => {
  it('lists the fields in contract order with the cluster field disabled', () => {
    renderApp('/', synth);
    fireEvent.click(within(setBar()).getByRole('button', { name: strings.addFilter }));
    const dialog = screen.getByRole('dialog', { name: strings.addFilterMenuLabel });
    const labels = within(dialog)
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(labels).toHaveLength(menuFields.length);
    for (const [index, field] of menuFields.entries()) {
      expect(labels[index]).toContain(field.label);
    }
    const cluster = within(dialog).getByText(fieldLabels.cluster);
    expect(cluster.getAttribute('aria-disabled')).toBe('true');
    expect(cluster.getAttribute('title')).toBe(strings.navAbsentPangenome('synth'));
    // The synthetic fixture lists no presence_replicon.parquet.
    expect(within(dialog).getByText(fieldLabels.replicon).getAttribute('aria-disabled')).toBe(
      'true',
    );
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('adds species from the manifest with their names', () => {
    renderApp('/', synth);
    fireEvent.click(within(setBar()).getByRole('button', { name: strings.addFilter }));
    fireEvent.click(screen.getByRole('button', { name: fieldLabels.species_code }));
    const dialog = screen.getByRole('dialog', { name: strings.addFilterMenuLabel });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Escherichia coli/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: strings.filterApply }));
    expect(decodeFilters(window.location.search)).toEqual({ species_code: ['ECO'] });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('offers engine values for a field and narrows them', async () => {
    renderApp(
      '/',
      synth,
      stubEngine({
        filterOptions: () =>
          Promise.resolve(
            ['11', '25', '147', '258', '307', '1', '2', '5', '8', '17'].map((value) => ({
              value,
              count: 1,
            })),
          ),
      }),
    );
    fireEvent.click(within(setBar()).getByRole('button', { name: strings.addFilter }));
    fireEvent.click(screen.getByRole('button', { name: fieldLabels.st }));
    const dialog = screen.getByRole('dialog', { name: strings.addFilterMenuLabel });
    await within(dialog).findByText('ST258');
    fireEvent.change(
      within(dialog).getByRole('searchbox', { name: strings.filterNarrowLabel(fieldLabels.st) }),
      { target: { value: '25' } },
    );
    expect(within(dialog).getAllByRole('checkbox')).toHaveLength(2);
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /ST258/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: strings.filterApply }));
    expect(decodeFilters(window.location.search)).toEqual({ st: ['258'] });
  });

  it('sets a year range', () => {
    renderApp('/', synth);
    fireEvent.click(within(setBar()).getByRole('button', { name: strings.addFilter }));
    fireEvent.click(screen.getByRole('button', { name: fieldLabels.year }));
    fireEvent.change(screen.getByLabelText(strings.filterYearFrom), { target: { value: '2018' } });
    fireEvent.click(screen.getByRole('button', { name: strings.filterApply }));
    expect(decodeFilters(window.location.search)).toEqual({ year: { min: 2018 } });
  });
});

describe('set actions', () => {
  it('toggles complete genomes only', () => {
    renderApp('/', synth);
    fireEvent.click(within(setBar()).getByRole('checkbox', { name: strings.completeOnly }));
    expect(decodeFilters(window.location.search)).toEqual({ assembly_status: ['complete'] });
  });

  it('copies the link and states it', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderApp(`/${encodeFilters({ species_code: ['KPN'] })}`, synth);
    fireEvent.click(within(setBar()).getByRole('button', { name: strings.shareLink }));
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(await within(setBar()).findByText(strings.linkCopied)).toBeTruthy();
  });

  it('saves the exchange file of contract §7.5', async () => {
    const blobs: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return 'blob:set';
    });
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
    const clicks: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push(this.download);
    });
    const filters = { set: ['kpc'], species_code: ['KPN'], genome_id: ['KPN0002', 'KPN0001'] };
    renderApp(
      `/${encodeFilters(filters)}`,
      synth,
      stubEngine({ setGenomeIds: () => Promise.resolve(['KPN0002', 'KPN0001']) }),
    );
    fireEvent.click(within(setBar()).getByRole('button', { name: strings.saveSet }));
    await waitFor(() => {
      expect(clicks).toEqual([strings.savedSetFileName('synth')]);
    });
    const [blob] = blobs;
    if (blob === undefined) throw new Error('no file');
    expect(JSON.parse(await blob.text())).toEqual({
      format: 'genome-set',
      format_version: 1,
      release_id: 'synth',
      name: strings.savedSetName,
      filters: { genome_id: ['KPN0001', 'KPN0002'], set: ['kpc'], species_code: ['KPN'] },
      genome_ids: ['KPN0001', 'KPN0002'],
    });
  });
});

describe('global search (requirements §5.8)', () => {
  const stTarget = `/${encodeFilters({ species_code: ['KPN'], st: ['258'] })}`;
  const rows: SearchRow[] = [
    {
      term: 'KPN0001',
      kind: 'genome_id',
      target: '/genomes/KPN0001',
      species_code: 'KPN',
      count: 1,
    },
    {
      term: 'KPN0002',
      kind: 'genome_id',
      target: '/genomes/KPN0002',
      species_code: 'KPN',
      count: 1,
    },
    { term: 'ST258', kind: 'st', target: stTarget, species_code: 'KPN', count: 9 },
    {
      term: 'DNA gyrase subunit A',
      kind: 'product',
      target: '/genes?search=DNA%20gyrase%20subunit%20A',
      species_code: 'KPN',
      count: 28,
    },
  ];
  const engine = () => stubEngine({ searchRows: () => Promise.resolve(rows) });
  const current = encodeFilters({ country: ['CL'] });

  function input() {
    return within(setBar()).getByRole('combobox');
  }

  it('shows the board placeholder and loads the index on focus', async () => {
    const searchRows = vi.fn(() => Promise.resolve(rows));
    renderApp('/', synth, stubEngine({ searchRows }));
    expect(input().getAttribute('placeholder')).toBe(strings.searchPlaceholder);
    expect(searchRows).not.toHaveBeenCalled();
    fireEvent.focus(input());
    await waitFor(() => {
      expect(searchRows).toHaveBeenCalledTimes(1);
    });
  });

  it('groups results by kind with counts and opens a genome keeping the query', async () => {
    renderApp(`/${current}`, synth, engine());
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: 'kpn' } });
    const listbox = await screen.findByRole('listbox', { name: strings.searchResultsLabel });
    const group = within(listbox).getByRole('group', { name: /Genomes/ });
    expect(within(group).getAllByRole('option')).toHaveLength(2);
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(input().getAttribute('aria-activedescendant')).toBe(
      within(group).getAllByRole('option')[1]?.id,
    );
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(window.location.pathname).toBe('/genomes/KPN0002');
    expect(window.location.search).toBe(current);
  });

  it('navigates directly on Enter with one exact genome identifier', async () => {
    renderApp(`/${current}`, synth, engine());
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: 'kpn0001' } });
    await screen.findByRole('listbox');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(window.location.pathname).toBe('/genomes/KPN0001');
    expect(window.location.search).toBe(current);
  });

  it('replaces the query for a sequence type and keeps it for a product', async () => {
    renderApp(`/${current}`, synth, engine());
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: 'st258' } });
    const option = await screen.findByRole('option', { name: /ST258/ });
    expect(within(option).getByText('Klebsiella pneumoniae').className).toContain('italic');
    fireEvent.click(option);
    expect(`${window.location.pathname}${window.location.search}`).toBe(stTarget);

    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: 'gyrase' } });
    fireEvent.click(await screen.findByRole('option', { name: /DNA gyrase/ }));
    expect(window.location.pathname).toBe('/genes');
    expect(window.location.search).toBe(`${stTarget.slice(1)}&search=DNA%20gyrase%20subunit%20A`);
  });

  it('closes on Escape, then clears', async () => {
    renderApp('/', synth, engine());
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: 'kpn' } });
    await screen.findByRole('listbox');
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect((input() as HTMLInputElement).value).toBe('');
  });
});

describe('annotation version note (requirements §5.6)', () => {
  it('states the versions and links to Methods', () => {
    render(
      <RouterProvider>
        <AnnotationVersionNote
          warning={{ bakta: ['5.1', '6.0'], amrfinderplus: ['2025-12-03.1'] }}
        />
      </RouterProvider>,
    );
    const note = screen.getByRole('note');
    expect(note.textContent).toContain(
      strings.annotationVersionWarning('5.1, 6.0', '2025-12-03.1'),
    );
    expect(
      within(note)
        .getByRole('link', { name: strings.annotationVersionMethods })
        .getAttribute('href'),
    ).toBe('/methods');
  });

  it('renders nothing without a warning', () => {
    const { container } = render(
      <RouterProvider>
        <AnnotationVersionNote warning={null} />
      </RouterProvider>,
    );
    expect(container.textContent).toBe('');
  });
});
