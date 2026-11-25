import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { applyStoredTheme } from './lib/theme';
import { registerUpdates } from './pwa/registerUpdates';
import './styles/tokens.css';
import './styles/app.css';

applyStoredTheme();
registerUpdates();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Missing #root element');

createRoot(rootEl).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
