// The active filters as chips, one per value in menu order (requirements
// §5.1, §5.2; contract §7.5), each with its remove control. Explicit genome
// identifiers are one chip ("N genomes (list)"); a curated set shows its name
// from the manifest. Element names, the genes of point mutations and
// pangenome clusters link to their Genes page, keeping the set (requirements
// §5.9). A mutation value is `<gene>_<variant>` (contract §7.5), split at its
// last underscore as contract §5.6 splits AMRFinderPlus element symbols, so
// that `gyrA_S83I` links to /genes/symbol/gyrA.
import { useManifest } from '../data/manifest';
import { routePath } from '../router';
import { chipLabel } from '../set/fields';
import { entryId } from '../set/filters';
import type { FilterEntry } from '../set/filters';
import { useGenomeSet } from '../set/store';
import { strings } from '../strings';
import { Chip } from './Chip';

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
