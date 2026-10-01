// @vitest-environment jsdom
// Requirements §5.3 and §5.9: route matching over the stable routes, query
// preservation on route changes, explicit queries for links that are filters,
// popstate handling, and Link click handling (plain left clicks only).
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { Link } from '../src/components/Link';
import {
  hrefFor,
  matchRoute,
  navigate,
  normalizeQuery,
  routePath,
  RouterProvider,
  useRouter,
} from '../src/router';
import type { Route } from '../src/router';

let scrollTo: MockInstance<typeof window.scrollTo>;

beforeEach(() => {
  scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const routes: [string, Route][] = [
  ['/', { page: 'collection' }],
  ['/sets', { page: 'sets' }],
  ['/genomes', { page: 'genomes' }],
  ['/genomes/KPN0001', { page: 'genome', genomeId: 'KPN0001', contigId: null }],
  [
    '/genomes/KPN0001/contigs/KPN0001_c2',
    { page: 'genome', genomeId: 'KPN0001', contigId: 'KPN0001_c2' },
  ],
  ['/genes', { page: 'genes' }],
  ['/genes/symbol/blaKPC-2', { page: 'gene', namespace: 'symbol', name: 'blaKPC-2' }],
  ['/genes/element/blaKPC', { page: 'gene', namespace: 'element', name: 'blaKPC' }],
  ['/genes/cluster/KPN_c00042', { page: 'gene', namespace: 'cluster', name: 'KPN_c00042' }],
  ['/trees', { page: 'trees', treeId: null }],
  ['/trees/KPN-core-2026-09', { page: 'trees', treeId: 'KPN-core-2026-09' }],
  ['/pangenome', { page: 'pangenome', speciesCode: null }],
  ['/pangenome/KPN', { page: 'pangenome', speciesCode: 'KPN' }],
  ['/embeddings', { page: 'embeddings' }],
  ['/search', { page: 'search' }],
  ['/methods', { page: 'methods' }],
  ['/releases', { page: 'releases' }],
];

describe('matchRoute', () => {
  it.each(routes)('matches %s', (pathname, route) => {
    expect(matchRoute(pathname)).toEqual(route);
  });

  it.each(routes)('builds %s back from its route', (pathname, route) => {
    expect(routePath(route)).toBe(pathname);
  });

  it.each([
    '/unknown',
    '/genome',
    '/genomes/KPN0001/contigs',
    '/genomes/KPN0001/plasmids/c1',
    '/genomes/KPN0001/contigs/c1/extra',
    '/genes/protein/abc',
    '/genes/symbol',
    '/genes/symbol/a/b',
    '/trees/a/b',
    '/pangenome/KPN/x',
    '/methods/x',
    '/releases/2026-09',
    '/sets/x',
    '//genomes',
    '/genomes//x',
    '/genomes/%E0%A4%A',
    'genomes',
  ])('treats %s as not found', (pathname) => {
    expect(matchRoute(pathname)).toEqual({ page: 'notFound' });
  });

  it('tolerates one trailing slash', () => {
    expect(matchRoute('/genomes/')).toEqual({ page: 'genomes' });
    expect(matchRoute('/genomes/KPN0001/')).toEqual({
      page: 'genome',
      genomeId: 'KPN0001',
      contigId: null,
    });
  });

  it('decodes and encodes segments', () => {
    const route: Route = { page: 'gene', namespace: 'element', name: "aac(6')-Ib/cr" };
    const pathname = routePath(route);
    expect(pathname).toBe("/genes/element/aac(6')-Ib%2Fcr");
    expect(matchRoute(pathname)).toEqual(route);
  });
});

describe('hrefFor', () => {
  it('keeps the current query', () => {
    expect(hrefFor('/genes', '?q=%7B%7D')).toBe('/genes?q=%7B%7D');
    expect(hrefFor('/genes', '')).toBe('/genes');
  });

  it('uses an explicit query instead of the current one', () => {
    expect(hrefFor('/', '?set=a', 'q=x')).toBe('/?q=x');
    expect(hrefFor('/', '?set=a', '?q=x')).toBe('/?q=x');
    expect(hrefFor('/', '?set=a', '')).toBe('/');
  });

  it('keeps a query written into the path', () => {
    expect(hrefFor('/?ids=A', '?set=a')).toBe('/?ids=A');
  });

  it('places a fragment after the query', () => {
    expect(hrefFor('/methods#exports', '?set=a')).toBe('/methods?set=a#exports');
    expect(hrefFor('/methods#exports', '?set=a', '')).toBe('/methods#exports');
    expect(hrefFor('/?ids=A#top', '?set=a')).toBe('/?ids=A#top');
  });

  it('normalizes queries', () => {
    expect(normalizeQuery('')).toBe('');
    expect(normalizeQuery('?')).toBe('');
    expect(normalizeQuery('a=1')).toBe('?a=1');
    expect(normalizeQuery('?a=1')).toBe('?a=1');
  });
});

function Probe() {
  const { pathname, search, route } = useRouter();
  return <output data-testid="probe">{`${pathname}|${search}|${route.page}`}</output>;
}

function probe(): string {
  return screen.getByTestId('probe').textContent;
}

describe('navigate and RouterProvider', () => {
  it('preserves the query on a route change', () => {
    window.history.replaceState(null, '', '/?q=%7B%22species%22%3A%5B%22KPN%22%5D%7D');
    render(
      <RouterProvider>
        <Probe />
      </RouterProvider>,
    );
    expect(probe()).toBe('/|?q=%7B%22species%22%3A%5B%22KPN%22%5D%7D|collection');
    act(() => {
      navigate('/genomes/KPN0001');
    });
    expect(window.location.pathname).toBe('/genomes/KPN0001');
    expect(window.location.search).toBe('?q=%7B%22species%22%3A%5B%22KPN%22%5D%7D');
    expect(probe()).toBe('/genomes/KPN0001|?q=%7B%22species%22%3A%5B%22KPN%22%5D%7D|genome');
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it('replaces the query when asked, pushing or replacing the entry', () => {
    window.history.replaceState(null, '', '/genomes?set=a');
    render(
      <RouterProvider>
        <Probe />
      </RouterProvider>,
    );
    const length = window.history.length;
    act(() => {
      navigate('/', { replaceQuery: 'set=b' });
    });
    expect(probe()).toBe('/|?set=b|collection');
    expect(window.history.length).toBe(length + 1);
    act(() => {
      navigate('/', { replaceQuery: '', replace: true });
    });
    expect(probe()).toBe('/||collection');
    expect(window.history.length).toBe(length + 1);
  });

  it('does not scroll on a query change within the page', () => {
    render(
      <RouterProvider>
        <Probe />
      </RouterProvider>,
    );
    act(() => {
      navigate('/', { replaceQuery: 'set=b' });
    });
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('follows popstate', () => {
    render(
      <RouterProvider>
        <Probe />
      </RouterProvider>,
    );
    act(() => {
      window.history.pushState(null, '', '/trees/T1?set=x');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(probe()).toBe('/trees/T1|?set=x|trees');
  });

  it('requires the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow(/RouterProvider/);
  });
});

/**
 * Records whether each click reached the document already prevented, after
 * React's handlers ran, then prevents it so that jsdom does not follow it.
 */
function afterReact(): () => boolean[] {
  const seen: boolean[] = [];
  const listener = (event: Event) => {
    seen.push(event.defaultPrevented);
    event.preventDefault();
  };
  document.addEventListener('click', listener);
  return () => {
    document.removeEventListener('click', listener);
    return seen;
  };
}

describe('Link', () => {
  function renderLinks(start: string) {
    window.history.replaceState(null, '', start);
    render(
      <RouterProvider>
        <Link to="/genes">genes</Link>
        <Link to="/" query="q=filter">
          filter
        </Link>
        <Link to="/sets" target="_blank">
          blank
        </Link>
        <Probe />
      </RouterProvider>,
    );
  }

  it('renders the resolved href, keeping or replacing the query', () => {
    renderLinks('/genomes?set=a');
    expect(screen.getByText('genes').getAttribute('href')).toBe('/genes?set=a');
    expect(screen.getByText('filter').getAttribute('href')).toBe('/?q=filter');
  });

  it('navigates in place on a plain left click', () => {
    renderLinks('/genomes?set=a');
    const link = screen.getByText('genes');
    const notPrevented = fireEvent.click(link, { button: 0 });
    expect(notPrevented).toBe(false);
    expect(probe()).toBe('/genes|?set=a|genes');
  });

  it('keeps the fragment when navigating', () => {
    window.history.replaceState(null, '', '/genomes?set=a');
    render(
      <RouterProvider>
        <Link to="/methods#exports">methods</Link>
        <Probe />
      </RouterProvider>,
    );
    fireEvent.click(screen.getByText('methods'));
    expect(probe()).toBe('/methods|?set=a|methods');
    expect(window.location.hash).toBe('#exports');
  });

  it('navigates with the explicit query of a filter link', () => {
    renderLinks('/genomes?set=a');
    fireEvent.click(screen.getByText('filter'));
    expect(probe()).toBe('/|?q=filter|collection');
  });

  it.each([
    ['meta', { metaKey: true }],
    ['ctrl', { ctrlKey: true }],
    ['shift', { shiftKey: true }],
    ['alt', { altKey: true }],
    ['middle button', { button: 1 }],
  ])('leaves a %s click to the browser', (_name, init) => {
    renderLinks('/genomes?set=a');
    const seen = afterReact();
    fireEvent.click(screen.getByText('genes'), init);
    expect(seen()).toEqual([false]);
    expect(probe()).toBe('/genomes|?set=a|genomes');
  });

  it('leaves a click on a link with a target to the browser', () => {
    renderLinks('/genomes');
    const seen = afterReact();
    fireEvent.click(screen.getByText('blank'));
    expect(seen()).toEqual([false]);
    expect(probe()).toBe('/genomes||genomes');
  });

  it('respects a handler that prevents the default', () => {
    window.history.replaceState(null, '', '/genomes');
    render(
      <RouterProvider>
        <Link
          to="/genes"
          onClick={(event) => {
            event.preventDefault();
          }}
        >
          genes
        </Link>
        <Probe />
      </RouterProvider>,
    );
    fireEvent.click(screen.getByText('genes'));
    expect(probe()).toBe('/genomes||genomes');
  });
});
