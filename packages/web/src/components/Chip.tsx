// Filter chip (requirements §5.1, §7; collection board, set bar). A hairline
// outlined label with 2 px corners on the panel color; the field label in
// secondary text, then the value set by type (species italic serif, genes
// and elements italic monospace, identifiers monospace), then a text remove
// control whose accessible name states the filter.
import type { ChipLabel } from '../set/fields';
import { valueClass } from '../set/fields';
import { strings } from '../strings';

export interface ChipProps {
  label: ChipLabel;
  onRemove?: () => void;
}

export function Chip({ label, onRemove }: ChipProps) {
  return (
    <span className="inline-flex max-w-full min-w-0 items-baseline gap-1 rounded-control border border-control-border bg-panel py-0.75 pr-1 pl-2.5 text-control text-ink">
      {label.prefix !== undefined && <span className="text-text-secondary">{label.prefix}</span>}
      <span className={`truncate ${valueClass(label.style)}`}>{label.value}</span>
      {onRemove !== undefined && (
        <button
          type="button"
          aria-label={strings.removeFilter(label.text)}
          title={strings.removeFilter(label.text)}
          className="px-1 text-text-secondary hover:text-ink"
          onClick={onRemove}
        >
          {strings.removeFilterGlyph}
        </button>
      )}
    </span>
  );
}
