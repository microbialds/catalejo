// Annotation version warning (requirements §5.6): shown on every prevalence
// chart and on the resistance heatmap when the species of the current set
// carry more than one Bakta or AMRFinderPlus database version, with the
// versions involved and a link to the Methods page. The versions come from
// data/annotationVersions.ts; this component only states them.
import type { AnnotationVersionWarning } from '../data/annotationVersions';
import { methodsHref } from '../navigation';
import { strings } from '../strings';
import { Link } from './Link';

export function AnnotationVersionNote({ warning }: { warning: AnnotationVersionWarning | null }) {
  if (warning === null) return null;
  const list = (versions: string[]) =>
    versions.length === 0 ? strings.valuePending : versions.join(strings.listSeparator);
  return (
    <p role="note" className="text-small text-text-secondary">
      {strings.annotationVersionWarning(list(warning.bakta), list(warning.amrfinderplus))}{' '}
      <Link to={methodsHref} className="no-underline">
        {strings.annotationVersionMethods}
      </Link>
    </p>
  );
}
