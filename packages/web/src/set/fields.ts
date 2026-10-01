// Presentation of the filter fields (requirements §5.2; data contract §7.5):
// the menu label of each field, whether the release can evaluate it (from
// the manifest alone, so the menu renders before the engine starts), and the
// label of each chip, with the labels of the controlled vocabularies (source
// type, platform, assembly status) and the short forms used in the
// collection charts. Species names are set in italic sans, gene, element
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

const DRUG_CLASS_SHORT: Readonly<Record<string, string>> = {
  carbapenem: strings.drugClassShortCarbapenem,
  beta_lactam: strings.drugClassShortBetaLactam,
  aminoglycoside: strings.drugClassShortAminoglycoside,
  quinolone: strings.drugClassShortQuinolone,
  colistin: strings.drugClassShortColistin,
  tetracycline: strings.drugClassShortTetracycline,
  sulfonamide: strings.drugClassShortSulfonamide,
  trimethoprim: strings.drugClassShortTrimethoprim,
  phenicol: strings.drugClassShortPhenicol,
  macrolide: strings.drugClassShortMacrolide,
  fosfomycin: strings.drugClassShortFosfomycin,
  glycopeptide: strings.drugClassShortGlycopeptide,
  rifamycin: strings.drugClassShortRifamycin,
  other: strings.drugClassShortOther,
};

/** The short label of a drug class key, for heatmap columns. */
export function drugClassShortLabel(key: string): string {
  return DRUG_CLASS_SHORT[key] ?? drugClassLabel(key);
}

/** The palette order of a drug class key; unknown keys sort last. */
export function drugClassOrder(key: string): number {
  const index = palette.drug_classes.findIndex((drugClass) => drugClass.key === key);
  return index < 0 ? palette.drug_classes.length : index;
}

// Labels of the controlled vocabularies of contract §4.2 and §5.2; a value
// outside them is shown as written.
const VOCABULARY: Partial<Record<FilterKey, Readonly<Record<string, string>>>> = {
  source_type: {
    clinical: strings.sourceTypeClinical,
    environmental: strings.sourceTypeEnvironmental,
    food: strings.sourceTypeFood,
    animal: strings.sourceTypeAnimal,
    other: strings.sourceTypeOther,
  },
  platform: {
    illumina: strings.platformIllumina,
    ont: strings.platformOnt,
    pacbio: strings.platformPacbio,
    hybrid: strings.platformHybrid,
  },
  assembly_status: {
    complete: strings.assemblyStatusComplete,
    draft: strings.assemblyStatusDraft,
  },
};

/** The label of a value of source type, platform or assembly status. */
export function vocabularyLabel(key: FilterKey, value: string): string {
  return VOCABULARY[key]?.[value] ?? value;
}

/**
 * A species name with the genus abbreviated, as the collection board sets it
 * in charts and tables: "Klebsiella pneumoniae" becomes "K. pneumoniae". A
 * name of one word, or one already abbreviated, is returned as given.
 */
export function shortSpeciesName(name: string): string {
  const words = name.trim().split(/\s+/);
  const [genus, ...rest] = words;
  if (genus === undefined || rest.length === 0 || genus.endsWith('.')) return name;
  return `${genus.charAt(0)}. ${rest.join(' ')}`;
}

/** The canonical species name of a code, or the code itself. */
export function speciesName(manifest: Manifest | undefined, code: string): string {
  return manifest?.species.find((species) => species.species_code === code)?.canonical_name ?? code;
}

/** The name of a curated set, or its identifier. */
export function curatedSetName(manifest: Manifest | undefined, setId: string): string {
  return manifest?.curated_sets.find((set) => set.set_id === setId)?.name ?? setId;
}

/** How a value is set: species italic sans, genes italic monospace, ids monospace. */
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
      return label(strings.chipPrefixSourceType, vocabularyLabel(entry.key, entry.value), 'plain');
    case 'country':
      return label(strings.chipPrefixCountry, entry.value, 'plain');
    case 'platform':
      return label(strings.chipPrefixPlatform, vocabularyLabel(entry.key, entry.value), 'plain');
    case 'assembly_status':
      return label(
        strings.chipPrefixAssemblyStatus,
        vocabularyLabel(entry.key, entry.value),
        'plain',
      );
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
      const count = entry.values.length;
      return label(undefined, strings.chipGenomeIds(formatCount(count), count, list), 'plain');
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
          ? min === max
            ? strings.chipYear(min)
            : strings.chipYearRange(min, max)
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
      return 'font-sans italic';
    case 'gene':
      return 'font-mono italic';
    case 'identifier':
      return 'font-mono';
    case 'plain':
      return '';
  }
}
