// The genome set exchange file (data contract §7.5): "Save set" writes the
// canonical filters, including set and genome_id, and the resolved genome
// identifiers of the current release, sorted.
import type { Manifest } from '../data/manifest';
import { canonicalFilters, compareText } from './filters';
import type { GenomeFilters } from './filters';

export interface GenomeSetDocument {
  format: 'genome-set';
  format_version: 1;
  release_id: string;
  name: string;
  filters: GenomeFilters;
  genome_ids: string[];
}

export function genomeSetDocument(
  manifest: Manifest,
  filters: GenomeFilters,
  genomeIds: readonly string[],
  name: string,
): GenomeSetDocument {
  return {
    format: 'genome-set',
    format_version: 1,
    release_id: manifest.release_id,
    name,
    filters: canonicalFilters(filters),
    genome_ids: [...new Set(genomeIds)].sort(compareText),
  };
}

/** The file text: JSON with a trailing newline. */
export function genomeSetText(document: GenomeSetDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
