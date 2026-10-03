// Unknown route (requirements §6.11). A plain statement with a link to the
// collection; the not-found page with the global search arrives in milestone 2.
import { strings } from '../strings';
import { Link } from './Link';
import { PageStatement } from './PageStatement';

export function NotFound() {
  return (
    <PageStatement title={strings.notFoundTitle} statement={strings.notFoundStatement}>
      <Link to="/" className="self-start">
        {strings.notFoundCollectionLink}
      </Link>
    </PageStatement>
  );
}
