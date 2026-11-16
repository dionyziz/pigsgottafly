import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'maplibre-gl/dist/maplibre-gl.css';
import './app/styles.css';
import { App } from './app/App';
import { installStaleBuildReload } from './app/staleBuild';
import { installErrorReporting } from './app/errorReporter';

installStaleBuildReload();
installErrorReporting();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
