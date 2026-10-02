// Facet group (requirements §6.1, §7; collection board, facet rail). A
// sentence case bold label over rows of checkbox, value and count; counts
// in monospace, right-aligned. A link inside the group (the annotation
// version note's Methods link) is in the quiet tier of the facet rail (§5.4). A row is checked while its value is an active
// filter, and toggling it adds or removes the filter. Values with no genome
// in the current set stay listed (values within a field are alternatives,
// §5.2) with the value in the label color, which keeps AA contrast (§9;
// chrome.text_faint is decorative only, config/palette.yaml).
import type { ReactNode } from 'react';
import { formatCount } from '../format';
import { strings } from '../strings';
import { Checkbox } from './Checkbox';

export function FacetGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2 [&_a]:link-quiet">
      <legend className="mb-2 text-small font-bold tracking-label text-text-label">{label}</legend>
      {children}
    </fieldset>
  );
}

export interface FacetOptionProps {
  checked: boolean;
  onToggle: (checked: boolean) => void;
  /** The value as shown (a species name in italic sans, a class label). */
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
      <Checkbox
        checked={checked}
        aria-label={strings.facetOptionName(name, shown, count)}
        onChange={(event) => {
          onToggle(event.target.checked);
        }}
      />
      <span
        className={`flex min-w-0 items-center gap-1.5 ${empty ? 'text-text-label' : 'text-ink'}`}
      >
        {mark}
        <span className="min-w-0 truncate">{label}</span>
      </span>
      <span className="text-right font-mono text-small text-text-secondary">{shown}</span>
    </label>
  );
}
