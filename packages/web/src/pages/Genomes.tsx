// Genome list (requirements §5.3 "the collection table, full page", §6.1
// Controls, §5.2, §5.9, §5.10; checklist C5, G11). The collection page's
// genome table (collection/GenomeTablePanel.tsx and its data hooks) on a page
// of its own, for the current set: sorting, paging by 50, the column chooser,
// row selection with "Use as set" after a confirmation, and the same links
// (genome identifiers to their genome page keeping the set, species and STs
// to the collection filtered by them). The table export menu is shown at all
// times, since the panel already spans the page. There is no facet rail and
// no drawer; filters are changed from the set bar. An empty set never
// reaches this page: the shell shows the empty-set message instead (§5.2).
import { GenomeTablePanel } from './collection/GenomeTablePanel';
import { strings } from '../strings';

export function Genomes() {
  return (
    <div className="flex min-w-0 grow flex-col gap-panel-gap px-page-padding-x py-page-padding-y">
      <h1 className="sr-only">{strings.pageGenomes}</h1>
      <GenomeTablePanel />
    </div>
  );
}
