// Main area placeholder (milestone 0). Names the page for the current route
// (requirements §5.3) and states that it arrives in a later milestone.
import { pageTitle } from '../navigation';
import { useRouter } from '../router';
import { strings } from '../strings';
import { PageStatement } from './PageStatement';

export function MainPlaceholder() {
  const { pathname } = useRouter();
  return <PageStatement title={pageTitle(pathname)} statement={strings.placeholderStatement} />;
}
