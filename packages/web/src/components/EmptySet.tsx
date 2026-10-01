// Empty set (requirements §5.2): when the filters select no genome, the main
// area of every page is this message, the active filters as chips, and a
// link that clears the last filter; nothing else renders.
import { useGenomeSet } from '../set/store';
import { withoutEntry } from '../set/filters';
import { useRouter } from '../router';
import { strings } from '../strings';
import { FilterChips } from './FilterChips';
import { Link } from './Link';

export function EmptySet() {
  const { pathname } = useRouter();
  const { filters, lastEntry, queryFor } = useGenomeSet();
  return (
    <section
      aria-label={strings.emptySetStatement}
      className="flex min-w-0 flex-col items-start gap-3 px-page-padding-x py-page-padding-y"
    >
      <p className="text-ink">{strings.emptySetStatement}</p>
      <FilterChips />
      {lastEntry !== undefined && (
        <Link
          to={pathname}
          query={queryFor(withoutEntry(filters, lastEntry))}
          className="text-control no-underline"
        >
          {strings.emptySetClearLast}
        </Link>
      )}
    </section>
  );
}
