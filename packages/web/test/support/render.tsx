// Renders the application at a path with a given manifest state, without
// fetching (requirements §5.1, §5.3; data contract §6.4).
import { render } from '@testing-library/react';
import { App } from '../../src/App';
import { ManifestContext } from '../../src/data/manifest';
import type { ManifestState } from '../../src/data/manifest';
import { RouterProvider } from '../../src/router';

export function renderApp(path: string, state: ManifestState) {
  window.history.replaceState(null, '', path);
  return render(
    <RouterProvider>
      <ManifestContext value={state}>
        <App />
      </ManifestContext>
    </RouterProvider>,
  );
}
