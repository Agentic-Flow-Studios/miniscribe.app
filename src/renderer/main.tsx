import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import './fonts.css';
// Pre-built theme artifacts, generated from theme/neutralTheme.ts by
// `npx astryx theme build`. Re-run that after editing the source theme.
import './theme/neutral.css';

import { createRoot } from 'react-dom/client';
import { Theme } from '@astryxdesign/core';
import { neutralTheme } from './theme/neutral';
import { App } from './App';

// No StrictMode: its double-invoked effects would open the capture graph twice.
createRoot(document.getElementById('root')!).render(
  <Theme theme={neutralTheme}>
    <App />
  </Theme>,
);
