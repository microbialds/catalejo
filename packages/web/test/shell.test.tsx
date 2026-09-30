// @vitest-environment jsdom
// Requirements §5.1: the shell renders the wordmark, the two navigation groups
// in order, and marks the active page with the accent left rule.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MainPlaceholder } from '../src/components/MainPlaceholder';
import { Shell } from '../src/components/Shell';
import { strings } from '../src/strings';
import { sourceFiles } from './files';

afterEach(cleanup);

function renderAt(pathname: string) {
  return render(
    <Shell pathname={pathname}>
      <MainPlaceholder pathname={pathname} />
    </Shell>,
  );
}

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

describe('Shell', () => {
  it('renders the wordmark, tagline, set bar phrase and footer', () => {
    renderAt('/');
    expect(screen.getByText(strings.wordmark)).toBeTruthy();
    expect(screen.getByText(strings.tagline)).toBeTruthy();
    expect(screen.getByText(strings.setBarPhrase)).toBeTruthy();
    const methods = screen.getByRole('link', { name: strings.footerMethods });
    expect(methods.getAttribute('href')).toBe('/methods');
    expect(screen.getByRole('main')).toBeTruthy();
  });

  it('sets the wordmark line height from the tight token', () => {
    renderAt('/');
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
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: strings.navigationLabel });
    const groups = within(nav).getAllByRole('group');
    expect(groups.map((group) => group.getAttribute('aria-labelledby'))).toHaveLength(2);
    const [first, second] = groups;
    if (!first || !second) throw new Error('missing navigation groups');
    expect(within(nav).getByRole('group', { name: strings.navGroupExplore })).toBe(first);
    expect(within(nav).getByRole('group', { name: strings.navGroupAnalyze })).toBe(second);
    const links = (group: HTMLElement) =>
      within(group)
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]);
    expect(links(first)).toEqual(explore);
    expect(links(second)).toEqual(analyze);
  });

  it.each([
    ['/', strings.pageCollection],
    ['/sets', strings.pageGenomeSets],
    ['/genomes/KPN0001', strings.pageGenomes],
    ['/genes/symbol/blaKPC', strings.pageGenes],
    ['/trees/KPN-core', strings.pagePhylogeny],
    ['/pangenome/KPN', strings.pagePangenome],
    ['/embeddings', strings.pageEmbeddings],
    ['/search', strings.pageSequenceSearch],
  ])('marks the active page at %s with the accent rule', (pathname, label) => {
    renderAt(pathname);
    const nav = screen.getByRole('navigation', { name: strings.navigationLabel });
    const current = within(nav)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page');
    expect(current.map((link) => link.textContent)).toEqual([label]);
    const classes = current[0]?.className.split(/\s+/) ?? [];
    expect(classes).toContain('border-accent');
    expect(classes).toContain('border-l-(length:--shape-active-rule)');
    expect(classes).toContain('font-semibold');
    expect(classes).toContain('bg-background');
  });

  it('marks no navigation item on the Methods page', () => {
    renderAt('/methods');
    const nav = screen.getByRole('navigation', { name: strings.navigationLabel });
    const current = within(nav)
      .getAllByRole('link')
      .filter((link) => link.hasAttribute('aria-current'));
    expect(current).toEqual([]);
    expect(screen.getByRole('heading', { name: strings.pageMethods })).toBeTruthy();
  });
});
