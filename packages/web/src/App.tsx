// The application: the manifest gate (data contract §2), then the shell
// (requirements §5.1) with the page for the current route (§5.3). Routes of
// optional products the release does not include show the absence statement
// (§5.7); unknown routes show the not-found statement (§6.11).
import { AbsentProduct } from './components/AbsentProduct';
import { MainPlaceholder } from './components/MainPlaceholder';
import { ManifestNotice } from './components/ManifestNotice';
import { NotFound } from './components/NotFound';
import { PageStatement } from './components/PageStatement';
import { Shell } from './components/Shell';
import { useManifestState } from './data/manifest';
import { hasProduct, pageTitle, productOfRoute } from './navigation';
import { useRouter } from './router';
import { strings } from './strings';

function RoutePage() {
  const { route, pathname } = useRouter();
  const state = useManifestState();
  if (route.page === 'notFound') return <NotFound />;
  const product = productOfRoute(route);
  if (product !== undefined) {
    if (state.status !== 'ready')
      return <PageStatement title={pageTitle(pathname)} statement={undefined} />;
    if (!hasProduct(state.manifest, product)) {
      return <AbsentProduct product={product} releaseId={state.manifest.release_id} />;
    }
  }
  return <MainPlaceholder />;
}

export function App() {
  const state = useManifestState();
  if (state.status === 'mismatch') {
    return <ManifestNotice statement={strings.schemaMismatch(state.schemaVersion, state.range)} />;
  }
  if (state.status === 'unavailable') {
    return <ManifestNotice statement={strings.manifestUnavailable} />;
  }
  return (
    <Shell>
      <RoutePage />
    </Shell>
  );
}
