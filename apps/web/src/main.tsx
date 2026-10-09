import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { referenceProfile } from '@orca-solutions/get-fit-core';
import { getProfile, setDefaultProfile, startAutoSync } from '@orca-solutions/get-fit-core/client';
import { registerUpdates } from './lib/update';
import './styles.css';

// This app is the author's own: a new device starts from that setup rather than the neutral one.
setDefaultProfile(referenceProfile);
registerUpdates();

async function boot() {
  // Ask iOS/Chrome not to evict our data. Home-screen apps are exempt anyway; this is belt and braces.
  navigator.storage?.persist?.().catch(() => {});
  // Render straight away: syncing and planning run from App, so weak signal or a planning error never
  // leaves a blank screen.
  await getProfile().catch(() => {});
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
  startAutoSync();
}

boot();
