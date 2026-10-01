// Presentation of the filter fields (requirements §5.2; data contract §7.5):
// the menu label of each field, whether the release can evaluate it (from
// the manifest alone, so the menu renders before the engine starts), and the
// label of each chip. Species names are set in italic serif, gene, element
// and mutation names in italic monospace, other identifiers in monospace.
import type { Manifest } from '../data/manifest';
import { formatCount } from '../format';
import { palette } from '../generated/palette';
import { strings } from '../strings';
import { filterFields } from './filters';
import type { FilterEntry, FilterKey } from './filters';

export const fieldLabels: Readonly<Record<FilterKey, string>> = {
  species_code: strings.filterFieldSpecies,
  st: strings.filterFieldSt,
  source_type: strings.filterFieldSourceType,
  country: strings.filterFieldCountry,
  year: strings.filterFieldYear,
  platform: strings.filterFieldPlatform,
  assembly_status: strings.filterFieldAssemblyStatus,
  completeness_min: strings.filterFieldCompleteness,
  contamination_max: strings.filterFieldContamination,
  presence_amr: strings.filterFieldPresenceAmr,
  drug_class: strings.filterFieldDrugClass,
  mutation: strings.filterFieldMutation,
  replicon: strings.filterFieldReplicon,
  plasmid_contig: strings.filterFieldPlasmidContig,
  presence_mob: strings.filterFieldPresenceMob,
  prophage: strings.filterFieldProphage,
  cluster: strings.filterFieldCluster,
  set: strings.filterFieldSet,
  genome_id: strings.filterFieldGenomeId,
};

/** The fields in menu order with their labels. */
export const menuFields = filterFields.map((field) => ({
  ...field,
  label: fieldLabels[field.key],
}));

/** The file each field reads beyond tables/genome.parquet (contract §6.1, §6.2). */
const FIELD_FILES: Partial<Record<FilterKey, string>> = {
  presence_amr: 'presence_amr.parquet',
  drug_class: 'summaries/amr_class_by_genome.parquet',
  mutation: 'tables/mutation.parquet',
  replicon: 'presence_replicon.parquet',
  presence_mob: 'presence_mob.parquet',
  set: 'tables/genome_set_member.parquet',
};

/** Whether the release can evaluate a field (requirements §5.7). */
export function fieldAvailable(manifest: Manifest, key: FilterKey): boolean {
  if (key === 'cluster') {
    const files = new Set(manifest.files.map((file) => file.path));
    return manifest.species.some(
      (species) => species.has_pangenome && files.has(`presence/${species.species_code}.parquet`),
    );
  }
  if (key === 'set' && manifest.curated_sets.length === 0) return false;
  const file = FIELD_FILES[key];
  if (file === undefined) return true;
  return manifest.files.some((entry) => entry.path === file);
}

/** The label of a drug class key of the palette, or the key itself. */
export function drugClassLabel(key: string): string {
  const found = palette.drug_classes.find((drugClass) => drugClass.key === key);
  return found === undefined ? key : strings[found.label_key];
}

/** The canonical species name of a code, or the code itself. */
export function speciesName(manifest: Manifest | undefined, code: string): string {
  return manifest?.species.find((species) => species.species_code === code)?.canonical_name ?? code;
}

/** The name of a curated set, or its identifier. */
export function curatedSetName(manifest: Manifest | undefined, setId: string): string {
  return manifest?.curated_sets.find((set) => set.set_id === setId)?.name ?? setId;
}

/** How a value is set: species italic serif, genes italic monospace, ids monospace. */
export type ValueStyle = 'species' | 'gene' | 'identifier' | 'plain';

export interface ChipLabel {
  /** The field label before the value, if any. */
  prefix?: string;
  value: string;
  style: ValueStyle;
  /** The whole label as plain text, for the accessible name of the remove control. */
  text: string;
}

const MAX_LISTED_IDS = 3;

function percent(value: number): string {
  return String(Number(value.toFixed(2)));
}

function label(prefix: string | undefined, value: string, style: ValueStyle): ChipLabel {
  const text = prefix === undefined ? value : `${prefix} ${value}`;
  return prefix === undefined ? { value, style, text } : { prefix, value, style, text };
}

/** The label of a chip for one filter entry. */
export function chipLabel(entry: FilterEntry, manifest: Manifest | undefined): ChipLabel {
  switch (entry.key) {
    case 'species_code':
      return label(undefined, speciesName(manifest, entry.value), 'species');
    case 'st':
      return label(undefined, strings.chipSt(entry.value), 'identifier');
    case 'source_type':
      return label(strings.chipPrefixSourceType, entry.value, 'plain');
    case 'country':
      return label(strings.chipPrefixCountry, entry.value, 'plain');
    case 'platform':
      return label(strings.chipPrefixPlatform, entry.value, 'plain');
    case 'assembly_status':
      return label(strings.chipPrefixAssemblyStatus, entry.value, 'plain');
    case 'presence_amr':
      return label(undefined, entry.value, 'gene');
    case 'drug_class':
      return label(strings.chipPrefixDrugClass, drugClassLabel(entry.value), 'plain');
    case 'mutation':
      return label(strings.chipPrefixMutation, entry.value, 'gene');
    case 'replicon':
      return label(strings.chipPrefixReplicon, entry.value, 'identifier');
    case 'presence_mob':
      return label(strings.chipPrefixMob, entry.value, 'identifier');
    case 'cluster':
      return label(strings.chipPrefixCluster, entry.value, 'identifier');
    case 'set':
      return label(strings.chipPrefixSet, curatedSetName(manifest, entry.value), 'plain');
    case 'genome_id': {
      const shown = entry.values.slice(0, MAX_LISTED_IDS).join(strings.listSeparator);
      const list = entry.values.length > MAX_LISTED_IDS ? `${shown}${strings.chipListMore}` : shown;
      const value =
        entry.values.length === 1
          ? strings.chipGenomeId(list)
          : strings.chipGenomeIds(formatCount(entry.values.length), list);
      return label(undefined, value, 'plain');
    }
    case 'plasmid_contig':
      return label(undefined, strings.chipPlasmidContig, 'plain');
    case 'prophage':
      return label(undefined, strings.chipProphage, 'plain');
    case 'completeness_min':
      return label(undefined, strings.chipCompleteness(percent(entry.value)), 'plain');
    case 'contamination_max':
      return label(undefined, strings.chipContamination(percent(entry.value)), 'plain');
    case 'year': {
      const { min, max } = entry.value;
      const text =
        min !== undefined && max !== undefined
          ? strings.chipYearRange(min, max)
          : min !== undefined
            ? strings.chipYearFrom(min)
            : strings.chipYearTo(max ?? 0);
      return label(undefined, text, 'plain');
    }
  }
}

/** Utility classes for a value style (requirements §7). */
export function valueClass(style: ValueStyle): string {
  switch (style) {
    case 'species':
      return 'font-serif italic';
    case 'gene':
      return 'font-mono italic';
    case 'identifier':
      return 'font-mono';
    case 'plain':
      return '';
  }
}
