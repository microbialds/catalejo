// Filter chip (requirements §5.1, §7; collection board, set bar). A hairline
// outlined label with 2 px corners on the panel color; the field label in
// secondary text, then the value set by type (species italic serif, genes
// and elements italic monospace, identifiers monospace), then a text remove
// control whose accessible name states the filter. A value with a page of its
// own (an element or a pangenome cluster, §5.9) links to it, keeping the set.
import type { ChipLabel } from '../set/fields';
import { valueClass } from '../set/fields';
import { strings } from '../strings';
import { Link } from './Link';

export interface ChipProps {
  label: ChipLabel;
  /** The page of the value, when it has one (requirements §5.9). */
  to?: string | undefined;
  onRemove?: () => void;
}

export function Chip({ label, to, onRemove }: ChipProps) {
  const value = `truncate ${valueClass(label.style)}`;
  return (
    <span className="inline-flex max-w-full min-w-0 items-baseline gap-1 rounded-control border border-control-border bg-panel py-0.75 pr-1 pl-2.5 text-control text-ink">
      {label.prefix !== undefined && <span className="text-text-secondary">{label.prefix}</span>}
      {to === undefined ? (
        <span className={value}>{label.value}</span>
      ) : (
        <Link to={to} className={`${value} text-ink no-underline hover:text-accent`}>
          {label.value}
        </Link>
      )}
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
