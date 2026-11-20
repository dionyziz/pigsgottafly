import 'maplibre-gl/dist/maplibre-gl.css';
import './app/styles.css';
import './ui/ui.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App';
import { installErrorReporting } from './app/errorReporter';
import { installNativeShell } from './app/native';
import { installStaleBuildReload } from './app/staleBuild';

installStaleBuildReload();
installErrorReporting();
installNativeShell();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
