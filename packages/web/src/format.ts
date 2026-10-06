// Number and value formatting for the interface (requirements §3: the
// interface is in English, so numbers use en-US grouping).
import type { ManifestPipeline } from './data/manifest';
import { strings } from './strings';

const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** A count with en-US grouping: 4812 becomes "4,812". */
export function formatCount(value: number): string {
  return integer.format(value);
}

/** The pipeline name and its versions, as in "gene2dis/mgap 2.0.0" (contract §6.4). */
export function formatPipeline(pipeline: ManifestPipeline): string {
  if (pipeline.versions.length === 0) return pipeline.name;
  return `${pipeline.name} ${pipeline.versions.join(strings.listSeparator)}`;
}
