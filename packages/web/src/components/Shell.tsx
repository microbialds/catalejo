// Application shell (requirements §5.1, §5.10, §7; collection board). A 200 px
// left column on the sidebar color with a hairline right border holds the
// wordmark and tagline, the navigation and the release footer; the main
// column holds the 56 px set bar and the page. The grid stacks below the
// compact breakpoint (900 px); the collapsing menu arrives with milestone 1b.
import type { ReactNode } from 'react';
import { methodsHref } from '../navigation';
import { strings } from '../strings';
import { Navigation } from './Navigation';
import { SetBar } from './SetBar';

function Wordmark() {
  return (
    <div className="flex flex-col gap-0.5 px-nav-item-padding-x pb-5.5">
      <span className="font-serif text-wordmark leading-[1.1] font-semibold tracking-tight text-ink">
        {strings.wordmark}
      </span>
      <span className="text-small tracking-tagline text-text-secondary">{strings.tagline}</span>
    </div>
  );
}

function ReleaseFooter() {
  return (
    <footer className="mx-nav-item-padding-x flex flex-col gap-0.75 border-t border-border-strong pt-3 text-small text-text-secondary">
      <span>
        {strings.footerRelease} <span className="font-mono text-ink">{strings.valuePending}</span>
      </span>
      <span>
        {strings.valuePending} {strings.footerGenomes}
        {strings.separator}
        {strings.footerPipeline} {strings.valuePending}
      </span>
      <a href={methodsHref} className="no-underline">
        {strings.footerMethods}
      </a>
    </footer>
  );
}

export function Shell({ pathname, children }: { pathname: string; children: ReactNode }) {
  return (
    <div className="grid min-h-screen grid-cols-[var(--spacing-sidebar-width)_minmax(0,1fr)] bg-background text-base text-ink max-compact:grid-cols-1">
      <div className="flex flex-col border-r border-border-strong bg-sidebar pt-5.5 pb-4.5 max-compact:border-r-0 max-compact:border-b">
        <Wordmark />
        <Navigation pathname={pathname} />
        <div className="grow" />
        <ReleaseFooter />
      </div>
      <div className="flex min-w-0 flex-col">
        <SetBar />
        {children}
      </div>
    </div>
  );
}
