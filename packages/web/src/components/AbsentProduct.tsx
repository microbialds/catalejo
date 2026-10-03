// Page of an optional product the release does not include (requirements
// §5.7, checklist G7): the page name, the statement "No <product> is included
// in release <id>." and the Methods link, never an error or an empty chart.
import { absentProductStatement, methodsHref, pageTitle } from '../navigation';
import type { Product } from '../navigation';
import { useRouter } from '../router';
import { strings } from '../strings';
import { Link } from './Link';
import { PageStatement } from './PageStatement';

export function AbsentProduct({ product, releaseId }: { product: Product; releaseId: string }) {
  const { pathname } = useRouter();
  return (
    <PageStatement
      title={pageTitle(pathname)}
      statement={absentProductStatement(product, releaseId)}
    >
      <Link to={methodsHref} className="self-start">
        {strings.absentMethodsLink}
      </Link>
    </PageStatement>
  );
}
