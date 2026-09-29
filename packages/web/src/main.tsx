// Application entry. Milestone 0 renders the placeholder shell (requirements
// §5.1); routing and the manifest arrive in milestone 1b.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MainPlaceholder } from './components/MainPlaceholder';
import { Shell } from './components/Shell';
import { DatabaseContext, openDatabase } from './data/database';
import { strings } from './strings';
import './index.css';

document.title = strings.wordmark;

const container = document.getElementById('root');
if (container === null) throw new Error('missing #root element');

const pathname = window.location.pathname;

createRoot(container).render(
  <StrictMode>
    <DatabaseContext value={openDatabase}>
      <Shell pathname={pathname}>
        <MainPlaceholder pathname={pathname} />
      </Shell>
    </DatabaseContext>
  </StrictMode>,
);
