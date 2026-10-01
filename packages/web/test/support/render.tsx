// Renders the application at a path with a given manifest state, without
// fetching and without DuckDB: the set engine is a stub (requirements §5.1,
// §5.3; data contract §6.4).
import { render } from '@testing-library/react';
import { App } from '../../src/App';
import { ManifestContext } from '../../src/data/manifest';
import type { ManifestState } from '../../src/data/manifest';
import type { SetEngine } from '../../src/data/setEngine';
import { SetEngineContext } from '../../src/data/setEngineContext';
import { RouterProvider } from '../../src/router';
import { stubEngine, stubFactory } from './engine';

export function renderApp(path: string, state: ManifestState, engine: SetEngine = stubEngine()) {
  window.history.replaceState(null, '', path);
  const factory = stubFactory(engine);
  return render(
    <RouterProvider>
      <ManifestContext value={state}>
        <SetEngineContext value={factory}>
          <App />
        </SetEngineContext>
      </ManifestContext>
    </RouterProvider>,
  );
}
