// Annotation version warning (requirements §5.6; data contract §6.4). The
// warning shows when the species of the current set together carry more than
// one database version of Bakta or of AMRFinderPlus. It reads the versions
// per species in the manifest and never scans tool_version.
import { compareText } from '../set/filters';
import type { Manifest } from './manifest';

export interface AnnotationVersionWarning {
  bakta: string[];
  amrfinderplus: string[];
}

/**
 * The union of the versions of each tool over the given species, or null
 * when neither tool has more than one version in the union.
 */
export function annotationVersionWarning(
  manifest: Manifest,
  speciesCodes: Iterable<string>,
): AnnotationVersionWarning | null {
  const wanted = new Set(speciesCodes);
  const bakta = new Set<string>();
  const amrfinderplus = new Set<string>();
  for (const species of manifest.species) {
    if (!wanted.has(species.species_code)) continue;
    for (const version of species.annotation_versions?.bakta ?? []) bakta.add(version);
    for (const version of species.annotation_versions?.amrfinderplus ?? []) {
      amrfinderplus.add(version);
    }
  }
  if (bakta.size <= 1 && amrfinderplus.size <= 1) return null;
  return {
    bakta: [...bakta].sort(compareText),
    amrfinderplus: [...amrfinderplus].sort(compareText),
  };
}
