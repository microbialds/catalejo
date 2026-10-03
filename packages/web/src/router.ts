// In-house router over the History API for the routes of requirements §5.3.
// Paths map to a Route value; anything else is "not found" (§6.11). The query
// string carries the genome set (§5.3) and is preserved on route changes
// unless a caller replaces it (§5.9: links that are themselves filters).
//
// Use `useRouter()` for the current location and route, `navigate()` to move,
// and the `Link` component (components/Link.tsx) for anchors.
import { createContext, createElement, useContext, useMemo, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';

export type GeneNamespace = 'symbol' | 'element' | 'cluster';

export const geneNamespaces: readonly GeneNamespace[] = ['symbol', 'element', 'cluster'];

export type Route =
  | { page: 'collection' }
  | { page: 'sets' }
  | { page: 'genomes' }
  | { page: 'genome'; genomeId: string; contigId: string | null }
  | { page: 'genes' }
  | { page: 'gene'; namespace: GeneNamespace; name: string }
  | { page: 'trees'; treeId: string | null }
  | { page: 'pangenome'; speciesCode: string | null }
  | { page: 'embeddings' }
  | { page: 'search' }
  | { page: 'methods' }
  | { page: 'releases' }
  | { page: 'notFound' };

export type Page = Route['page'];

const NOT_FOUND: Route = { page: 'notFound' };

const fixed: Readonly<Record<string, Route>> = {
  sets: { page: 'sets' },
  genomes: { page: 'genomes' },
  genes: { page: 'genes' },
  trees: { page: 'trees', treeId: null },
  pangenome: { page: 'pangenome', speciesCode: null },
  embeddings: { page: 'embeddings' },
  search: { page: 'search' },
  methods: { page: 'methods' },
  releases: { page: 'releases' },
};

function isGeneNamespace(value: string): value is GeneNamespace {
  return (geneNamespaces as readonly string[]).includes(value);
}

/** Decoded path segments, or undefined for an empty or undecodable segment. */
function segmentsOf(pathname: string): string[] | undefined {
  if (!pathname.startsWith('/')) return undefined;
  // One trailing slash is tolerated: /genomes/ is /genomes.
  const trimmed = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  if (trimmed === '/') return [];
  const raw = trimmed.slice(1).split('/');
  const decoded: string[] = [];
  for (const segment of raw) {
    if (segment === '') return undefined;
    try {
      decoded.push(decodeURIComponent(segment));
    } catch {
      return undefined;
    }
  }
  return decoded;
}

/** The route for a location path (requirements §5.3). */
export function matchRoute(pathname: string): Route {
  const segments = segmentsOf(pathname);
  if (segments === undefined) return NOT_FOUND;
  const [head, second, third, fourth, ...rest] = segments;
  if (head === undefined) return { page: 'collection' };
  if (rest.length > 0) return NOT_FOUND;
  if (second === undefined) return fixed[head] ?? NOT_FOUND;

  switch (head) {
    case 'genomes':
      if (third === undefined) return { page: 'genome', genomeId: second, contigId: null };
      if (third === 'contigs' && fourth !== undefined) {
        return { page: 'genome', genomeId: second, contigId: fourth };
      }
      return NOT_FOUND;
    case 'genes':
      if (third !== undefined && fourth === undefined && isGeneNamespace(second)) {
        return { page: 'gene', namespace: second, name: third };
      }
      return NOT_FOUND;
    case 'trees':
      return third === undefined ? { page: 'trees', treeId: second } : NOT_FOUND;
    case 'pangenome':
      return third === undefined ? { page: 'pangenome', speciesCode: second } : NOT_FOUND;
    default:
      return NOT_FOUND;
  }
}

const encode = encodeURIComponent;

/** The path of a route; the inverse of matchRoute. Not found maps to "/". */
export function routePath(route: Route): string {
  switch (route.page) {
    case 'collection':
    case 'notFound':
      return '/';
    case 'genome':
      return route.contigId === null
        ? `/genomes/${encode(route.genomeId)}`
        : `/genomes/${encode(route.genomeId)}/contigs/${encode(route.contigId)}`;
    case 'gene':
      return `/genes/${route.namespace}/${encode(route.name)}`;
    case 'trees':
      return route.treeId === null ? '/trees' : `/trees/${encode(route.treeId)}`;
    case 'pangenome':
      return route.speciesCode === null ? '/pangenome' : `/pangenome/${encode(route.speciesCode)}`;
    default:
      return `/${route.page}`;
  }
}

/** A query string with its leading "?", or "" when empty. */
export function normalizeQuery(query: string): string {
  const bare = query.startsWith('?') ? query.slice(1) : query;
  return bare === '' ? '' : `?${bare}`;
}

/**
 * The href for a target path. A path that carries its own query keeps it;
 * otherwise `replaceQuery` wins when given, else the current query is kept
 * (requirements §5.3, route changes preserve the query).
 */
export function hrefFor(path: string, currentSearch: string, replaceQuery?: string): string {
  // A fragment ("/methods#exports") follows the query.
  const hashMark = path.indexOf('#');
  const hash = hashMark >= 0 ? path.slice(hashMark) : '';
  const bare = hashMark >= 0 ? path.slice(0, hashMark) : path;
  const mark = bare.indexOf('?');
  if (mark >= 0) return `${bare.slice(0, mark)}${normalizeQuery(bare.slice(mark))}${hash}`;
  return `${bare}${normalizeQuery(replaceQuery ?? currentSearch)}${hash}`;
}

export interface NavigateOptions {
  /** Query to use instead of the current one, with or without "?"; "" clears it. */
  replaceQuery?: string;
  /** Replace the current history entry instead of pushing one. */
  replace?: boolean;
}

const NAVIGATE_EVENT = 'catalejo:navigate';

/** Moves to a path through the History API and notifies the router. */
export function navigate(path: string, options: NavigateOptions = {}): void {
  const { pathname, search, hash } = window.location;
  const href = hrefFor(path, search, options.replaceQuery);
  if (href === `${pathname}${search}${hash}`) return;
  if (options.replace === true) window.history.replaceState(null, '', href);
  else window.history.pushState(null, '', href);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
  // A new page starts at the top; a query change on the same page keeps its place.
  if (href.split(/[?#]/, 1)[0] !== pathname) window.scrollTo(0, 0);
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  window.addEventListener(NAVIGATE_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(NAVIGATE_EVENT, onChange);
  };
}

function snapshot(): string {
  return `${window.location.pathname}${window.location.search}`;
}

export interface RouterState {
  pathname: string;
  /** The query string with its leading "?", or "". */
  search: string;
  route: Route;
  navigate: typeof navigate;
}

const RouterContext = createContext<RouterState | null>(null);

/** Provides the current location and route to the application. */
export function RouterProvider({ children }: { children: ReactNode }) {
  const href = useSyncExternalStore(subscribe, snapshot, snapshot);
  const value = useMemo<RouterState>(() => {
    const mark = href.indexOf('?');
    const pathname = mark >= 0 ? href.slice(0, mark) : href;
    const search = mark >= 0 ? href.slice(mark) : '';
    return { pathname, search, route: matchRoute(pathname), navigate };
  }, [href]);
  return createElement(RouterContext, { value }, children);
}

/** The current location, route and the navigate function. */
export function useRouter(): RouterState {
  const state = useContext(RouterContext);
  if (state === null) throw new Error('useRouter outside RouterProvider');
  return state;
}
