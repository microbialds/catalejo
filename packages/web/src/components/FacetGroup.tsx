// Facet group (requirements §6.1, §7; collection board, facet rail). An
// uppercase letterspaced label over rows of checkbox, value and count; counts
// in monospace, right-aligned. A row is checked while its value is an active
// filter, and toggling it adds or removes the filter. Values with no genome
// in the current set stay listed (values within a field are alternatives,
// §5.2) with the value in faint text.
import type { ReactNode } from 'react';
import { formatCount } from '../format';
import { strings } from '../strings';

export function FacetGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-2 text-small font-semibold tracking-label text-text-label uppercase">
        {label}
      </legend>
      {children}
    </fieldset>
  );
}

export interface FacetOptionProps {
  checked: boolean;
  onToggle: (checked: boolean) => void;
  /** The value as shown (a species name in italic serif, a class label). */
  label: ReactNode;
  /** The value as plain text, for the accessible name. */
  name: string;
  /** Genomes of the current set with the value; undefined while pending. */
  count: number | undefined;
  /** A leading mark, such as the species swatch. */
  mark?: ReactNode;
}

export function FacetOption({ checked, onToggle, label, name, count, mark }: FacetOptionProps) {
  const shown = count === undefined ? strings.valuePending : formatCount(count);
  const empty = count === 0 && !checked;
  return (
    <label className="grid cursor-pointer grid-cols-[13px_minmax(0,1fr)_38px] items-center gap-2 text-control">
      <input
        type="checkbox"
        className="m-0 size-3.25 accent-ink"
        checked={checked}
        aria-label={strings.facetOptionName(name, shown)}
        onChange={(event) => {
          onToggle(event.target.checked);
        }}
      />
      <span
        className={`flex min-w-0 items-center gap-1.5 ${empty ? 'text-text-faint' : 'text-ink'}`}
      >
        {mark}
        <span className="min-w-0 truncate">{label}</span>
      </span>
      <span className="text-right font-mono text-small text-text-secondary">{shown}</span>
    </label>
  );
}
