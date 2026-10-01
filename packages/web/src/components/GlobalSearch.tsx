// Global search in the set bar (requirements §5.8, §5.9, §7; collection board,
// underlined search field). The index (summaries/search_index.parquet, data
// contract §6.2) is loaded once, on first focus or input. Results are grouped
// by kind with the number of matches in each group, capped per group, in an
// ARIA combobox with a listbox: ArrowDown and ArrowUp move through the
// options, Enter opens the active one, or the genome when the text is exactly
// one genome identifier, and Escape closes the list, then clears the field.
// Genome and gene targets keep the current set; a sequence type target is a
// filter and replaces it.
import { useId, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useManifest } from '../data/manifest';
import {
  buildSearchIndex,
  exactGenomeMatch,
  matchSearch,
  searchTargetHref,
} from '../data/searchIndex';
import type { SearchEntry, SearchIndex, SearchKind } from '../data/searchIndex';
import { useSetEngine } from '../data/setEngineContext';
import { formatCount } from '../format';
import { useRouter } from '../router';
import { speciesName } from '../set/fields';
import { strings } from '../strings';

const PER_GROUP = 5;

const kindLabels: Readonly<Record<SearchKind, string>> = {
  genome_id: strings.searchKindGenome,
  accession: strings.searchKindAccession,
  gene: strings.searchKindGene,
  element: strings.searchKindElement,
  cluster: strings.searchKindCluster,
  product: strings.searchKindProduct,
  st: strings.searchKindSt,
};

const termClass: Readonly<Record<SearchKind, string>> = {
  genome_id: 'font-mono',
  accession: 'font-mono',
  gene: 'font-mono italic',
  element: 'font-mono italic',
  cluster: 'font-mono',
  product: '',
  st: 'font-mono',
};

type IndexState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; index: SearchIndex }
  | { status: 'error' };

export function GlobalSearch() {
  const manifest = useManifest();
  const getEngine = useSetEngine();
  const { search, navigate } = useRouter();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [state, setState] = useState<IndexState>({ status: 'idle' });
  const baseId = useId();
  const listId = `${baseId}-results`;

  const load = () => {
    if (state.status !== 'idle' || getEngine === undefined) return;
    setState({ status: 'loading' });
    getEngine()
      .then((engine) => engine.searchRows())
      .then(
        (rows) => {
          setState({ status: 'ready', index: buildSearchIndex(rows) });
        },
        () => {
          setState({ status: 'error' });
        },
      );
  };

  const groups = useMemo(
    () => (state.status === 'ready' ? matchSearch(state.index, query, PER_GROUP) : []),
    [state, query],
  );
  const options = groups.flatMap((group) => group.matches.map((match) => match.entry));
  const optionId = (index: number) => `${baseId}-option-${String(index)}`;
  const showList = open && query.trim() !== '';

  const go = (entry: SearchEntry) => {
    const href = searchTargetHref(entry.target, search);
    const mark = href.indexOf('?');
    navigate(mark >= 0 ? href.slice(0, mark) : href, {
      replaceQuery: mark >= 0 ? href.slice(mark) : '',
    });
    setQuery('');
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        setOpen(true);
        if (options.length === 0) return;
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setActive((current) => {
          if (current < 0) return step > 0 ? 0 : options.length - 1;
          return (current + step + options.length) % options.length;
        });
        return;
      }
      case 'Enter': {
        const chosen = open && active >= 0 ? options[active] : undefined;
        const exact =
          chosen ?? (state.status === 'ready' ? exactGenomeMatch(state.index, query) : undefined);
        if (exact !== undefined) {
          event.preventDefault();
          go(exact);
        }
        return;
      }
      case 'Escape':
        if (showList) {
          event.preventDefault();
          setOpen(false);
          setActive(-1);
        } else if (query !== '') {
          event.preventDefault();
          setQuery('');
        }
        return;
      default:
        return;
    }
  };

  const offsets = groups.map((_, i) =>
    groups.slice(0, i).reduce((total, group) => total + group.matches.length, 0),
  );
  return (
    <div className="relative">
      <label className="flex h-7.5 w-70 items-center gap-2 border-b border-ink px-0.5 max-drawer:w-52">
        <span className="sr-only">{strings.searchLabel}</span>
        <input
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={showList ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={strings.searchPlaceholder}
          className="w-full min-w-0 bg-transparent text-base text-ink outline-none placeholder:text-text-secondary"
          value={query}
          onFocus={() => {
            load();
            setOpen(true);
          }}
          onBlur={() => {
            setOpen(false);
            setActive(-1);
          }}
          onChange={(event) => {
            load();
            setQuery(event.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onKeyDown={onKeyDown}
        />
      </label>
      {showList && (
        <div
          className="absolute top-full right-0 z-30 mt-1 max-h-[70vh] w-105 max-compact:right-auto max-compact:left-0 max-w-[calc(100vw-2rem)] overflow-y-auto border border-border-strong bg-panel py-1 text-control"
          onMouseDown={(event) => {
            // Keep the focus in the field while an option is chosen.
            event.preventDefault();
          }}
        >
          {state.status === 'loading' && (
            <p className="px-3 py-2 text-text-secondary">{strings.searchLoading}</p>
          )}
          {state.status === 'error' && (
            <p className="px-3 py-2 text-text-secondary">{strings.searchUnavailable}</p>
          )}
          {state.status === 'ready' && groups.length === 0 && (
            <p className="px-3 py-2 text-text-secondary">{strings.searchNoMatches}</p>
          )}
          <div id={listId} role="listbox" aria-label={strings.searchResultsLabel}>
            {groups.map((group, groupIndex) => {
              const headingId = `${baseId}-group-${group.kind}`;
              return (
                <div key={group.kind} role="group" aria-labelledby={headingId}>
                  <div
                    id={headingId}
                    className="flex justify-between px-3 pt-2 pb-1 text-micro font-semibold tracking-label text-text-label uppercase"
                  >
                    <span>{kindLabels[group.kind]}</span>
                    <span className="font-mono">
                      {strings.searchGroupCount(formatCount(group.total))}
                    </span>
                  </div>
                  {group.matches.map(({ entry }, matchIndex) => {
                    const index = (offsets[groupIndex] ?? 0) + matchIndex;
                    const selected = index === active;
                    return (
                      <div
                        key={`${entry.kind}-${entry.term}-${entry.target}`}
                        id={optionId(index)}
                        role="option"
                        aria-selected={selected}
                        className={`flex cursor-pointer items-baseline justify-between gap-3 px-3 py-1 ${selected ? 'bg-background' : ''}`}
                        onMouseEnter={() => {
                          setActive(index);
                        }}
                        onClick={() => {
                          go(entry);
                        }}
                      >
                        <span className="flex min-w-0 items-baseline gap-2">
                          <span className={`truncate ${termClass[entry.kind]}`}>{entry.term}</span>
                          {entry.kind === 'st' &&
                            entry.speciesCodes.map((code) => (
                              <span key={code} className="truncate font-serif text-ink italic">
                                {speciesName(manifest, code)}
                              </span>
                            ))}
                        </span>
                        <span className="shrink-0 font-mono text-small text-text-secondary">
                          {strings.searchGenomeCount(formatCount(entry.count), entry.count)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
