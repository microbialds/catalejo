// The active filters as chips, one per value in menu order (requirements
// §5.1, §5.2; contract §7.5), each with its remove control. Explicit genome
// identifiers are one chip ("N genomes (list)"); a curated set shows its name
// from the manifest. Element names and pangenome clusters link to their Genes
// page (requirements §5.9).
import { useManifest } from '../data/manifest';
import { routePath } from '../router';
import { chipLabel } from '../set/fields';
import { entryId } from '../set/filters';
import type { FilterEntry } from '../set/filters';
import { useGenomeSet } from '../set/store';
import { strings } from '../strings';
import { Chip } from './Chip';

/** The Genes page of a chip's value, when the value is an element or a cluster. */
export function chipTarget(entry: FilterEntry): string | undefined {
  switch (entry.key) {
    case 'presence_amr':
      return routePath({ page: 'gene', namespace: 'element', name: entry.value });
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
