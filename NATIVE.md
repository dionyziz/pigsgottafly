# The native iPhone app

The iPhone app is native (Swift, SwiftUI, MapLibre Native), designed for what a pilot does with a phone:
fly the route, check the flight on the morning of the flight, and make small changes. Planning at a desk
stays on the website. The iPad keeps the website's editor, because the iPad has room for it.

The app and the website are maintained together. **Everything computed comes from one TypeScript source.**
The flight's numbers, the chart's style and features, the checklist and progress along the route are
built into `core.js` from `src/native/core.ts` (which reuses src/calc, src/shared, src/data,
src/features/editor/map/{style,features,airspace,labels}.ts and the panels' pure models). The app runs
`core.js` in JavaScriptCore. The website and the app therefore show the same numbers and draw the same
chart. The app calls the same API at https://pigsgottafly.com/api.

```
native/ios/                    the app (XcodeGen: project.yml → PigsGottaFly.xcodeproj, generated, not committed)
  PigsGottaFly/                Swift sources
  PigsGottaFly/Resources/core.js   built by `npm run native:core` (committed, so Xcode needs no Node)
src/native/core.ts             the core's API (below); unit-tested in tests/unit/native/
```

## Screens (iPhone)

- **Flights**: the pilot's flights and the ones shared with them (GET /api/flights), with date, route, the
  readiness summary and the filing status. Pull to refresh. "Fly again" (POST /flights/:id/copy).
- **A flight**: three tabs.
  - **Fly**: a full-screen moving map. It shows the chart (the same style and layers as the website),
    the route with the active leg, the own aircraft from GPS with its track line, and a top strip with
    the next waypoint, bearing, distance, ETE and ETA, groundspeed and the leg's planned altitude and
    heading. The bottom strip shows the current leg's frequency and the next one. Track up or north up;
    re-centre. The screen stays on. It works offline: the flight, reference data, weather and map tiles
    for the route are saved when the flight is opened with a connection.
  - **Brief**: the "Ready to fly" checklist; METAR and TAF for the route's aerodromes; the relevant
    NOTAMs (departure, destination, airspace); aerodrome hours and sunset; the filing status. Native
    lists. The forms (filing, Form 731, GenDec, W&B) open the website's File & forms page in an in-app
    browser.
  - **Navlog**: the legs as a native list (altitude, heading, distance, ETE, ETA, fuel), the totals.
    Quick edits: date, block-off time, a leg's altitude (PUT the flight with the version).
- **Account**: sign in with Apple's sign-in sheet on /app-login (Google or Apple ID) → one-time code →
  GET /api/app-session?code=… with URLSession, which keeps the session cookie (HTTPCookieStorage). Sign
  out; delete account (Profile on the website).

## core.js API (global `PGF`, JSON in and out, synchronous)

`core.js` is an IIFE that sets `globalThis.PGF` (ES2020, minified, about 470 KB with the reference
data the API does not serve). It needs only the ECMAScript globals: no `window`, `document`, `fetch`,
timers, `console`, `URL` or `atob` (tests/unit/native/bundle.test.ts runs it so). Every function takes
one argument, an object or its JSON text, and returns a plain object: `JSON.stringify(PGF.f(json))` is
its JSON (NaN and ±Infinity become null). Times are epoch milliseconds. The optional arguments and the
extra fields below were added while building the core.

- `PGF.version`: package.json's version and a hash of the bundle, e.g. `1.0.0+3f2a9c0d1b2e`.
- `PGF.chartStyle({ base, vector, layers? })`: the MapLibre style JSON. `base` is 'light' | 'terrain' |
  'street'. `vector` is OpenFreeMap's style JSON (fetched by the app, or null: OSM raster tiles stand
  in, as on the website). The data sources are empty GeoJSON sources, filled by `chartData`. It is the
  website's style (`buildStyle`, the same layer ids) plus the NOTAM areas (source `notam-areas`, layers
  `notam-fill` and `notam-line` under the route), which the website adds at run time. `layers` (the
  flight's map layers; default all on) sets the layers' visibility as the website's layer toggles do;
  `PGF.layerGroups()` lists the layer ids of each toggle, to change visibility without a new style.
  Airspaces more than 10 NM from the route are drawn faint through their `far` property (set by
  `chartData`; the website uses a feature state). Symbol images (aerodromes, navaids, VFR points,
  arrows, the restricted-area hatching) are drawn by the app under the names the style uses, listed in
  `PGF.symbolNames()` as `[{ name, size, colors, rotates, pattern, description }]` (size in points,
  drawn at pixel ratio 2; colours are CHART keys of src/features/editor/map/style.ts; `rotates`: the
  layer rotates the icon; `pattern`: a fill-pattern tile).
- `PGF.chartData({ ref, flight, notams, layers, waypoints?, now? })`: `{ [sourceId]: FeatureCollection }`
  for every data source of the style: the collections the website's map sets. `ref` is GET
  /api/ref/bundle; `flight` is GET /api/flights/:id; `notams` is the briefing or null (its relevant
  NOTAMs with an area are drawn); `layers` is the flight's map layers (the ENR 5 area toggles filter the
  `areas` source, as on the website); `waypoints` is GET /api/waypoints (the pilot's saved points). The
  editing sources (`route-band`, `snap`, `leg-focus`, `air-focus`) are empty; `route-mid` holds the
  website's leg midpoint handles (hide its layer when not editing).
- `ref`, wherever it is taken, is GET /api/ref/bundle. The core supplies what the bundle lacks (the
  CTRs and ATZs, the FIR, the navaids and the sunset tables: the website ships them with its code). A
  call may leave `ref` out after the first one: the last one given is used.
- `PGF.setTerrain({ base64 })` (or the base64 text alone): the terrain grid,
  https://pigsgottafly.com/terrain/greece.bin in base64, kept for the following `computeFlight` calls
  (the default altitude of uncharted legs and the low-leg warnings use it, as on the website).
  `{ base64: null }` forgets it. Returns `{ ok }`.
- `PGF.weatherRequests({ flight, ref, now? })`: the GET paths on https://pigsgottafly.com (they start
  with `/api/`) the app fetches for the flight's weather, as the website's editor does: winds aloft and
  surface forecast (`/api/weather/grid?kind=wind…`), the hazard data along the route (`kind=hazard`)
  and METAR/TAF (`/api/weather/metar?ids=…`). It needs `ref` (which aerodromes the route's ends are).
  There are no grid paths for a date beyond the forecast. Their answers go to `computeFlight`.
- `PGF.computeFlight({ flight, aircraft, pilot, ref, weather, notams?, notamsRead?, now? })`, as the
  website's editor computes it. `weather` is `{ [path]: answer }` for the paths of `weatherRequests` (a
  path missing or null: not fetched, as when offline; `weather` in the result says so). `aircraft` is
  the flight's (a shared flight's comes with the flight); `pilot` is GET /api/me (a shared flight is
  computed with its owner's settings). `notams` is the briefing (aerodrome hours and the NOTAMs row)
  and `notamsRead` whether its relevant NOTAMs were read. It returns `{ version, legs, altitudesFt,
  navlog, fuel, wb, wbOk, wbMissingWeights, warnings, readiness, times, departure, arrival, stops,
  crewErrors, hazards, aerodromeChecks, weather, atc }`: `legs` are the leg geometries with `altFt` and
  `altSource`; `navlog`, `fuel` and `wb` are the src/calc results (NavlogResult, FuelPlan, WbResult);
  `warnings` the editor's `{ level, area, text, leg? }`; `readiness` the "Ready to fly" rows of the Plan
  and Brief stages (`{ id, stage, state, label, text, section, warning }`; the File & forms rows come
  from `PGF.paperwork`); `times` the block-off, take-off, landing and block-on times in minutes after
  00:00 UTC and in epoch ms (null without a block-off time), the sunset and the ETE; `departure`,
  `arrival` and `stops` the take-off and landing performance; `weather` the status of the winds, the
  hazards and METAR/TAF (with the decoded reports); `atc` the flight's ATC list and what `progress`
  needs of it.
- `PGF.paperwork({ filing, forms, declarations })`: the File & forms rows (GET
  /api/flights/:id/filing, /forms, /declarations), in the readiness rows' shape.
- `PGF.progress({ flight, computed, position, lastLegIndex? })`: where the aircraft is along the route.
  `computed` is `computeFlight`'s answer (no `ref` needed: it runs on every GPS fix). `position` is
  `{ lat, lon, altFt?, trackDeg?, gsKt?, time }` (`time` in epoch ms or ISO). It returns `{ legIndex,
  toWaypoint, distNm, bearingDeg, crossTrackNm, eteMin, eta, plannedAltFt, plannedHdg, freq, nextFreq,
  offRoute }` and also `bearingMagDeg`, `legFraction`, `gsKt`, `gsSource` ('gps' | 'navlog'),
  `remainingNm`, `eteDestMin`, `etaDest`, `plannedCh` and `arrived` (past the last waypoint).
  `toWaypoint` is `{ index, name, lat, lon, uid }`; `bearingDeg` is true; `crossTrackNm` is positive
  right of the course; `eta` is epoch ms; `plannedHdg` is the navlog's magnetic heading (MH).
  `freq`/`nextFreq` are `{ callsign, service, primary, backups, group }` from the flight's ATC list (the
  website's ATC section): the aerodrome's unit (tower first) within its zone (the departure's and the
  destination's within 10 NM), else the TMA the aircraft is in, else the FIS sector's; `nextFreq` is
  the first different one ahead along the route. The active leg is the leg nearest the aircraft, or the
  next one once the aircraft is past 90% of it, so legs advance as waypoints are passed; a leg flown
  against the track counts as far, which tells the two directions of an out-and-back (or two legs over
  the same ground) apart. Without a track the earlier leg wins: pass the leg shown last as
  `lastLegIndex` (earlier legs are then not gone back to). The GPS groundspeed gives the ETE from 30 kt;
  below that, the navlog's GS. `offRoute` is more than 2 NM off the leg.

## Offline

On opening a flight with a connection, the app saves to its container: the flight, the aircraft, the
pilot, `ref`, the weather answers, the NOTAM briefing and the terrain grid. It also downloads an
MLNOfflineStorage pack: the route's bounding box plus 15 NM, zooms 6–11, for the base style. Fly mode
works from these with no connection.

## Release

Same bundle id (com.pigsgottafly.app) and App Store Connect record (6837510399) as before. The native app
replaces the Capacitor shell in `ios/`.
