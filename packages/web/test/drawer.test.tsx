// @vitest-environment jsdom
// The facet drawer (requirements §5.10, §9 keyboard reachable controls):
// opened from the set bar's "Filters" toggle, it closes on Escape wherever
// the focus is, returning the focus to "Filters", and on a pointer down
// outside both the drawer and "Filters"; a pointer down inside the drawer or
// on "Filters" keeps it open, and the toggle still closes it.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Drawer } from '../src/components/Drawer';
import { Shell } from '../src/components/Shell';
import { ManifestContext } from '../src/data/manifest';
import { RouterProvider } from '../src/router';
import { strings } from '../src/strings';
import { manifestFixture, ready } from './support/manifest';

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// The page content uses existing strings as stand-in labels.
function renderWithDrawer() {
  window.history.replaceState(null, '', '/');
  return render(
    <RouterProvider>
      <ManifestContext value={ready(manifestFixture())}>
        <Shell>
          <div className="flex">
            <Drawer label={strings.facetsLabel}>
              <input type="checkbox" aria-label={strings.facetSpecies} />
            </Drawer>
            <button type="button">{strings.panelGenomes}</button>
          </div>
        </Shell>
      </ManifestContext>
    </RouterProvider>,
  );
}

const toggle = () =>
  within(screen.getByRole('banner', { name: strings.setBarLabel })).getByRole('button', {
    name: strings.drawerToggle,
  });
const drawer = () => screen.getByRole('complementary', { name: strings.facetsLabel });
const isOpen = () => toggle().getAttribute('aria-expanded') === 'true';

function open() {
  fireEvent.click(toggle());
  expect(isOpen()).toBe(true);
  expect(drawer().className.split(/\s+/)).not.toContain('max-drawer:hidden');
}

describe('facet drawer', () => {
  it('closes on Escape from inside the drawer and returns the focus to Filters', () => {
    renderWithDrawer();
    open();
    const inside = within(drawer()).getByRole('checkbox', { name: strings.facetSpecies });
    inside.focus();
    fireEvent.keyDown(inside, { key: 'Escape' });
    expect(isOpen()).toBe(false);
    expect(drawer().className.split(/\s+/)).toContain('max-drawer:hidden');
    expect(document.activeElement).toBe(toggle());
  });

  it('closes on Escape from anywhere on the page', () => {
    renderWithDrawer();
    open();
    const elsewhere = screen.getByRole('button', { name: strings.panelGenomes });
    elsewhere.focus();
    fireEvent.keyDown(elsewhere, { key: 'Escape' });
    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe(toggle());
    open();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(isOpen()).toBe(false);
  });

  it('closes on a pointer down outside the drawer and Filters, leaving the focus', () => {
    renderWithDrawer();
    open();
    const outside = screen.getByRole('button', { name: strings.panelGenomes });
    outside.focus();
    fireEvent.pointerDown(outside);
    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe(outside);
  });

  it('stays open on a pointer down inside the drawer or on Filters, which toggles it', () => {
    renderWithDrawer();
    open();
    fireEvent.pointerDown(within(drawer()).getByRole('checkbox', { name: strings.facetSpecies }));
    expect(isOpen()).toBe(true);
    fireEvent.pointerDown(toggle());
    expect(isOpen()).toBe(true);
    fireEvent.click(toggle());
    expect(isOpen()).toBe(false);
  });

  it('listens only while open', () => {
    renderWithDrawer();
    const elsewhere = screen.getByRole('button', { name: strings.panelGenomes });
    elsewhere.focus();
    fireEvent.keyDown(elsewhere, { key: 'Escape' });
    expect(document.activeElement).toBe(elsewhere);
    expect(isOpen()).toBe(false);
  });
});
