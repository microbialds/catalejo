// Application entry (requirements §5.1, §5.3; data contract §2, §6.4). The
// router follows the History API, the manifest loads once from /data/, and
// pages open the database on demand through DatabaseContext.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { DatabaseContext, openDatabase } from './data/database';
import { ManifestProvider } from './data/manifest';
import { RouterProvider } from './router';
import { strings } from './strings';
import './index.css';

document.title = strings.wordmark;

const container = document.getElementById('root');
if (container === null) throw new Error('missing #root element');

createRoot(container).render(
  <StrictMode>
    <DatabaseContext value={openDatabase}>
      <RouterProvider>
        <ManifestProvider>
          <App />
        </ManifestProvider>
      </RouterProvider>
    </DatabaseContext>
  </StrictMode>,
);
