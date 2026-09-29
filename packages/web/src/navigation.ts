// Navigation model of the shell (requirements §5.1) with the routes of §5.3.
// Pangenome links to its route prefix; the species is chosen on the page.
import { strings } from './strings';

export interface NavItem {
  id: string;
  label: string;
  href: string;
}

export interface NavGroup {
  id: string;
  label: string;
  items: readonly NavItem[];
}

export const navigation: readonly NavGroup[] = [
  {
    id: 'explore',
    label: strings.navGroupExplore,
    items: [
      { id: 'collection', label: strings.pageCollection, href: '/' },
      { id: 'sets', label: strings.pageGenomeSets, href: '/sets' },
      { id: 'genomes', label: strings.pageGenomes, href: '/genomes' },
      { id: 'genes', label: strings.pageGenes, href: '/genes' },
    ],
  },
  {
    id: 'analyze',
    label: strings.navGroupAnalyze,
    items: [
      { id: 'trees', label: strings.pagePhylogeny, href: '/trees' },
      { id: 'pangenome', label: strings.pagePangenome, href: '/pangenome' },
      { id: 'embeddings', label: strings.pageEmbeddings, href: '/embeddings' },
      { id: 'search', label: strings.pageSequenceSearch, href: '/search' },
    ],
  },
];

export const methodsHref = '/methods';

function matches(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The navigation item for a location path, if any. */
export function activeItem(pathname: string): NavItem | undefined {
  for (const group of navigation) {
    const item = group.items.find((candidate) => matches(candidate.href, pathname));
    if (item) return item;
  }
  return undefined;
}

const otherPages: readonly NavItem[] = [
  { id: 'methods', label: strings.pageMethods, href: methodsHref },
  { id: 'releases', label: strings.pageReleases, href: '/releases' },
];

/** The page name for a location path, used by the placeholder main area. */
export function pageTitle(pathname: string): string | undefined {
  return (
    activeItem(pathname)?.label ?? otherPages.find((page) => matches(page.href, pathname))?.label
  );
}
