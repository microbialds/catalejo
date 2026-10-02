// @vitest-environment jsdom
// Requirements §5.1, §5.7, §5.10 and data contract §2, §6.4: the shell renders
// the wordmark, the two navigation groups in order, marks the active page with
// the accent left rule, shows the release footer from the manifest, disables
// navigation for absent products, renders absence statements, collapses into
// a menu, hosts a page drawer, and stops on a schema mismatch.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Drawer } from '../src/components/Drawer';
import { Shell } from '../src/components/Shell';
import { ManifestContext } from '../src/data/manifest';
import type { ManifestState } from '../src/data/manifest';
import { RouterProvider } from '../src/router';
import { strings } from '../src/strings';
import { sourceFiles } from './files';
import { manifestFixture, manifestWithProducts, ready } from './support/manifest';
import { renderApp } from './support/render';

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const synth = ready(manifestFixture());
const full = ready(manifestWithProducts());

const explore = [
  [strings.pageCollection, '/'],
  [strings.pageGenomeSets, '/sets'],
  [strings.pageGenomes, '/genomes'],
  [strings.pageGenes, '/genes'],
];
const analyze = [
  [strings.pagePhylogeny, '/trees'],
  [strings.pagePangenome, '/pangenome'],
  [strings.pageEmbeddings, '/embeddings'],
  [strings.pageSequenceSearch, '/search'],
];

function nav() {
  return screen.getByRole('navigation', { name: strings.navigationLabel });
}

function footer() {
  return screen.getByRole('contentinfo');
}

describe('Shell', () => {
  it('renders the wordmark, tagline, set bar phrase and footer', () => {
    renderApp('/', synth);
    expect(screen.getByText(strings.wordmark)).toBeTruthy();
    expect(screen.getByText(strings.tagline)).toBeTruthy();
    expect(screen.getByText(strings.setBarPhrase)).toBeTruthy();
    const methods = within(footer()).getByRole('link', { name: strings.footerMethods });
    expect(methods.getAttribute('href')).toBe('/methods');
    expect(screen.getByRole('main')).toBeTruthy();
  });

  it('sets the wordmark line height from the tight token', () => {
    renderApp('/', synth);
    const classes = screen.getByText(strings.wordmark).className.split(/\s+/);
    expect(classes).toContain('leading-tight');
  });

  it('uses no arbitrary line height in the components', () => {
    const arbitrary = sourceFiles(['.tsx'])
      .filter((file) => file.includes(`${path.sep}components${path.sep}`))
      .filter((file) => readFileSync(file, 'utf8').includes('leading-['));
    expect(arbitrary).toEqual([]);
  });

  it('renders Explore then Analyze with their pages in order', () => {
    renderApp('/', full);
    const groups = within(nav()).getAllByRole('group');
    expect(groups.map((group) => group.getAttribute('aria-labelledby'))).toHaveLength(2);
    const [first, second] = groups;
    if (!first || !second) throw new Error('missing navigation groups');
    expect(within(nav()).getByRole('group', { name: strings.navGroupExplore })).toBe(first);
    expect(within(nav()).getByRole('group', { name: strings.navGroupAnalyze })).toBe(second);
    const links = (group: HTMLElement) =>
      within(group)
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]);
    expect(links(first)).toEqual(explore);
    expect(links(second)).toEqual(analyze.filter(([, href]) => href !== '/search'));
  });

  it.each([
    ['/', strings.pageCollection],
    ['/sets', strings.pageGenomeSets],
    ['/genomes/KPN0001', strings.pageGenomes],
    ['/genes/symbol/blaKPC', strings.pageGenes],
    ['/trees/KPN-core', strings.pagePhylogeny],
    ['/pangenome/KPN', strings.pagePangenome],
    ['/embeddings', strings.pageEmbeddings],
  ])('marks the active page at %s with the accent rule', (pathname, label) => {
    renderApp(pathname, full);
    const current = within(nav())
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page');
    expect(current.map((link) => link.textContent)).toEqual([label]);
    const classes = current[0]?.className.split(/\s+/) ?? [];
    expect(classes).toContain('border-accent');
    expect(classes).toContain('border-l-(length:--shape-active-rule)');
    expect(classes).toContain('font-bold');
    expect(classes).toContain('bg-background');
  });

  it('marks a disabled item as the current page on its own route', () => {
    renderApp('/search', synth);
    const current = nav().querySelectorAll('[aria-current="page"]');
    expect([...current].map((item) => item.textContent)).toEqual([strings.pageSequenceSearch]);
    expect(current[0]?.tagName).toBe('SPAN');
    expect(current[0]?.className.split(/\s+/)).toContain('border-accent');
  });

  it('marks no navigation item on the Methods page', () => {
    renderApp('/methods', synth);
    expect(nav().querySelectorAll('[aria-current]')).toHaveLength(0);
    expect(screen.getByRole('heading', { name: strings.pageMethods })).toBeTruthy();
  });

  it('keeps the current query on navigation links', () => {
    renderApp('/genomes?q=%7B%7D&set=index-isolate', synth);
    const hrefs = within(nav())
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));
    expect(hrefs).toEqual(explore.map(([, href]) => `${String(href)}?q=%7B%7D&set=index-isolate`));
    expect(within(footer()).getByRole('link', { name: 'synth' }).getAttribute('href')).toBe(
      '/releases?q=%7B%7D&set=index-isolate',
    );
  });

  it('follows a navigation link in place and keeps the query', () => {
    renderApp('/?set=index-isolate', synth);
    fireEvent.click(within(nav()).getByRole('link', { name: strings.pageGenes }));
    expect(window.location.pathname).toBe('/genes');
    expect(window.location.search).toBe('?set=index-isolate');
    const current = nav().querySelector('[aria-current="page"]');
    expect(current?.textContent).toBe(strings.pageGenes);
    expect(screen.getByRole('heading', { name: strings.pageGenes })).toBeTruthy();
  });
});

describe('release footer', () => {
  it('shows the release, genome count and pipeline of the synthetic release', () => {
    renderApp('/', synth);
    const release = within(footer()).getByRole('link', { name: 'synth' });
    expect(release.getAttribute('href')).toBe('/releases');
    expect(release.className.split(/\s+/)).toContain('font-mono');
    expect(release.parentElement?.textContent).toBe(`${strings.footerRelease} synth`);
    expect(footer().textContent).toContain(`100 genomes${strings.separator}gene2dis/mgap 2.0.0`);
  });

  it('groups thousands and joins several pipeline versions', () => {
    renderApp(
      '/',
      ready(
        manifestWithProducts({ pipeline: { name: 'gene2dis/mgap', versions: ['2.0.0', '2.1.0'] } }),
      ),
    );
    expect(footer().textContent).toContain(
      `4,812 genomes${strings.separator}gene2dis/mgap 2.0.0${strings.listSeparator}2.1.0`,
    );
  });

  it('shows the pipeline name alone when no version was recorded', () => {
    renderApp('/', ready(manifestFixture({ pipeline: { name: 'gene2dis/mgap', versions: [] } })));
    expect(footer().textContent).toContain(`100 genomes${strings.separator}gene2dis/mgap`);
    expect(footer().textContent).not.toContain('gene2dis/mgap ');
  });

  it('uses the singular for one genome', () => {
    renderApp('/', ready(manifestFixture({ genome_count: 1 })));
    expect(footer().textContent).toContain(`1 genome${strings.separator}`);
  });

  it('shows pending values while the manifest loads', () => {
    renderApp('/', { status: 'loading' });
    const pending = strings.valuePending;
    expect(footer().textContent).toContain(`${strings.footerRelease} ${pending}`);
    expect(within(footer()).queryByRole('link', { name: pending })).toBeNull();
    const setBar = screen.getByRole('banner', { name: strings.setBarLabel });
    expect(setBar.textContent).toContain(pending);
    // Availability is unknown, so every item is a link.
    expect(within(nav()).getAllByRole('link')).toHaveLength(8);
  });
});

describe('set bar', () => {
  it('shows the release genome count as the set count', () => {
    renderApp('/', ready(manifestWithProducts()));
    const setBar = screen.getByRole('banner', { name: strings.setBarLabel });
    expect(within(setBar).getByText('4,812')).toBeTruthy();
    expect(within(setBar).getByText(strings.setBarPhrase)).toBeTruthy();
  });
});

describe('absent products (requirements §5.7)', () => {
  const absent = [
    [strings.pagePhylogeny, strings.navAbsentPhylogeny('synth')],
    [strings.pagePangenome, strings.navAbsentPangenome('synth')],
    [strings.pageEmbeddings, strings.navAbsentEmbeddings('synth')],
    [strings.pageSequenceSearch, strings.navAbsentSequenceSearch('synth')],
  ] as const;

  it('disables every Analyze item the synthetic release lacks', () => {
    renderApp('/', synth);
    const group = within(nav()).getByRole('group', { name: strings.navGroupAnalyze });
    expect(within(group).queryAllByRole('link')).toEqual([]);
    for (const [label, tip] of absent) {
      const item = within(group).getByText(label);
      expect(item.tagName).toBe('SPAN');
      expect(item.hasAttribute('href')).toBe(false);
      expect(item.getAttribute('aria-disabled')).toBe('true');
      expect(item.tabIndex).toBe(0);
      expect(item.getAttribute('title')).toBe(tip);
      const tooltip = document.getElementById(item.getAttribute('aria-describedby') ?? '');
      expect(tooltip?.getAttribute('role')).toBe('tooltip');
      expect(tooltip?.textContent).toBe(tip);
      expect(tooltip?.className.split(/\s+/)).toEqual(
        expect.arrayContaining(['invisible', 'peer-hover:visible', 'peer-focus:visible']),
      );
    }
  });

  it('states the release identifier in the tooltip', () => {
    expect(strings.navAbsentPhylogeny('synth')).toBe('Release synth does not include phylogenies.');
  });

  it.each([
    ['/trees', strings.absentPhylogeny('synth')],
    ['/trees/KPN-core', strings.absentPhylogeny('synth')],
    ['/pangenome', strings.absentPangenome('synth')],
    ['/pangenome/KPN', strings.absentPangenome('synth')],
    ['/embeddings', strings.absentEmbeddings('synth')],
    ['/search', strings.absentSequenceSearch('synth')],
  ])('renders the absence statement at %s', (pathname, statement) => {
    renderApp(pathname, synth);
    const main = screen.getByRole('main');
    expect(within(main).getByText(statement)).toBeTruthy();
    const methods = within(main).getByRole('link', { name: strings.absentMethodsLink });
    expect(methods.getAttribute('href')).toBe('/methods');
    expect(within(main).queryByText(strings.placeholderStatement)).toBeNull();
  });

  it('keeps the pages of declared products', () => {
    renderApp('/trees', full);
    expect(within(screen.getByRole('main')).getByText(strings.placeholderStatement)).toBeTruthy();
  });

  it('enables the items of declared products and keeps search disabled', () => {
    renderApp('/', full);
    const group = within(nav()).getByRole('group', { name: strings.navGroupAnalyze });
    expect(within(group).getAllByRole('link')).toHaveLength(3);
    expect(within(group).getByText(strings.pageSequenceSearch).getAttribute('aria-disabled')).toBe(
      'true',
    );
    expect(within(group).getByText(strings.pageSequenceSearch).getAttribute('title')).toBe(
      strings.navAbsentSequenceSearch('2026-09'),
    );
  });
});

describe('not found and the manifest gate', () => {
  it.each(['/nothing', '/genes/protein/abc', '/genomes/KPN0001/plasmids/c1'])(
    'renders the not-found statement at %s',
    (pathname) => {
      renderApp(pathname, synth);
      expect(screen.getByRole('heading', { name: strings.notFoundTitle })).toBeTruthy();
      expect(screen.getByText(strings.notFoundStatement)).toBeTruthy();
      expect(nav().querySelectorAll('[aria-current]')).toHaveLength(0);
    },
  );

  it('shows only the mismatch when the schema is outside the range', () => {
    renderApp('/', { status: 'mismatch', schemaVersion: '0.2.0', range: '>=0.1.0 <0.2.0' });
    expect(screen.getByRole('alert').textContent).toBe(
      strings.schemaMismatch('0.2.0', '>=0.1.0 <0.2.0'),
    );
    expect(screen.getByRole('alert').textContent).toContain('0.2.0');
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('banner')).toBeNull();
    expect(screen.queryByRole('contentinfo')).toBeNull();
  });

  it('shows a plain statement when the manifest is unavailable', () => {
    renderApp('/', { status: 'unavailable' });
    expect(screen.getByRole('alert').textContent).toBe(strings.manifestUnavailable);
    expect(screen.queryByRole('navigation')).toBeNull();
  });
});

describe('narrow viewports (requirements §5.10)', () => {
  it('collapses the navigation behind a Menu text button', () => {
    renderApp('/', synth);
    const button = screen.getByRole('button', { name: strings.menuToggle });
    expect(button.className.split(/\s+/)).toContain('compact:hidden');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    const menu = document.getElementById(button.getAttribute('aria-controls') ?? '');
    expect(menu?.contains(nav())).toBe(true);
    expect(menu?.contains(footer())).toBe(true);
    expect(menu?.className.split(/\s+/)).toContain('max-compact:hidden');

    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(menu?.className.split(/\s+/)).not.toContain('max-compact:hidden');

    // Following a link closes the menu.
    fireEvent.click(within(nav()).getByRole('link', { name: strings.pageGenomes }));
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(menu?.className.split(/\s+/)).toContain('max-compact:hidden');
  });

  it('closes the Menu on Escape, returning the focus to it (§9)', () => {
    renderApp('/', synth);
    const button = screen.getByRole('button', { name: strings.menuToggle });
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const link = within(nav()).getByRole('link', { name: strings.pageGenomes });
    link.focus();
    fireEvent.keyDown(link, { key: 'Escape' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);
  });

  it('closes the Menu on a pointer down outside it, without activating what lies there', () => {
    renderApp('/', synth);
    const button = screen.getByRole('button', { name: strings.menuToggle });
    fireEvent.click(button);
    // A press inside the menu keeps it open.
    fireEvent.pointerDown(within(nav()).getByRole('link', { name: strings.pageGenomes }));
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const main = screen.getByRole('main');
    const onClick = vi.fn();
    main.addEventListener('click', onClick);
    fireEvent.pointerDown(main);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(main);
    expect(onClick).not.toHaveBeenCalled();
    fireEvent.pointerDown(main);
    fireEvent.click(main);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  function renderWithDrawer(state: ManifestState) {
    window.history.replaceState(null, '', '/');
    return render(
      <RouterProvider>
        <ManifestContext value={state}>
          <Shell>
            <div className="flex">
              <Drawer label={strings.drawerToggle}>
                <span>{strings.pageGenomes}</span>
              </Drawer>
            </div>
          </Shell>
        </ManifestContext>
      </RouterProvider>,
    );
  }

  it('offers no drawer toggle when the page registers no drawer', () => {
    // The collection page at / registers its facet rail; /genes has none yet.
    renderApp('/genes', synth);
    expect(screen.queryByRole('button', { name: strings.drawerToggle })).toBeNull();
  });

  it('opens a registered drawer from the set bar below the drawer breakpoint', () => {
    renderWithDrawer(synth);
    const setBar = screen.getByRole('banner', { name: strings.setBarLabel });
    const toggle = within(setBar).getByRole('button', { name: strings.drawerToggle });
    expect(toggle.className.split(/\s+/)).toContain('drawer:hidden');
    const drawer = screen.getByRole('complementary', { name: strings.drawerToggle });
    expect(toggle.getAttribute('aria-controls')).toBe(drawer.id);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(drawer.className.split(/\s+/)).toContain('max-drawer:hidden');

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(drawer.className.split(/\s+/)).toEqual(
      expect.arrayContaining(['max-drawer:absolute', 'max-drawer:z-10']),
    );

    fireEvent.keyDown(drawer, { key: 'Escape' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(drawer.className.split(/\s+/)).toContain('max-drawer:hidden');
  });

  it('closes the drawer on a route change', () => {
    renderWithDrawer(synth);
    const toggle = screen.getByRole('button', { name: strings.drawerToggle });
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    act(() => {
      window.history.pushState(null, '', '/genomes');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });
});
