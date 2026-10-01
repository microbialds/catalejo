// The "add filter" menu of the set bar (requirements §5.1, §5.2; data
// contract §7.5; collection board, "+ add filter"). The link opens a panel
// listing the fields in menu order; choosing one opens its value picker:
// a list with type-ahead for fields with values (species and curated sets
// from the manifest, drug classes from the palette, the others from the set
// engine), a year range, a percent bound, a toggle statement for plasmid
// contig and prophage, and a text area for genome identifiers. "Apply"
// replaces the field's values, so a value can also be cleared here. A field
// the release cannot evaluate is shown disabled with a tooltip (§5.7); the
// pangenome cluster field stays disabled while no species has a pangenome.
// Escape or a click outside closes the panel.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { useManifest } from '../data/manifest';
import type { Manifest } from '../data/manifest';
import type { FilterOption, SetEngine } from '../data/setEngine';
import { useEngineQuery } from '../data/setEngineContext';
import { formatCount } from '../format';
import { palette } from '../generated/palette';
import { chipLabel, fieldAvailable, fieldLabels, menuFields, valueClass } from '../set/fields';
import { fieldKind, withKey } from '../set/filters';
import type { FilterEntry, FilterKey, ListKey } from '../set/filters';
import { useGenomeSet } from '../set/store';
import { strings } from '../strings';
import { Button, buttonClass } from './Button';

const MAX_SHOWN = 200;
const NARROW_FROM = 8;

const inputClass =
  'w-full rounded-control border border-control-border bg-panel px-2 py-1 text-control text-ink';

function unavailableTip(manifest: Manifest, key: FilterKey): string {
  return key === 'cluster'
    ? strings.navAbsentPangenome(manifest.release_id)
    : strings.filterFieldAbsent(manifest.release_id);
}

function FieldList({ onPick }: { onPick: (key: FilterKey) => void }) {
  const manifest = useManifest();
  const tipBase = useId();
  return (
    <ul className="flex flex-col">
      {menuFields.map((field) => {
        const available = manifest !== undefined && fieldAvailable(manifest, field.key);
        if (available || manifest === undefined) {
          return (
            <li key={field.key}>
              <button
                type="button"
                className="w-full px-1 py-1 text-left text-control text-ink hover:bg-background"
                disabled={!available}
                onClick={() => {
                  onPick(field.key);
                }}
              >
                {field.label}
              </button>
            </li>
          );
        }
        const tip = unavailableTip(manifest, field.key);
        const tipId = `${tipBase}-${field.key}`;
        return (
          <li key={field.key} className="relative">
            <span
              tabIndex={0}
              aria-disabled="true"
              aria-describedby={tipId}
              title={tip}
              className="peer block cursor-default px-1 py-1 text-control text-text-faint"
            >
              {field.label}
            </span>
            <span
              id={tipId}
              role="tooltip"
              className="pointer-events-none invisible absolute top-full right-0 left-0 z-40 bg-ink px-2 py-1 text-small leading-body text-on-ink peer-hover:visible peer-focus:visible"
            >
              {tip}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function PickerFrame({
  field,
  onBack,
  onApply,
  children,
}: {
  field: FilterKey;
  onBack: () => void;
  onApply: () => void;
  children: ReactNode;
}) {
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onApply();
      }}
    >
      <div className="flex items-baseline justify-between gap-2 border-b border-rule-light pb-1.5">
        <span className="font-sans text-facet-title font-bold">{fieldLabels[field]}</span>
        <Button variant="link" onClick={onBack}>
          {strings.filterBack}
        </Button>
      </div>
      {children}
      <div className="flex justify-end">
        <Button variant="primary" type="submit">
          {strings.filterApply}
        </Button>
      </div>
    </form>
  );
}

/** Options known without the engine: species, curated sets, drug classes. */
function staticOptions(manifest: Manifest | undefined, key: ListKey): FilterOption[] | undefined {
  switch (key) {
    case 'species_code':
      return manifest?.species.map((species) => ({
        value: species.species_code,
        count: species.genome_count,
      }));
    case 'set':
      return manifest?.curated_sets.map((set) => ({ value: set.set_id, count: set.genome_count }));
    case 'drug_class':
      return palette.drug_classes.map((drugClass) => ({ value: drugClass.key }));
    default:
      return undefined;
  }
}

type OptionsState =
  { status: 'pending' } | { status: 'ready'; options: FilterOption[] } | { status: 'error' };

function useFieldOptions(key: ListKey): OptionsState {
  const manifest = useManifest();
  const known = staticOptions(manifest, key);
  const run = useMemo(() => (engine: SetEngine) => engine.filterOptions(key), [key]);
  const result = useEngineQuery(known === undefined ? `options:${key}` : null, run);
  if (known !== undefined) return { status: 'ready', options: known };
  if (result.status === 'ready') return { status: 'ready', options: result.value };
  if (result.status === 'error') return { status: 'error' };
  return { status: 'pending' };
}

function ListPicker({
  field,
  onBack,
  onDone,
}: {
  field: ListKey;
  onBack: () => void;
  onDone: () => void;
}) {
  const manifest = useManifest();
  const { filters, setFilters } = useGenomeSet();
  const state = useFieldOptions(field);
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(filters[field] ?? []),
  );
  const [narrow, setNarrow] = useState('');

  const labelled = useMemo(() => {
    if (state.status !== 'ready') return [];
    return state.options.map((option) => ({
      option,
      label: chipLabel({ key: field, value: option.value } as FilterEntry, manifest),
    }));
  }, [state, field, manifest]);
  const folded = narrow.trim().toLowerCase();
  const matching = labelled.filter(
    ({ option, label }) =>
      folded === '' ||
      option.value.toLowerCase().includes(folded) ||
      label.value.toLowerCase().includes(folded),
  );
  const shown = matching.slice(0, MAX_SHOWN);

  const toggle = (value: string, on: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(value);
      else next.delete(value);
      return next;
    });
  };

  const apply = () => {
    setFilters(withKey(filters, field, [...selected]));
    onDone();
  };

  return (
    <PickerFrame field={field} onBack={onBack} onApply={apply}>
      {state.status === 'pending' && <p className="text-text-secondary">{strings.filterLoading}</p>}
      {state.status === 'error' && (
        <p className="text-text-secondary">{strings.filterLoadFailed}</p>
      )}
      {state.status === 'ready' && labelled.length === 0 && (
        <p className="text-text-secondary">{strings.filterNoValues}</p>
      )}
      {labelled.length > NARROW_FROM && (
        <input
          type="search"
          className={inputClass}
          placeholder={strings.filterNarrow}
          aria-label={strings.filterNarrowLabel(fieldLabels[field])}
          value={narrow}
          onChange={(event) => {
            setNarrow(event.target.value);
          }}
        />
      )}
      {shown.length > 0 && (
        <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {shown.map(({ option, label }) => (
            <li key={option.value}>
              <label className="grid cursor-pointer grid-cols-[13px_minmax(0,1fr)_auto] items-center gap-2 text-control">
                <input
                  type="checkbox"
                  className="m-0 accent-ink"
                  checked={selected.has(option.value)}
                  onChange={(event) => {
                    toggle(option.value, event.target.checked);
                  }}
                />
                <span className={`truncate ${valueClass(label.style)}`}>{label.value}</span>
                <span className="font-mono text-small text-text-secondary">
                  {option.count === undefined
                    ? ''
                    : strings.filterOptionCount(formatCount(option.count))}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {matching.length > shown.length && (
        <p className="text-small text-text-secondary">
          {strings.filterShownOf(formatCount(shown.length), formatCount(matching.length))}
        </p>
      )}
    </PickerFrame>
  );
}

function readInteger(text: string): number | undefined {
  if (text.trim() === '') return undefined;
  const value = Number(text);
  return Number.isInteger(value) ? value : undefined;
}

function readNumber(text: string): number | undefined {
  if (text.trim() === '') return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

function YearPicker({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const { filters, setFilters } = useGenomeSet();
  const [min, setMin] = useState(filters.year?.min?.toString() ?? '');
  const [max, setMax] = useState(filters.year?.max?.toString() ?? '');
  const minId = useId();
  const maxId = useId();
  const apply = () => {
    const from = readInteger(min);
    const to = readInteger(max);
    const year = {
      ...(from === undefined ? {} : { min: from }),
      ...(to === undefined ? {} : { max: to }),
    };
    setFilters(withKey(filters, 'year', year));
    onDone();
  };
  return (
    <PickerFrame field="year" onBack={onBack} onApply={apply}>
      <div className="grid grid-cols-2 gap-2">
        <label htmlFor={minId} className="flex flex-col gap-1 text-small text-text-secondary">
          {strings.filterYearFrom}
          <input
            id={minId}
            type="number"
            step={1}
            className={inputClass}
            value={min}
            onChange={(event) => {
              setMin(event.target.value);
            }}
          />
        </label>
        <label htmlFor={maxId} className="flex flex-col gap-1 text-small text-text-secondary">
          {strings.filterYearTo}
          <input
            id={maxId}
            type="number"
            step={1}
            className={inputClass}
            value={max}
            onChange={(event) => {
              setMax(event.target.value);
            }}
          />
        </label>
      </div>
    </PickerFrame>
  );
}

function NumberPicker({
  field,
  onBack,
  onDone,
}: {
  field: 'completeness_min' | 'contamination_max';
  onBack: () => void;
  onDone: () => void;
}) {
  const { filters, setFilters } = useGenomeSet();
  const [text, setText] = useState(filters[field]?.toString() ?? '');
  const id = useId();
  const apply = () => {
    setFilters(withKey(filters, field, readNumber(text)));
    onDone();
  };
  return (
    <PickerFrame field={field} onBack={onBack} onApply={apply}>
      <p className="text-small text-text-secondary">
        {field === 'completeness_min'
          ? strings.filterCompletenessHint
          : strings.filterContaminationHint}
      </p>
      <label htmlFor={id} className="flex flex-col gap-1 text-small text-text-secondary">
        {strings.filterPercent}
        <input
          id={id}
          type="number"
          min={0}
          max={100}
          step={0.1}
          className={inputClass}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
      </label>
    </PickerFrame>
  );
}

function FlagPicker({
  field,
  onBack,
  onDone,
}: {
  field: 'plasmid_contig' | 'prophage';
  onBack: () => void;
  onDone: () => void;
}) {
  const { filters, setFilters } = useGenomeSet();
  const apply = () => {
    setFilters(withKey(filters, field, true));
    onDone();
  };
  return (
    <PickerFrame field={field} onBack={onBack} onApply={apply}>
      <p className="text-small text-text-secondary">
        {field === 'plasmid_contig' ? strings.filterPlasmidContigHint : strings.filterProphageHint}
      </p>
    </PickerFrame>
  );
}

function TextListPicker({
  field,
  hint,
  onBack,
  onDone,
}: {
  field: 'genome_id' | 'cluster';
  hint: string;
  onBack: () => void;
  onDone: () => void;
}) {
  const { filters, setFilters } = useGenomeSet();
  const [text, setText] = useState((filters[field] ?? []).join('\n'));
  const id = useId();
  const apply = () => {
    const values = text.split(/[\s,;]+/).filter((value) => value !== '');
    setFilters(withKey(filters, field, values));
    onDone();
  };
  return (
    <PickerFrame field={field} onBack={onBack} onApply={apply}>
      <label htmlFor={id} className="flex flex-col gap-1 text-small text-text-secondary">
        {hint}
        <textarea
          id={id}
          rows={6}
          spellCheck={false}
          className={`${inputClass} font-mono`}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
      </label>
    </PickerFrame>
  );
}

function FieldPicker({
  field,
  onBack,
  onDone,
}: {
  field: FilterKey;
  onBack: () => void;
  onDone: () => void;
}) {
  switch (field) {
    case 'year':
      return <YearPicker onBack={onBack} onDone={onDone} />;
    case 'completeness_min':
    case 'contamination_max':
      return <NumberPicker field={field} onBack={onBack} onDone={onDone} />;
    case 'plasmid_contig':
    case 'prophage':
      return <FlagPicker field={field} onBack={onBack} onDone={onDone} />;
    case 'genome_id':
      return (
        <TextListPicker
          field={field}
          hint={strings.filterGenomeIdsHint}
          onBack={onBack}
          onDone={onDone}
        />
      );
    case 'cluster':
      return (
        <TextListPicker
          field={field}
          hint={strings.filterClusterHint}
          onBack={onBack}
          onDone={onDone}
        />
      );
    default:
      return fieldKind(field) === 'list' ? (
        <ListPicker field={field} onBack={onBack} onDone={onDone} />
      ) : null;
  }
}

export function AddFilterMenu() {
  const [open, setOpen] = useState(false);
  const [field, setField] = useState<FilterKey | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const close = useCallback(() => {
    setOpen(false);
    setField(null);
    trigger.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (root.current !== null && !root.current.contains(event.target as Node)) {
        setOpen(false);
        setField(null);
      }
    };
    // Escape closes the panel wherever the focus is, including the page body
    // after the field list is replaced by a picker.
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) close();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  // The focus moves into the panel when it opens and when a picker replaces
  // the field list.
  useEffect(() => {
    if (!open) return;
    const target = panel.current?.querySelector<HTMLElement>(
      'input, textarea, button:not([disabled]), [tabindex="0"]',
    );
    target?.focus();
  }, [open, field]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      close();
    }
  };

  return (
    <div ref={root} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={trigger}
        type="button"
        className={`${buttonClass.link} whitespace-nowrap`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-haspopup="dialog"
        onClick={() => {
          if (open) close();
          else setOpen(true);
        }}
      >
        {strings.addFilter}
      </button>
      {open && (
        <div
          ref={panel}
          id={panelId}
          role="dialog"
          aria-label={strings.addFilterMenuLabel}
          className="absolute top-full left-0 z-30 mt-2 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 border border-border-strong bg-panel p-3 text-control text-ink"
        >
          {field === null ? (
            <FieldList onPick={setField} />
          ) : (
            <FieldPicker
              key={field}
              field={field}
              onBack={() => {
                setField(null);
              }}
              onDone={close}
            />
          )}
        </div>
      )}
    </div>
  );
}
