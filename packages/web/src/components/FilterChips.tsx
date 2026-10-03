// The active filters as chips, one per value in menu order (requirements
// §5.1, §5.2; contract §7.5), each with its remove control. Explicit genome
// identifiers are one chip ("N genomes (list)"); a curated set shows its name
// from the manifest. Element names, the genes of point mutations and
// pangenome clusters link to their Genes page, keeping the set (requirements
// §5.9). A mutation value is `<gene>_<variant>` (contract §7.5), split at its
// last underscore as contract §5.6 splits AMRFinderPlus element symbols, so
// that `gyrA_S83I` links to /genes/symbol/gyrA.
//
// In the set bar (BarFilterChips) the chips stay on one line, so that the bar
// keeps its 56 px height at every width (§5.1): the row follows its own width
// with a ResizeObserver and shows the chips that fit, in the store's order
// (components/chipFit.ts), then a "+N more" control counting the others. The
// control opens a popover with every chip and its remove control, dismissed
// like the other popovers (components/useDismiss.ts; Escape returns the focus
// to the control); it closes when the path changes and when every chip fits
// again. Chip widths are measured in place, with every chip on the line, in
// a layout pass before paint whenever the chips or the loaded fonts change.
// Without a ResizeObserver (the component tests) every chip shows.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useManifest } from '../data/manifest';
import type { Manifest } from '../data/manifest';
import { routePath, useRouter } from '../router';
import { chipLabel } from '../set/fields';
import { entryId } from '../set/filters';
import type { FilterEntry } from '../set/filters';
import { useGenomeSet } from '../set/store';
import { strings } from '../strings';
import { Chip } from './Chip';
import { visibleChipCount } from './chipFit';
import { useDismiss } from './useDismiss';

/** The gene of a point mutation value `<gene>_<variant>`, or undefined without one. */
export function mutationGene(value: string): string | undefined {
  const mark = value.lastIndexOf('_');
  return mark > 0 && mark < value.length - 1 ? value.slice(0, mark) : undefined;
}

/** The Genes page of a chip's value: an element, a mutated gene or a cluster. */
export function chipTarget(entry: FilterEntry): string | undefined {
  switch (entry.key) {
    case 'presence_amr':
      return routePath({ page: 'gene', namespace: 'element', name: entry.value });
    case 'mutation': {
      const gene = mutationGene(entry.value);
      return gene === undefined
        ? undefined
        : routePath({ page: 'gene', namespace: 'symbol', name: gene });
    }
    case 'cluster':
      return routePath({ page: 'gene', namespace: 'cluster', name: entry.value });
    default:
      return undefined;
  }
}

export function FilterChips({ removable = true }: { removable?: boolean }) {
  const manifest = useManifest();
  const { entries, removeEntry } = useGenomeSet();
  if (entries.length === 0) return null;
  return (
    <ul
      aria-label={strings.activeFiltersLabel}
      className="flex min-w-0 flex-wrap items-center gap-2"
    >
      {entries.map((entry) => (
        <li key={entryId(entry)} className="flex min-w-0">
          <Chip
            label={chipLabel(entry, manifest)}
            to={chipTarget(entry)}
            {...(removable
              ? {
                  onRemove: () => {
                    removeEntry(entry);
                  },
                }
              : {})}
          />
        </li>
      ))}
    </ul>
  );
}

/** The chip of one entry, with its remove control. */
function EntryChip({
  entry,
  manifest,
  onRemoved,
}: {
  entry: FilterEntry;
  manifest: Manifest | undefined;
  onRemoved?: () => void;
}) {
  const { removeEntry } = useGenomeSet();
  return (
    <Chip
      label={chipLabel(entry, manifest)}
      to={chipTarget(entry)}
      onRemove={() => {
        onRemoved?.();
        removeEntry(entry);
      }}
    />
  );
}

/** The width of an element's border box, in CSS pixels. */
function widthOf(element: Element | null | undefined): number {
  return element?.getBoundingClientRect().width ?? 0;
}

/** The width of an element, following it; undefined without a ResizeObserver. */
function useObservedWidth(target: RefObject<HTMLElement | null>): number | undefined {
  const [width, setWidth] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const element = target.current;
    if (element === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      setWidth(widthOf(element));
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [target]);
  return width;
}

/** A counter that moves each time a set of web fonts finishes loading. */
function useFontsVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const fonts = typeof document === 'undefined' ? undefined : document.fonts;
    if (fonts === undefined || typeof fonts.addEventListener !== 'function') return;
    let live = true;
    const bump = () => {
      if (live) setVersion((value) => value + 1);
    };
    void fonts.ready.then(bump);
    fonts.addEventListener('loadingdone', bump);
    return () => {
      live = false;
      fonts.removeEventListener('loadingdone', bump);
    };
  }, []);
  return version;
}

interface Measure {
  key: string;
  widths: number[];
  gap: number;
  more: number;
}

const moreClass =
  'shrink-0 whitespace-nowrap rounded-control border border-control-border bg-panel px-2 py-0.75 text-control text-ink hover:border-ink';

export function BarFilterChips() {
  const manifest = useManifest();
  const { pathname } = useRouter();
  const { entries } = useGenomeSet();
  const area = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const available = useObservedWidth(area);
  const fonts = useFontsVersion();

  const key = [
    String(fonts),
    ...entries.map((entry) => `${entryId(entry)}\u0001${chipLabel(entry, manifest).text}`),
  ].join('\u0002');
  const [measure, setMeasure] = useState<Measure | undefined>(undefined);
  const measuring = available !== undefined && entries.length > 0 && measure?.key !== key;

  // The measuring pass: every chip on the line, and the control with the
  // largest count it can show; read before paint.
  useLayoutEffect(() => {
    if (!measuring) return;
    const items = Array.from(list.current?.children ?? []);
    const style = line.current === null ? undefined : getComputedStyle(line.current);
    const gap = Number.parseFloat(style?.columnGap ?? '');
    setMeasure({
      key,
      widths: items.map((item) => widthOf(item)),
      gap: Number.isFinite(gap) ? gap : 0,
      more: widthOf(moreButton.current),
    });
  }, [measuring, key]);

  const shown =
    measure === undefined || available === undefined || measuring
      ? entries.length
      : visibleChipCount(measure.widths, available, measure.gap, measure.more);
  const hidden = entries.length - shown;

  const [openAt, setOpenAt] = useState<string | null>(null);
  // The popover stays mounted through a measuring pass, so the focus inside
  // it survives a removal; once every chip fits it closes (derived state).
  const open = openAt === pathname && (hidden > 0 || measuring);
  if (openAt !== null && !measuring && hidden === 0) setOpenAt(null);
  const removedInside = useRef(false);
  const close = useCallback(() => {
    removedInside.current = false;
    setOpenAt(null);
  }, []);
  useDismiss(open, { root: area, trigger: moreButton, onClose: close });

  // The focus moves into the popover when it opens, and to its first chip
  // when the focused chip was removed. When a removal inside it lets every
  // chip fit, the popover and its control leave and the focus moves to the
  // last chip of the row.
  useEffect(() => {
    const lost = document.activeElement === null || document.activeElement === document.body;
    if (open) {
      if (lost || !removedInside.current) {
        popover.current?.querySelector<HTMLElement>('a, button')?.focus();
      }
      return;
    }
    if (!removedInside.current) return;
    removedInside.current = false;
    if (!lost) return;
    const removes = list.current?.querySelectorAll<HTMLElement>('button');
    removes?.[removes.length - 1]?.focus();
  }, [open, entries.length]);

  if (entries.length === 0) return <div ref={area} className="min-w-0 flex-1 self-stretch" />;
  return (
    <div ref={area} className="flex min-w-0 flex-1 items-center self-stretch compact:relative">
      <div ref={line} className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        {shown > 0 && (
          <ul
            ref={list}
            aria-label={strings.activeFiltersLabel}
            className="flex min-w-0 items-center gap-2"
          >
            {entries.slice(0, shown).map((entry) => (
              <li key={entryId(entry)} className="flex shrink-0">
                <EntryChip entry={entry} manifest={manifest} />
              </li>
            ))}
          </ul>
        )}
        {(hidden > 0 || measuring) && (
          <button
            ref={moreButton}
            type="button"
            className={moreClass}
            aria-expanded={open}
            aria-controls={open ? popoverId : undefined}
            aria-haspopup="dialog"
            onClick={() => {
              setOpenAt(open ? null : pathname);
            }}
          >
            {strings.moreFilters(measuring ? entries.length : hidden)}
          </button>
        )}
      </div>
      {open && (
        <div
          ref={popover}
          id={popoverId}
          role="dialog"
          aria-label={strings.allFiltersLabel}
          className="absolute top-full left-0 z-30 w-80 max-w-[calc(100vw-2rem)] border border-border-strong bg-panel p-3 max-compact:right-page-padding-x max-compact:left-page-padding-x max-compact:w-auto max-compact:max-w-none"
        >
          <ul aria-label={strings.allFiltersLabel} className="flex flex-col items-start gap-2">
            {entries.map((entry) => (
              <li key={entryId(entry)} className="flex max-w-full min-w-0">
                <EntryChip
                  entry={entry}
                  manifest={manifest}
                  onRemoved={() => {
                    removedInside.current = true;
                  }}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
