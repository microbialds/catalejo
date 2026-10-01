// Application shell (requirements §5.1, §5.10, §7; collection board). A 200 px
// left column on the sidebar color with a hairline right border holds the
// wordmark and tagline, the navigation and the release footer (release
// identifier linked to Releases, genome count, pipeline name and versions
// from the manifest, contract §6.4, and the Methods link); the main column
// holds the 56 px set bar and the page.
//
// Viewport (§5.10): from 900 px the left column stays in view while the page
// scrolls. Below 900 px (breakpoint_compact) the grid stacks and the column
// becomes a top bar with the wordmark and a "Menu" text button that opens the
// navigation and footer; the menu closes when the path changes. Below 1200 px
// (breakpoint_drawer) a page's facet rail becomes a drawer through
// LayoutContext (components/Drawer.tsx).
import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useManifest } from '../data/manifest';
import { formatCount, formatPipeline } from '../format';
import { LayoutContext } from '../layout';
import type { LayoutState } from '../layout';
import { methodsHref, releasesHref } from '../navigation';
import { useRouter } from '../router';
import { strings } from '../strings';
import { Link } from './Link';
import { Navigation } from './Navigation';
import { SetBar } from './SetBar';

const MENU_ID = 'shell-menu';

function Wordmark() {
  return (
    <div className="flex flex-col gap-0.5 px-nav-item-padding-x pb-5.5 max-compact:pb-0">
      <span className="font-serif text-wordmark leading-tight font-semibold tracking-tight text-ink">
        {strings.wordmark}
      </span>
      <span className="text-small tracking-tagline text-text-secondary">{strings.tagline}</span>
    </div>
  );
}

export function ReleaseFooter() {
  const manifest = useManifest();
  const pending = strings.valuePending;
  const genomes =
    manifest === undefined
      ? strings.footerGenomeCount(pending, 0)
      : strings.footerGenomeCount(formatCount(manifest.genome_count), manifest.genome_count);
  return (
    <footer className="mx-nav-item-padding-x flex flex-col gap-0.75 border-t border-border-strong pt-3 text-small text-text-secondary">
      <span>
        {strings.footerRelease}{' '}
        {manifest === undefined ? (
          <span className="font-mono text-ink">{pending}</span>
        ) : (
          <Link to={releasesHref} className="font-mono no-underline">
            {manifest.release_id}
          </Link>
        )}
      </span>
      <span>
        <span className="whitespace-nowrap">{genomes}</span>
        {strings.separator}
        <span className="whitespace-nowrap">
          {manifest === undefined ? pending : formatPipeline(manifest.pipeline)}
        </span>
      </span>
      <Link to={methodsHref} className="self-start no-underline">
        {strings.footerMethods}
      </Link>
    </footer>
  );
}

function useLayoutState(pathname: string): LayoutState {
  // Open states are keyed by the path they were opened on, so that a route
  // change closes them without an effect.
  const [drawerOpenAt, setDrawerOpenAt] = useState<string | null>(null);
  const [drawerCount, setDrawerCount] = useState(0);
  const drawerOpen = drawerOpenAt === pathname;
  const toggleDrawer = useCallback(() => {
    setDrawerOpenAt((current) => (current === pathname ? null : pathname));
  }, [pathname]);
  const closeDrawer = useCallback(() => {
    setDrawerOpenAt(null);
  }, []);
  const registerDrawer = useCallback(() => {
    setDrawerCount((count) => count + 1);
    return () => {
      setDrawerCount((count) => count - 1);
    };
  }, []);
  return useMemo(
    () => ({
      drawerRegistered: drawerCount > 0,
      drawerOpen,
      toggleDrawer,
      closeDrawer,
      registerDrawer,
    }),
    [drawerCount, drawerOpen, toggleDrawer, closeDrawer, registerDrawer],
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { pathname } = useRouter();
  const manifest = useManifest();
  const layout = useLayoutState(pathname);
  const [menuOpenAt, setMenuOpenAt] = useState<string | null>(null);
  const menuOpen = menuOpenAt === pathname;
  const toggleMenu = () => {
    setMenuOpenAt(menuOpen ? null : pathname);
  };

  return (
    <LayoutContext value={layout}>
      <div className="grid min-h-screen grid-cols-[var(--spacing-sidebar-width)_minmax(0,1fr)] bg-background text-base text-ink max-compact:grid-cols-1 max-compact:grid-rows-[auto_minmax(0,1fr)]">
        <div className="flex flex-col border-r border-border-strong bg-sidebar pt-5.5 pb-4.5 compact:sticky compact:top-0 compact:h-screen compact:self-start max-compact:border-r-0 max-compact:border-b max-compact:py-3">
          <div className="flex items-start justify-between gap-2 max-compact:items-center">
            <Wordmark />
            <button
              type="button"
              className="mr-nav-item-padding-x rounded-control border border-control-border bg-panel px-3 py-1.75 text-control font-medium text-ink compact:hidden"
              aria-expanded={menuOpen}
              aria-controls={MENU_ID}
              onClick={toggleMenu}
            >
              {strings.menuToggle}
            </button>
          </div>
          <div
            id={MENU_ID}
            className={`flex grow flex-col ${menuOpen ? 'max-compact:pt-4' : 'max-compact:hidden'}`}
          >
            <Navigation />
            <div className="grow max-compact:h-4 max-compact:grow-0" />
            <ReleaseFooter />
          </div>
        </div>
        <div className="flex min-w-0 flex-col">
          <SetBar count={manifest?.genome_count} />
          <main className="relative flex min-w-0 grow flex-col">{children}</main>
        </div>
      </div>
    </LayoutContext>
  );
}
