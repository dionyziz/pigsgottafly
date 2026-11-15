# Architecture (v3)

The design is in PLAN-v3.md. This file covers how the code is laid out, the contracts between its parts, and who owns what while agents work on it in parallel.

## Stack

- **Client**: TypeScript, Vite, React 18, react-router 6 (BrowserRouter), MapLibre GL 4.
- **API**: one Vercel Node function (`api/index.ts`) that dispatches to a route registry. Postgres runs on Neon (`@neondatabase/serverless`) in production, and on PGlite (`@electric-sql/pglite`) locally and in tests.
- **Tests**: vitest for unit and API tests (in-memory PGlite), plus a dependency-free headless-Chrome CDP harness for end-to-end tests.

## Layout

```
index.html                 Vite entry (→ src/main.tsx)
public/                    icons, manifest, fonts/Inter (copied to dist/ as-is)
src/
  shared/                  THE CONTRACT: domain + API + ref types, constants, type templates
    types.ts               Pilot, Aircraft (FuelSpec, MassBalance, Station/SeatPosition, Envelope,
                           PerformanceTables, Equipment, CompassCard), Passenger, Waypoint, Flight/FlightDoc,
                           RoutePoint, LegOverride, FlightCrew, AtcEntry, FlightOptions, FlightSummary
    ref.ts                 RefAerodrome, RefRunway, RefAirspace, RefFis, RefVfrPoint, RefVfrRoute, RefAtcUnit,
                           RefSunTable, RefBundle, RefAirac
    api.ts                 request/response bodies of every /api route
    constants.ts           DEFAULT_SETTINGS (unset values), SETTING_SUGGESTIONS, profileMissing(), seatLayout(),
                           seatStation(), validateCrew(), EXPORT_KINDS, legKey(), uid(), autoTitle(), emptyFlightDoc()
    templates.ts           aircraft TYPE templates (AFM data, blank airframe): aircraftFromTypeJson(), blankAircraft()
  calc/                    pure calculations (no I/O, no DOM)
    nav.ts                 port of v2 js/nav.js: geodesy, wind triangle, deviation, NOAA sunset, computeLeg, summarize
    wmm.ts                 magneticVariation(lat, lon, date, altFt): STUB (fixed 5°E)
    legs.ts                buildLegs(route, date) → LegGeometry[] (TC, distance, variation, MC)
    altitudes.ts           defaultAltitudes(route, ctx, overrides), vfrRouteBetween, patternAltitudeFt
    navlog.ts              computeNavlog(NavlogInput) → NavlogResult: STUB (throws)
    fuel.ts                planFuel(FuelPlanInput) → FuelPlan: STUB
    wb.ts                  weightAndBalance(WbInput) → WbResult: STUB
    performance.ts         windComponents, pressureAltitudeFt, isaTempC, densityAltitudeFt (done);
                           selectRunway, takeoffDistances, landingDistances, aerodromePerformance: STUBS
    atc.ts                 AtcGenInput / AtcGenOutput types (generator lives in src/data/atc.ts)
    sun.ts                 sunsetMinutes(date, point, tables): AIP GEN 2.7, else NOAA
  data/                    client services
    api.ts                 typed fetch wrappers: api.session/login/logout, api.me, api.aircraft|passengers|waypoints
                           (list/get/create/update/remove), api.flights (list/get/create/update/trash/restore/copy/opened),
                           api.ref, api.weather.metar; ApiRequestError(status, auth, offline)
    flightStore.ts         offline-tolerant flight saving (port of v2 js/store.js): load(id), save(id, doc), onStatus
    weather.ts             Open-Meteo (port of v2 js/weather.js): buildUrl, fetchPoints, sampleAt, sampleSurface,
                           METAR-style formatters, windProviderFromLegs()
    atc.ts                 generateAtcList(AtcGenInput): STUB
    useAsync.ts            small loading hook
    ref/                   reference data shipped with the client (generated JSON) + index.ts typed accessors:
                           AIRAC, AERODROMES, RUNWAYS, AIRSPACES, FIS, VFR_POINTS, VFR_ROUTES, ATC_UNITS, SUN_TABLES,
                           REF (RefBundle), aerodrome(idOrIcao), vfrPoint(id), runwaysOf(id), aerodromeLabel(a)
  app/                     App (router), AuthGate + SignIn (Google Identity Services), session context
                           (useSession/usePilot), Shell/TopBar, AccountMenu, toast, ErrorBoundary, styles.css (tokens)
  features/
    lobby/                 LobbyPage, NewFlightPage
    profile/               ProfilePage (?welcome=1 = first-use onboarding)
    hangar/                HangarPage, AircraftPage
    passengers/            PassengersPage
    waypoints/             WaypointsPage
    editor/                EditorPage (layout), state.tsx (EditorProvider/useEditor: SHARED EDITOR CONTRACT),
                           map/ (MapView), panels/ (FlightPanel, NavlogStrip)
    exports/               ExportPage: /flights/:id/export/:kind
api/
  index.ts                 Vercel entry: restores the path from ?__path=, refuses to run without DATABASE_URL and
                           GOOGLE_CLIENT_ID, runs pending migrations on cold start, then serves
  _lib/app.ts              dispatcher createApi({db, googleClientId, allowedEmails, googleKeys, secureCookie}), configFromEnv
  _lib/http.ts             Route, Ctx, Reply, HttpError, helpers
  _lib/auth.ts             verifyGoogleToken, sessions (hashed tokens), local pilot
  _lib/rows.ts             row ↔ entity mappers, input validation helpers
  _lib/db.ts               connect()/openDb(): Neon or PGlite behind one Db interface (query/exec/transaction/session)
  _lib/migrate.ts          migration runner + MIGRATIONS registry
  _lib/migrations/         001_schema.ts, 002_ref_2609.ts (generated), 003_existing_pilot_data.ts (generated),
                           004_legacy_flights.ts
  _lib/routes/             session.ts, me.ts, aircraft.ts, passengers.ts, waypoints.ts, flights.ts, ref.ts, weather.ts
                           + index.ts (the registry)
server/server.ts           local server: API + dist/ with SPA fallback (npm start / npm run serve)
server/dev.ts              dev server: API + Vite middleware with hot reload (npm run dev)
tools/build_ref.ts         data/aip.js, vfr.js, sun.js → src/data/ref/*.json + migration 002
tools/build_seed.ts        data/aircraft/*.json → migration 003 (one-time hangar/profile of the EXISTING pilot)
data/                      aip.js, vfr.js, sun.js (made by the Python tools from the eAIP; sources for build_ref.ts),
                           aircraft/{reims-f172m,fleet,compass-cards}.json
tests/unit/                vitest: calc/, data/
tests/api/                 vitest: API, auth, migrations (PGlite in memory)
tests/e2e/                 harness.mjs (CDP), oracle.mjs (independent v2 navlog reference), png.mjs, firefox.mjs,
                           smoke.e2e.test.mjs
tests/fixtures/            club-wbp-cases.json: answers of mesogeion-aeroclub.gr/wbp.php, used to cross-check W&B and performance
```

**The v2 client** has been removed from the tree but stays in git history. Copies for reference: `/private/tmp/claude-501/-Users-dionyziz-workspace-aviation-pigsgottafly/3261d83d-0148-481e-af56-405734dd7472/scratchpad/legacy/` holds `js/app.js` (UI, MD4.2 sheet, terminal-information/ATC listing, default altitudes, VFR point naming), `js/nav.js`, `js/weather.js`, `js/store.js`, `js/aircraft.js`, `css/style.css` (the MD4.2 print sheet styles), `index.html`, the v2 API (`api.mjs`, `db.mjs`, `server.mjs`) and the v2 tests (`tests/`).

## Conventions

- **Units**: kg, m (arms), kg·m, L, kt, ft, NM (route), m (runway), °C, hPa. Dates are `YYYY-MM-DD`, clock times are `HH:MM` UTC, and record timestamps are epoch ms.
- **Imports**: `src/shared`, `src/calc`, `api/` and `tools/` use explicit `.js` extensions, because the API runs as Node ESM. `tsconfig.node.json` (NodeNext) enforces this. Client code (`src/app`, `src/features`, `src/data`) uses Bundler resolution: no extensions, and `../shared` works.
- **Nothing pilot-specific is an app default** (pilot correction #1). A new pilot starts with an empty profile (`homeAerodrome: null`, taxi and reserve `null`) and an empty hangar. The app asks for the profile on first use (the onboarding redirect to `/profile?welcome=1`). `SETTING_SUGGESTIONS` are placeholders only. Calculations treat `null` as "not set" and warn. Only the pilot who already existed in production gets his stated values (LGTT, 15/15/60) and SX-ASV/SX-ASG, through one-time migration 003.
- **Route points** always store a name, lat and lon snapshot, plus `kind` and `refId` (aerodrome id, VFR point id `CHART/NAME`, saved waypoint id, or `null` for a custom point). Per-leg overrides are keyed by `legKey(a, b) = "<a.uid>><b.uid>"`, so inserting a point resets only the leg it splits.
- **The manifest** (`FlightDoc.crew`) is saved with the flight and stored in the `flight_crew` table. The PIC is the pilot (`passengerId: null`). `validateCrew` rules: exactly one PIC, one person per seat, seats must exist on the aircraft (`seatLayout(stations)`). Snapshots keep old forms correct.

## Data flow

1. **AuthGate** calls `GET /api/session`. In Google mode without a session it shows the GIS button, then `POST /api/login {credential}`, which sets an HttpOnly cookie. Local mode signs you in as the `local` pilot. Any 401 later dispatches `pgf:unauthorized` and brings the sign-in screen back.
2. **Lobby** calls `GET /api/flights`. "New flight" goes to `/flights/new`, which calls `POST /api/flights {}`; the server fills in the profile defaults: home → home route, taxi times, default aircraft, wind model, PIC on the manifest.
3. **Editor**: `flightStore.load(id)` returns the server copy, or the local copy while offline. `EditorProvider` holds the `FlightDoc`. Every `update(fn)` is an undo step, unless calls share a `coalesce` key within 1.5 s; it also recomputes the summary and calls `flightStore.save()`, which saves to localStorage at once and sends a debounced `PUT {flight, version}`. On 409 our copy wins on top of the server version (last writer wins, as in v2). Derived values come from the context: `legs` (buildLegs), `altitudeDefaults`, `altitudesFt`.
4. **Calculations** run on the client (`src/calc`). Weather comes from Open-Meteo directly from the browser (`src/data/weather.ts`). METAR/TAF come through `GET /api/weather/metar` (data agent).
5. **Exports**: `/flights/:id/export/:kind` loads the flight and renders print-ready A4 pages (`@media print`).

## API routes (all JSON, under /api)

| Method | Path | Notes |
|---|---|---|
| GET | /session | `{authed, mode, googleClientId, pilot}`. No auth needed. |
| POST | /login | `{credential}` (Google ID token). 401 if bad, 403 if not in ALLOWED_EMAILS, 404 in local mode. |
| POST | /logout | Ends this session only. |
| GET, PUT | /me | Profile (`PilotUpdate`; settings are merged). `defaultAircraftId` must be one of your own aircraft. |
| GET, POST | /aircraft | List (by registration); create from `AircraftInput`. 409 on a duplicate registration. |
| GET, PUT, DELETE | /aircraft/:id | PUT merges the top-level fields. Flights referencing a deleted aircraft get `aircraftId: null`. |
| GET, POST | /passengers | List (by name); create. |
| GET, PUT, DELETE | /passengers/:id | Delete keeps manifest snapshots (`passengerId` becomes `null`). |
| GET, POST | /waypoints | Saved custom points (names upper-cased). |
| GET, PUT, DELETE | /waypoints/:id | |
| GET | /flights | `?trash=1` lists the trash. Ordered by GREATEST(updated, opened). |
| POST | /flights | `FlightCreateRequest` (partial doc; optional client `id`). |
| GET | /flights/:id | `Flight` including `crew`. |
| PUT | /flights/:id | `{flight: FlightDoc, version}` returns `{version, updated}`. 409 with the current Flight as the body. 400 on validation errors. |
| DELETE | /flights/:id | Moves to trash. |
| POST | /flights/:id/restore, /copy, /opened | |
| GET | /ref/airac, /ref/bundle, /ref/{aerodromes,runways,airspaces,fis,vfr-points,vfr-routes,atc-units} | Current AIRAC, read-only. |
| GET | /weather/metar?ids=… | STUB 501 (data agent). |

Tenancy: every query includes `pilot_id = <session pilot>`. Another pilot's record answers 404. References between owned rows are composite `(id, pilot_id)` foreign keys (flights → aircraft, flight_crew → passengers, pilots.default_aircraft_id → aircraft), so the database itself prevents cross-pilot references. `tests/api/api.test.ts` checks isolation for every entity.

**Adding a route**: add it to the module that owns it (e.g. `api/_lib/routes/weather.ts` exports `routes: Route[]`). Every module is already listed in `routes/index.ts`, so the dispatcher needs no edits. A handler returns the body (200), `reply(status, body, headers)`, or `undefined` (204), and throws `HttpError` for errors.

## Database, migrations and seeds

- Tables: `pilots`, `sessions`, `aircraft`, `passengers`, `waypoints`, `flights`, `flight_crew`; shared `ref_airac`, `ref_aerodromes`, `ref_runways`, `ref_airspaces`, `ref_fis`, `ref_waypoints` (VFR points), `ref_vfr_routes`, `ref_atc_units`, `ref_sun`; `schema_migrations`. Large owned documents (aircraft fuel, mass_balance, performance, equipment, compass_cards; flight route, leg_overrides, atc, options, summary) are jsonb. The ref tables keep the full record in `doc` jsonb.
- Migrations are TS modules (SQL as a default-exported string, or a `run(q)` function) listed in `api/_lib/migrate.ts`, so the Vercel bundle contains them. The runner records each one in `schema_migrations`, applies each in its own transaction, and serialises runners with a session advisory lock (plus an in-process queue for PGlite). It runs from `openDb()`: on server start, in tests, and on the Vercel cold start before serving.
  - `001_schema` converts the v2 production schema in place: `users` → `pilots` (same ids), `sessions.user_id` → `pilot_id` (sessions survive), `flights` → `legacy_flights` (kept as a backup). It then creates the new tables.
  - `002_ref_2609` (generated by `tools/build_ref.ts`) loads the reference data for AIRAC 09/26.
  - `003_existing_pilot_data` (generated by `tools/build_seed.ts`) is one-time: pilots existing when it runs get their profile values and SX-ASV/SX-ASG, and `seeded_at` is set. Pilots created later have `seeded_at` set at creation, so they get nothing.
  - `004_legacy_flights` converts each `legacy_flights` row (v2 `data` JSON) into a v3 flight: same id, version and timestamps. Waypoints are matched to aerodromes and VFR points, otherwise they become custom points. `ov` altitude/TAS/wind overrides become legOverrides, `taxiMin` becomes taxiOutMin, and the PIC goes on the manifest.
- **New AIRAC**: regenerate `data/*.js` (AIP-UPDATE.md), then add a NEW migration with the new ref data. Never edit an applied migration. Point `tools/build_ref.ts` at the new file.

## Running and testing

```sh
npm install
npm run dev          # http://127.0.0.1:8765/  API + Vite hot reload, PGlite in server/pgdata, no sign-in
npm start            # vite build, then serve dist/ + API on http://127.0.0.1:8765/
npm run typecheck    # tsc for the client (tsconfig.app.json) and for node/api/tools (tsconfig.node.json)
npm test             # vitest: tests/unit + tests/api
npm run test:e2e     # vite build + headless Chrome (CDP, SwiftShader WebGL) smoke test
npm run build        # dist/
npm run ref          # regenerate src/data/ref/*.json + migration 002 from data/*.js
npx tsx tools/build_seed.ts   # regenerate migration 003
```
With `GOOGLE_CLIENT_ID` (and optionally `ALLOWED_EMAILS`) set, local runs use Google sign-in. With `DATABASE_URL=postgres://…` they use that database. Never point a local run at the production database.

Deployment (not done by agents): Vercel builds with `vite build` to `dist/`. `vercel.json` rewrites `/api/*` to the function and every other non-file path to `index.html` (the SPA). HTML is served with no-cache, `/assets/*` is immutable, and www redirects to the apex. `.vercelignore` drops aip/, trn-docs/, tools/, tests/ and server/.

## Ownership (parallel phase)

| Agent | Owns | Notes |
|---|---|---|
| calc | `src/calc/**`, `tests/unit/calc/**` | Implement wmm.ts (WMM2025), navlog.ts, fuel.ts, wb.ts, performance.ts stubs, and the custom-waypoint rule in altitudes.ts. Keep signatures; extend types only in a backward-compatible way. Cross-check W&B/performance with `tests/fixtures/club-wbp-cases.json` and the navlog with `tests/e2e/oracle.mjs`. |
| data | `src/data/weather*`, `src/data/atc*`, `api/_lib/routes/weather.ts`, `api/_lib/routes/ref.ts`, `tools/build_ref*`, `src/data/ref/**` generation incl. AIP runway declared distances/slopes | METAR/TAF proxy; generateAtcList (port v2 terminalRows); runway data needs a NEW migration (005+): list it in openIssues for the integrator, who registers it in migrate.ts. |
| map | `src/features/editor/map/**` | MapView via `useEditor()`; VFR-chart layers from `ref`; drawing/snapping/custom points/drag/insert/delete; leg labels; changes only through `update()`. |
| screens | `src/features/{lobby,profile,hangar,passengers,waypoints}/**`, `src/features/editor/panels/**`, `src/features/editor/EditorPage.tsx` | Includes onboarding (`/profile?welcome=1`), add-aircraft-from-template, manifest UI with `validateCrew`. |
| exports | `src/features/exports/**` | One component per ExportKind; print CSS; A4. |

Frozen until integration (ask in openIssues): `src/shared/**`, `src/app/**`, `src/features/editor/state.tsx`, `src/data/api.ts`, `src/data/flightStore.ts`, `api/index.ts`, `api/_lib/{app,http,auth,db,rows,migrate}.ts`, `api/_lib/routes/{index,session,me,aircraft,passengers,waypoints,flights}.ts`, `api/_lib/migrations/**`, `package.json`, the tsconfigs, the vite/vitest configs, `vercel.json`, `server/**`, `tests/api/**`, `tests/e2e/harness.mjs`.
