// @vitest-environment jsdom
// Requirements §5.1 (the set bar keeps its 56 px height at every width): the
// fit of the chips on one line as a pure function of the widths, the "+N
// more" control and its popover with every chip, and below the breakpoints
// the "Set" control that groups "+ add filter", "complete genomes only",
// "Share link" and "Save set", with the search field at the top of the
// navigation menu. jsdom has no layout, so the widths and the viewport are
// stubbed: ResizeObserver, getBoundingClientRect and matchMedia.
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { visibleChipCount } from '../src/components/chipFit';
import { decodeFilters, encodeFilters } from '../src/set/filters';
import { strings } from '../src/strings';
import { manifestFixture, ready } from './support/manifest';
import { renderApp } from './support/render';

const synth = ready(manifestFixture());

function setBar() {
  return screen.getByRole('banner', { name: strings.setBarLabel });
}

describe('visibleChipCount', () => {
  it('shows every chip when they fit on the line', () => {
    expect(visibleChipCount([100, 100], 208, 8, 60)).toBe(2);
    expect(visibleChipCount([], 0, 8, 60)).toBe(0);
  });

  it('keeps room for "+N more" when some chips do not fit', () => {
    // 60 + (100 + 8) = 168 fits in 250; one more chip needs 276.
    expect(visibleChipCount([100, 100, 100], 250, 8, 60)).toBe(1);
    expect(visibleChipCount([100, 100, 100], 276, 8, 60)).toBe(2);
  });

  it('follows the store order and never skips a wide chip for a narrow one', () => {
    expect(visibleChipCount([50, 300, 20], 200, 8, 60)).toBe(1);
  });

  it('shows no chip when even the first does not fit beside the control', () => {
    expect(visibleChipCount([167, 120], 174, 8, 64)).toBe(0);
    expect(visibleChipCount([167], 20, 8, 64)).toBe(0);
  });

  it('allows subpixel rounding at the exact width', () => {
    expect(visibleChipCount([100.4, 100.4], 208.5, 8, 60)).toBe(2);
  });
});

/** Stubs the layout of the chips row: the row is `rowWidth` wide, each chip 100 px, "+N more" 60 px. */
function stubLayout(rowWidth: number) {
  class Observer {
    readonly callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe() {
      this.callback([], this);
    }
    unobserve() {
      return undefined;
    }
    disconnect() {
      return undefined;
    }
  }
  vi.stubGlobal('ResizeObserver', Observer);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    let width = 0;
    if (this.tagName === 'LI') width = 100;
    else if (this.tagName === 'BUTTON' && this.textContent.endsWith('more')) width = 60;
    else if (this.tagName === 'DIV' && this.className.includes('self-stretch')) width = rowWidth;
    return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0 } as DOMRect;
  });
}

/** Stubs matchMedia so that every min-width query is false (a 390 px viewport). */
function stubNarrowViewport() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })),
  );
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const threeFilters = `/${encodeFilters({
  species_code: ['KPN'],
  country: ['CL'],
  source_type: ['clinical'],
})}`;

describe('"+N more" (requirements §5.1)', () => {
  it('shows the chips that fit and counts the others', () => {
    stubLayout(250);
    renderApp(threeFilters, synth);
    const row = within(setBar()).getByRole('list', { name: strings.activeFiltersLabel });
    expect(within(row).getAllByRole('listitem')).toHaveLength(1);
    expect(within(row).getByText('Klebsiella pneumoniae')).toBeTruthy();
    const more = within(setBar()).getByRole('button', { name: strings.moreFilters(2) });
    expect(more.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows every chip and no control when they fit', () => {
    stubLayout(400);
    renderApp(threeFilters, synth);
    const row = within(setBar()).getByRole('list', { name: strings.activeFiltersLabel });
    expect(within(row).getAllByRole('listitem')).toHaveLength(3);
    expect(within(setBar()).queryByRole('button', { name: /more$/ })).toBeNull();
  });

  it('opens every chip with its remove control, and Escape returns the focus', () => {
    stubLayout(250);
    renderApp(threeFilters, synth);
    const more = within(setBar()).getByRole('button', { name: strings.moreFilters(2) });
    fireEvent.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    const popover = within(setBar()).getByRole('dialog', { name: strings.allFiltersLabel });
    const all = within(popover).getByRole('list', { name: strings.allFiltersLabel });
    expect(within(all).getAllByRole('listitem')).toHaveLength(3);
    for (const label of [
      'Klebsiella pneumoniae',
      `${strings.chipPrefixCountry} CL`,
      `${strings.chipPrefixSourceType} ${strings.sourceTypeClinical}`,
    ]) {
      expect(within(all).getByRole('button', { name: strings.removeFilter(label) })).toBeTruthy();
    }
    expect(popover.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(within(setBar()).queryByRole('dialog', { name: strings.allFiltersLabel })).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it('removes a hidden chip from the popover and closes it once every chip fits', () => {
    stubLayout(250);
    renderApp(threeFilters, synth);
    fireEvent.click(within(setBar()).getByRole('button', { name: strings.moreFilters(2) }));
    const popover = within(setBar()).getByRole('dialog', { name: strings.allFiltersLabel });
    fireEvent.click(
      within(popover).getByRole('button', {
        name: strings.removeFilter(`${strings.chipPrefixCountry} CL`),
      }),
    );
    expect(decodeFilters(window.location.search)).toEqual({
      species_code: ['KPN'],
      source_type: ['clinical'],
    });
    // Two chips of 100 px fit in 250 px: no control, no popover.
    expect(within(setBar()).queryByRole('dialog', { name: strings.allFiltersLabel })).toBeNull();
    expect(within(setBar()).queryByRole('button', { name: /more$/ })).toBeNull();
    const row = within(setBar()).getByRole('list', { name: strings.activeFiltersLabel });
    expect(within(row).getAllByRole('listitem')).toHaveLength(2);
    const removes = within(row).getAllByRole('button');
    expect(document.activeElement).toBe(removes[removes.length - 1]);
  });

  it('closes on a pointer down outside', () => {
    stubLayout(250);
    renderApp(threeFilters, synth);
    fireEvent.click(within(setBar()).getByRole('button', { name: strings.moreFilters(2) }));
    expect(within(setBar()).getByRole('dialog', { name: strings.allFiltersLabel })).toBeTruthy();
    fireEvent.pointerDown(screen.getByRole('main'));
    expect(within(setBar()).queryByRole('dialog', { name: strings.allFiltersLabel })).toBeNull();
  });
});

describe('the "Set" control at narrow widths (requirements §5.1, §5.10)', () => {
  it('groups add filter, the complete toggle, Share link and Save set', () => {
    stubNarrowViewport();
    renderApp(`/${encodeFilters({ species_code: ['KPN'] })}`, synth);
    const bar = within(setBar());
    // The count and the phrase stay in the bar; the actions do not.
    expect(bar.getByText(strings.setBarPhrase)).toBeTruthy();
    expect(bar.queryByRole('button', { name: strings.shareLink })).toBeNull();
    expect(bar.queryByRole('button', { name: strings.addFilter })).toBeNull();
    expect(bar.queryByRole('checkbox', { name: strings.completeOnly })).toBeNull();

    const set = bar.getByRole('button', { name: strings.setMenuToggle });
    expect(set.textContent).toBe(strings.setMenuToggle);
    fireEvent.click(set);
    const panel = bar.getByRole('dialog', { name: strings.setMenuLabel });
    const inside = within(panel);
    expect(inside.getByRole('button', { name: strings.addFilter })).toBeTruthy();
    expect(inside.getByRole('button', { name: strings.shareLink })).toBeTruthy();
    expect(inside.getByRole('button', { name: strings.saveSet })).toBeTruthy();
    fireEvent.click(inside.getByRole('checkbox', { name: strings.completeOnly }));
    expect(decodeFilters(window.location.search)).toEqual({
      species_code: ['KPN'],
      assembly_status: ['complete'],
    });
  });

  it('opens add filter over it; Escape closes the menu first, then "Set"', () => {
    stubNarrowViewport();
    renderApp('/', synth);
    const set = within(setBar()).getByRole('button', { name: strings.setMenuToggle });
    fireEvent.click(set);
    const panel = within(setBar()).getByRole('dialog', { name: strings.setMenuLabel });
    fireEvent.click(within(panel).getByRole('button', { name: strings.addFilter }));
    expect(screen.getByRole('dialog', { name: strings.addFilterMenuLabel })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: strings.addFilterMenuLabel })).toBeNull();
    expect(within(setBar()).getByRole('dialog', { name: strings.setMenuLabel })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(within(setBar()).queryByRole('dialog', { name: strings.setMenuLabel })).toBeNull();
    expect(document.activeElement).toBe(set);
  });

  it('closes on a pointer down outside', () => {
    stubNarrowViewport();
    renderApp('/', synth);
    fireEvent.click(within(setBar()).getByRole('button', { name: strings.setMenuToggle }));
    fireEvent.pointerDown(screen.getByRole('main'));
    expect(within(setBar()).queryByRole('dialog', { name: strings.setMenuLabel })).toBeNull();
  });

  it('puts the search field at the top of the navigation menu', () => {
    stubNarrowViewport();
    renderApp('/', synth);
    expect(within(setBar()).queryByRole('combobox')).toBeNull();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: strings.menuToggle }));
    });
    const menu = document.getElementById(
      screen.getByRole('button', { name: strings.menuToggle }).getAttribute('aria-controls') ?? '',
    );
    if (menu === null) throw new Error('the menu has no element');
    const field = within(menu).getByRole('combobox');
    const nav = within(menu).getByRole('navigation', {
      name: strings.navigationLabel,
    });
    // The field comes before the navigation.
    expect(field.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps the actions inline and the search in the bar on a wide viewport', () => {
    renderApp('/', synth);
    const bar = within(setBar());
    expect(bar.queryByRole('button', { name: strings.setMenuToggle })).toBeNull();
    expect(bar.getByRole('button', { name: strings.shareLink })).toBeTruthy();
    expect(bar.getByRole('combobox')).toBeTruthy();
  });
});
