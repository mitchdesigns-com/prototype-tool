import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { App } from './App';
import { DEMO } from './lib/runtime';
import './index.css';

// GitHub Pages can't rewrite deep links to index.html, so the demo uses #/ routes.
const Router = DEMO ? HashRouter : BrowserRouter;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router>
      <App />
    </Router>
  </StrictMode>,
);
