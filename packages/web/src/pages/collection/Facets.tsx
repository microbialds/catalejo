// Facet rail of the collection page (requirements §6.1 Layout and Controls,
// §5.6; checklist C2, C4, G13; collection board, left rail). Species (with
// swatch, italic serif names), source, mobile elements (plasmid contig,
// prophage region), AMR class (palette order, the first few with "All N
// classes" to expand), platform and assembly status. Each row shows the
// genomes of the current set with the value; checking it adds the filter and
// unchecking it removes it. The AMR class facet carries the annotation
// version note when the set mixes database versions.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { collectionFacets } from '../../collection/facets';
import type { CollectionFacets, FacetValue } from '../../collection/facets';
import { AnnotationVersionNote } from '../../components/AnnotationVersionNote';
import { Button } from '../../components/Button';
import { FacetGroup, FacetOption } from '../../components/FacetGroup';
import { SpeciesName, Swatch } from '../../components/Species';
import type { AnnotationVersionWarning } from '../../data/annotationVersions';
import type { MobileCounts, SetSummary } from '../../data/setEngine';
import { drugClassLabel, vocabularyLabel } from '../../set/fields';
import type { ListKey } from '../../set/filters';
import { useGenomeSet } from '../../set/store';
import { strings } from '../../strings';

/** AMR classes listed before "All N classes". */
export const AMR_CLASSES_SHOWN = 5;

function ListFacet({
  label,
  field,
  values,
  text,
}: {
  label: string;
  field: ListKey;
  values: FacetValue[];
  text: (value: string) => string;
}) {
  const { filters, addValue, removeValue } = useGenomeSet();
  const active = new Set(filters[field] ?? []);
  if (values.length === 0) return null;
  return (
    <FacetGroup label={label}>
      {values.map((value) => (
        <FacetOption
          key={value.value}
          checked={active.has(value.value)}
          onToggle={(on) => {
            if (on) addValue(field, value.value);
            else removeValue(field, value.value);
          }}
          label={text(value.value)}
          name={text(value.value)}
          count={value.count}
        />
      ))}
    </FacetGroup>
  );
}

export interface FacetsProps {
  release: SetSummary | undefined;
  summary: SetSummary | undefined;
  mobile: MobileCounts | undefined;
  /** Counts of the set are being recomputed; the previous ones stay shown. */
  pending: boolean;
  warning: AnnotationVersionWarning | null;
}

export function Facets({ release, summary, mobile, pending, warning }: FacetsProps) {
  const { filters, addValue, removeValue, setKey } = useGenomeSet();
  const [allClasses, setAllClasses] = useState(false);
  const facets: CollectionFacets | undefined =
    release !== undefined && summary !== undefined ? collectionFacets(release, summary) : undefined;
  const species = new Set(filters.species_code ?? []);
  const classes = new Set(filters.drug_class ?? []);

  let content: ReactNode = (
    <p className="text-control text-text-secondary">{strings.panelLoading}</p>
  );
  if (facets !== undefined) {
    const shownClasses = allClasses
      ? facets.drugClass
      : facets.drugClass.slice(0, AMR_CLASSES_SHOWN);
    content = (
      <>
        <FacetGroup label={strings.facetSpecies}>
          {facets.species.map((value) => (
            <FacetOption
              key={value.value}
              checked={species.has(value.value)}
              onToggle={(on) => {
                if (on) addValue('species_code', value.value);
                else removeValue('species_code', value.value);
              }}
              mark={<Swatch color={value.color} />}
              label={<SpeciesName name={value.name} short className="text-base" />}
              name={value.name}
              count={value.count}
            />
          ))}
        </FacetGroup>
        <ListFacet
          label={strings.facetSource}
          field="source_type"
          values={facets.sourceType}
          text={(value) => vocabularyLabel('source_type', value)}
        />
        <FacetGroup label={strings.facetMobile}>
          <FacetOption
            checked={filters.plasmid_contig === true}
            onToggle={(on) => {
              setKey('plasmid_contig', on ? true : undefined);
            }}
            label={strings.facetPlasmidContig}
            name={strings.facetPlasmidContig}
            count={mobile?.plasmidContig}
          />
          <FacetOption
            checked={filters.prophage === true}
            onToggle={(on) => {
              setKey('prophage', on ? true : undefined);
            }}
            label={strings.facetProphage}
            name={strings.facetProphage}
            count={mobile?.prophage}
          />
        </FacetGroup>
        {facets.drugClass.length > 0 && (
          <FacetGroup label={strings.facetAmrClass}>
            {shownClasses.map((value) => (
              <FacetOption
                key={value.value}
                checked={classes.has(value.value)}
                onToggle={(on) => {
                  if (on) addValue('drug_class', value.value);
                  else removeValue('drug_class', value.value);
                }}
                label={drugClassLabel(value.value)}
                name={drugClassLabel(value.value)}
                count={value.count}
              />
            ))}
            {facets.drugClass.length > AMR_CLASSES_SHOWN && (
              <Button
                variant="link"
                className="self-start"
                aria-expanded={allClasses}
                onClick={() => {
                  setAllClasses(!allClasses);
                }}
              >
                {allClasses
                  ? strings.facetFewerClasses
                  : strings.facetAllClasses(facets.drugClass.length)}
              </Button>
            )}
            <AnnotationVersionNote warning={warning} />
          </FacetGroup>
        )}
        <ListFacet
          label={strings.facetPlatform}
          field="platform"
          values={facets.platform}
          text={(value) => vocabularyLabel('platform', value)}
        />
        <ListFacet
          label={strings.facetAssemblyStatus}
          field="assembly_status"
          values={facets.assemblyStatus}
          text={(value) => vocabularyLabel('assembly_status', value)}
        />
      </>
    );
  }
  return (
    <div aria-busy={pending} className="flex flex-col gap-4.5 px-4.5 py-4">
      {content}
    </div>
  );
}
