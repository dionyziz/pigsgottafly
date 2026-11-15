// MapLibre GL (6.x, ES modules) with its worker. The library finds its worker next to its own module
// (import.meta.url), which does not hold once Vite bundles it into a hashed asset; the worker
// (a self-contained module) is emitted as an asset of its own and its URL set here. Every map imports
// maplibregl from this module, not from 'maplibre-gl'.
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

maplibregl.setWorkerUrl(workerUrl);

export { maplibregl };
