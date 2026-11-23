// The native iPhone app's core (NATIVE.md "core.js API"): the website's computations behind one
// global, PGF, that the app runs in JavaScriptCore. Built into native/ios/PigsGottaFly/Resources/core.js
// by `npm run native:core` (tools/build_native_core.ts). Unit-tested in tests/unit/native/.
//
// Every function takes one argument, an object or its JSON text, and returns a plain object that
// JSON.stringify turns into its JSON (NaN and ±Infinity become null). Pure and synchronous: no DOM,
// no fetch, no timers; JavaScriptCore has only the ECMAScript globals (and Intl). The app fetches
// what weatherRequests lists and hands the answers to computeFlight.

// JavaScriptCore has no Web Crypto; the website's uid() (new route points, ATC rows) draws from it.
// Those ids only tell rows apart, so Math.random is enough.
const g = globalThis as { crypto?: { getRandomValues?: <T extends ArrayBufferView>(a: T) => T } };
if (typeof g.crypto?.getRandomValues !== 'function')
  g.crypto = {
    getRandomValues: <T extends ArrayBufferView>(a: T): T => {
      const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
      for (let k = 0; k < bytes.length; k++) bytes[k] = Math.floor(Math.random() * 256);
      return a;
    },
  };

export { brief } from './brief';
export { chartData, chartStyle, layerGroups, lineStyles, symbolNames } from './chart';
export { briefingModel, formModel, fplMessage, navlogContent, wbPerfContent } from './exports';
export { filingDelay, filingError, filingView } from './filing';
export { computeFlight, type ComputeFlightInput, fromBase64, paperwork, setTerrain, weatherRequests } from './flight';
export { declarationText, form731Panel, genDecPanel, operatorPanel } from './forms';
export { aircraftFromTemplate, aircraftHelpers, aircraftTemplates, historyText, validateAircraft } from './hangar';
export { cgToMoment, manifest, shareSuggestions, wbChart } from './manifest';
export { drawBand, mapInfo, mapLayers, pointMenu, routeFeatures, waypointName } from './map';
export { parseCoords, parseTyped, personIssues } from './people';
export {
  focusSections,
  focusTarget,
  fplOptions,
  fuelLoad,
  localFlight,
  readinessStages,
  regenerateAtc,
  requests,
  routeEdit,
  routeInfo,
  setRequest,
  snap,
} from './plan';
export { fuelEdit, setAircraft } from './planEdits';
export { progress } from './progress';
export { type CoreRef, version } from './shared';
