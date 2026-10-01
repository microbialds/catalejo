// Navigation model of the shell (requirements §5.1) with the routes of §5.3,
// and the optional products a release may lack (§5.7). Pangenome links to its
// route prefix; the species is chosen on the page.
import type { Manifest } from './data/manifest';
import type { Route } from './router';
import { strings } from './strings';

/** Products a release declares in its manifest, each with a navigation item. */
export type Product = 'trees' | 'pangenome' | 'embeddings' | 'search';

export interface NavItem {
  id: string;
  label: string;
  href: string;
  /** The optional product the page shows; absent products disable the item. */
  product?: Product;
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
      { id: 'trees', label: strings.pagePhylogeny, href: '/trees', product: 'trees' },
      {
        id: 'pangenome',
        label: strings.pagePangenome,
        href: '/pangenome',
        product: 'pangenome',
      },
      {
        id: 'embeddings',
        label: strings.pageEmbeddings,
        href: '/embeddings',
        product: 'embeddings',
      },
      { id: 'search', label: strings.pageSequenceSearch, href: '/search', product: 'search' },
    ],
  },
];

export const methodsHref = '/methods';
export const releasesHref = '/releases';

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
  { id: 'releases', label: strings.pageReleases, href: releasesHref },
];

/** The page name for a location path, used by the placeholder main area. */
export function pageTitle(pathname: string): string | undefined {
  return (
    activeItem(pathname)?.label ?? otherPages.find((page) => matches(page.href, pathname))?.label
  );
}

/**
 * Whether the release includes a product (requirements §5.7, contract §6.4).
 * Sequence search is Tier 2 (§2) and the manifest declares no Tier 2 product
 * yet, so it is always absent.
 */
export function hasProduct(manifest: Manifest, product: Product): boolean {
  switch (product) {
    case 'trees':
      return manifest.species.some((species) => species.tree_ids.length > 0);
    case 'pangenome':
      return manifest.species.some((species) => species.has_pangenome);
    case 'embeddings':
      return manifest.embedding_models.length > 0;
    case 'search':
      return false;
  }
}

/** The product a route shows, if it is an optional one. */
export function productOfRoute(route: Route): Product | undefined {
  switch (route.page) {
    case 'trees':
    case 'pangenome':
    case 'embeddings':
    case 'search':
      return route.page;
    default:
      return undefined;
  }
}

/** Tooltip of a disabled navigation item (requirements §5.1). */
export function absentProductTooltip(product: Product, releaseId: string): string {
  switch (product) {
    case 'trees':
      return strings.navAbsentPhylogeny(releaseId);
    case 'pangenome':
      return strings.navAbsentPangenome(releaseId);
    case 'embeddings':
      return strings.navAbsentEmbeddings(releaseId);
    case 'search':
      return strings.navAbsentSequenceSearch(releaseId);
  }
}

/** Statement on the page of an absent product (requirements §5.7). */
export function absentProductStatement(product: Product, releaseId: string): string {
  switch (product) {
    case 'trees':
      return strings.absentPhylogeny(releaseId);
    case 'pangenome':
      return strings.absentPangenome(releaseId);
    case 'embeddings':
      return strings.absentEmbeddings(releaseId);
    case 'search':
      return strings.absentSequenceSearch(releaseId);
  }
}
