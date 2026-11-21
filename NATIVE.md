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

- `PGF.version`: the core's version string (the web build's).
- `PGF.chartStyle({ base, vector })`: the MapLibre style JSON. `base` is 'light' | 'terrain' |
  'street'. `vector` is OpenFreeMap's style JSON (fetched by the app, or null). The data sources are
  empty GeoJSON sources, filled by `chartData`. Symbol images (aerodromes, navaids, VFR points, route
  arrows) are drawn by the app under the names the style uses, listed in `PGF.symbolNames()`.
- `PGF.chartData({ ref, flight, notams, layers })`: `{ [sourceId]: FeatureCollection }` for every data
  source of the style. `ref` is GET /api/ref/bundle; `flight` is GET /api/flights/:id; `notams` is the
  briefing or null; `layers` is the flight's map layers.
- `PGF.weatherRequests({ flight })`: the API paths the app fetches for the flight's weather (winds aloft
  and surface, METAR/TAF), as the website's useFlightWeather does. Their answers go to `computeFlight`.
- `PGF.computeFlight({ flight, aircraft, pilot, ref, weather })`: `{ legs, navlog, fuel, wb, warnings,
  readiness, times }`, as the website's editor computes them. The readiness rows are the "Ready to fly"
  model of the Plan and Brief stages. The paperwork rows come from `PGF.paperwork`.
- `PGF.paperwork({ filing, forms, declarations })`: the File & forms rows.
- `PGF.progress({ flight, computed, position })`: where the aircraft is along the route. `position` is
  `{ lat, lon, altFt?, trackDeg?, gsKt?, time }`. It returns `{ legIndex, toWaypoint, distNm, bearingDeg,
  crossTrackNm, eteMin, eta, plannedAltFt, plannedHdg, freq, nextFreq, offRoute }`. The active leg is the
  nearest leg ahead along the route, so legs advance as waypoints are passed.

## Offline

On opening a flight with a connection, the app saves to its container: the flight, the aircraft, the
pilot, `ref`, the weather answers and the NOTAM briefing. It also downloads an MLNOfflineStorage pack:
the route's bounding box plus 15 NM, zooms 6–11, for the base style. Fly mode works from these with no
connection.

## Release

Same bundle id (com.pigsgottafly.app) and App Store Connect record (6837510399) as before. The native app
replaces the Capacitor shell in `ios/`.
