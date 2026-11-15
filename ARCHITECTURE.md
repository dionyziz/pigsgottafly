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
    operators.ts           Operator, OperatorItem (access, viaAircraft), OperatorSharing; isEmail
    declarations.ts        WbPerfContent (the W&B and performance sheets as sent to an operator), wbPerfContentOf
                           (normalization, both sides), wbPerfText (hashed: "changed since sent"), DeclarationsState
  calc/                    pure calculations (no I/O, no DOM)
    nav.ts                 port of v2 js/nav.js: geodesy, wind triangle, deviation, NOAA sunset, computeLeg, summarize
    wmm.ts                 World Magnetic Model WMM2025: magneticVariation(lat, lon, date, altFt), wmmField, wmmValid
    legs.ts                buildLegs(route, date) → LegGeometry[] (TC, distance, variation, MC)
    altitudes.ts           defaultAltitudes(route, ctx, overrides): charted VFR route, pattern, closest charted leg
                           (custom points, ≤ 10 NM), previous leg; vfrRouteBetween, patternAltitudeFt
    navlog.ts              computeNavlog(NavlogInput) → NavlogResult (times, winds per leg, paper rounding, warnings),
                           navlogAircraft(), pickCompassCard()
    fuel.ts                planFuel(FuelPlanInput) → FuelPlan (required, default FOB = required + reserve, endurance)
    wb.ts                  weightAndBalance(WbInput) → WbResult (per-seat stations, CG + moment envelopes), wbLoadsFromManifest
    performance.ts         windComponents, pressureAltitudeFt (ISA), isaTempC, densityAltitudeFt, selectRunway,
                           takeoffDistances/landingDistances (method 'da' = table at density altitude with planning factors, or 'afm'),
                           aerodromePerformance
    perfVerdict.ts         perfVerdict: one take-off/landing verdict (mass vs MTOW/MLW, distances, crosswind, AFM
                           table range) shared by the editor's take-off & landing cards and the MD 4.4 export
    hazards.ts             weather hazards: legHazards (corridor samples ±1 h, planned altitude), aerodromeModelHazards,
                           reportHazards/tafHazardContent (METAR/TAF), modelCloudBase; TS/CB, visibility, cloud vs alt + 1000 ft
    atc.ts                 AtcGenInput / AtcGenOutput types (generator lives in src/data/atc.ts)
    sun.ts                 sunsetMinutes(date, point, tables): AIP GEN 2.7, else NOAA
    adHours.ts             aerodrome operational hours: parseHours (AIP AD 2.3 / AD 1.6 text → HoursSpec: H24, HJ, HN,
                           HO, HX, O/R, weekly UTC windows, seasons, Greek public holidays; partial = shown as text,
                           evaluated unknown), parseSchedule (also NOTAM item D/E), hoursAt, adHoursFromAip
    aerodromeStatus.ts     effective hours = AIP + NOTAMs: aerodromeNotamEffects (QFAAH, QFALC/LV/LN, limits,
                           handling, TWR/AFIS hours), aerodromeStatusAt/aerodromeStatus (open/closed/unknown + reason,
                           over a time window), aerodromeDay (the day's hours), genDecHandling (who sends the GenDec)
  data/                    client services
    api.ts                 typed fetch wrappers: api.session/login/logout, api.me, api.aircraft|passengers|waypoints
                           (list/get/create/update/remove), api.flights (list/get/create/update/trash/restore/copy/opened),
                           api.ref, api.weather.metar; ApiRequestError(status, auth, offline)
    flightStore.ts         offline-tolerant flight saving (port of v2 js/store.js): load(id), save(id, doc), onStatus
    weather.ts             Open-Meteo (port of v2 js/weather.js): buildUrl, fetchPoints, sampleAt, sampleSurface,
                           fetchRouteWeather, surfaceConditions, chooseSurface (METAR vs forecast), windProviderFromLegs()
    weatherMetar.ts        parseMetar, parseTaf, fetchMetarTaf (through GET /api/weather/metar)
    notams.ts              NOTAM briefing: fetchNotams (GET /api/flights/:id/notams), texts (validity, limits, decoded
                           subject), Q-line circle rings for the map, visibleNotams (relevant / show all)
    hazardWeather.ts       Open-Meteo corridor samples for hazards (every ~10 NM, ±5 NM, 0.25° grid cells cached one by
                           one): fetchHazardWeather, computeRouteHazards (editor strip + map)
    atc.ts                 generateAtcList(AtcGenInput), atcInput(), regenerateAtcList()
    useAsync.ts            small loading hook
    aipLinks.ts            links to the official AIP Greece PDFs (HASP eAIP): AIP_EAIP_BASE (the AIRAC's online eAIP,
                           set by tools/update_aip.sh), aipSection/aipUrl ('LGAV AD 2.3' → AD 2 LGAV PDF; the
                           eAIP start page when a section has no PDF), from ref/aip-files.json
    ref/                   reference data shipped with the client (generated JSON) + index.ts typed accessors:
                           AIRAC, AERODROMES, RUNWAYS, AIRSPACES, AD_AIRSPACES, AREAS (ENR 5), FIS, VFR_POINTS, VFR_ROUTES, ATC_UNITS, SUN_TABLES,
                           REF (RefBundle), aerodrome(idOrIcao), vfrPoint(id), runwaysOf(id), aerodromeLabel(a)
  app/                     AipLink / AipRefText (AIP references as links to their PDF, new tab), App (router), AuthGate + SignIn (Google Identity Services), session context
                           (useSession/usePilot), Shell/TopBar, AccountMenu, toast, ErrorBoundary, styles.css (tokens)
  features/
    lobby/                 LobbyPage, NewFlightPage
    profile/               ProfilePage (?welcome=1 = first-use onboarding), AccountSection (download my data, delete account)
    legal/                 /privacy and /terms (public, no sign-in; linked from the sign-in screen and the account menu)
    hangar/                HangarPage, AircraftPage; AircraftFiles (photo, DocumentsSection + PdfViewer for any FileScope),
                           ShareDialog (aircraft or operator)
    operators/             OperatorsPage, OperatorPage (details, W&B/performance requirement, documents, aircraft, who
                           has access), OperatorPicker (the aircraft page's operator dropdown with "New operator…")
    admin/                 AdminPage (/admin: every pilot, and the e-mail action log filterable by pilot and kind; the API
                           answers 403 to non-admins)
    passengers/            PassengersPage
    waypoints/             WaypointsPage
    editor/                EditorPage (layout: collapsible flight panel; resizable.tsx sizes panels by style during a
                           drag, RouteMap resizes the canvas in the same frame), state.tsx (EditorProvider/useEditor: SHARED EDITOR CONTRACT),
                           map/ (MapView → RouteMap: VFR-chart layers, drawing, snapping, leg labels; airspace.ts +
                           AirspacePopover: TMA/CTR/ATZ and ENR 5 area (P/R/D/MIL/local flying) shapes and layer toggles, hover
                           tooltip, click details (identity only: type, limits, lateral, activity, units, remarks, AIP link);
                           dragging a route point snaps it and it becomes the point dropped on (routeEdit.movePoint);
                           notamLayer.ts + NotamPopover: NOTAM areas, hover tooltip, click details),
                           AerodromePopover: aerodrome hover tooltip / click details with the hours on the flight date),
                           notams.tsx (NotamProvider/useNotams: the flight's NOTAM briefing, show all, selected NOTAM),
                           AerodromeHours.tsx (an aerodrome's hours, ATS, handling on a date, NOTAM changes, AIP text),
                           panels/ (FlightPanel sections incl. RouteSection (origin/destination fields), NavlogStrip; calc.tsx = useFlightCalc: weather, navlog,
                           fuel, W&B, performance, aerodrome hours at the planned times (aerodromeChecks.ts), warnings)
    exports/               ExportPage: /flights/:id/export/:kind → navlog/ (MD 4.2), form731/, gendec/ (MD 4.7),
                           fpl/ (ICAO 2012 message + form), wbperf/ (one signed document: wb/ MD 4.3 + envelope
                           chart, then performance/ MD 4.4; /export/wb and /export/performance redirect to it;
                           SendPanel + declaration.ts: "Send to <operator>" when the aircraft's operator asks for them),
                           briefing/ (NOTAM briefing); fix.ts + WarningList.tsx: every on-screen export warning links to
                           where it is fixed (editor /flights/:id?focus=<key>, hangar /hangar/:id?focus=<field>,
                           /profile?focus=<name>, the passenger dialog); src/app/focusParam.ts focuses + highlights
                           the target (data-focus keys on the inputs; editor panel Sections open for their keys)
api/
  index.ts                 Vercel entry: restores the path from ?__path=, refuses to run without DATABASE_URL and
                           GOOGLE_CLIENT_ID, runs pending migrations on cold start, then serves
  _lib/app.ts              dispatcher createApi({db, googleClientId, allowedEmails, googleKeys, secureCookie}), configFromEnv;
                           crossSiteRefusal (CSRF: non-GET with a foreign Origin / Sec-Fetch-Site: cross-site → 403,
                           not application/json → 415, empty bodies included)
  _lib/http.ts             Route, Ctx, Reply, HttpError, helpers
  _lib/auth.ts             verifyGoogleToken, sessions (hashed tokens; 90 days sliding, renewed weekly; expired ones
                           purged at sign-in), local pilot
  _lib/rows.ts             row ↔ entity mappers, input validation helpers
  _lib/access.ts           aircraft access (owner / shared edit / view): aircraftFor, listAircraft, accessibleSql, AIRCRAFT_FROM
  _lib/operators.ts        operator access (owner / shared edit / view / view through an aircraft): operatorFor, listOperators
  _lib/mail.ts             Resend: sendMail (for a pilot: always cc'd, reply-to), sendSystemMail (the app's own: signup notices)
  _lib/declarationPdf.ts   the W&B and performance sheets as PDF (pdf.ts writer), from the client's WbPerfContent
  _lib/db.ts               connect()/openDb(): Neon or PGlite behind one Db interface (query/exec/transaction/session)
  _lib/migrate.ts          migration runner + MIGRATIONS registry
  _lib/migrations/         001_schema.ts, 002_ref_2609.ts (generated), 003_existing_pilot_data.ts (generated),
                           004_legacy_flights.ts, 005_ref_runways_2609.ts (generated: AIP runway data),
                           006_briefing_filing.ts, 007_aircraft_attachments.ts (compass swing report files),
                           008–010 forms (signatures, links, send claims), 011_fleet_fpl_equipment.ts,
                           012_ref_ad_hours_2609.ts (generated: aerodrome operational hours and handling),
                           013_aircraft_shares.ts (shared aircraft; flight/default FKs on aircraft(id)),
                           014_aircraft_fuels_provenance.ts (approved fuels list; seeded notes/paths cleared),
                           015_aircraft_photo_documents.ts (attachment kinds photo/document, chunk table),
                           017_ref_areas_2609.ts (generated: ENR 5 areas, creates ref_areas),
                           018_operators.ts (operators, operator_shares, aircraft.operator_id, operator_files/_chunks,
                           'wbperf' form submissions; one operator per pilot and distinct aircraft.operator text),
                           030_mail_log.ts (every e-mail sent for a pilot, for the sending caps),
                           031_mail_log_details.ts (the e-mail action log: recipient, subject, result, message id, error;
                           app mails without a pilot), 032_rate_limits.ts (token buckets; indexes for the upload sweep)
  _lib/sendCaps.ts         sending caps (429) and the e-mail action log: per pilot 20 e-mails/24 h, 5 per flight and form,
                           10 declarations/24 h to one address, 10 min between sends of a flight's form; HCAA_DAILY_CAP
                           (default 200) for all pilots together; signing links 60/24 h and 20 per flight
  _lib/limits.ts           per-pilot counts (aircraft 50, operators 20, flights 2000, passengers 500, waypoints 1000, files
                           per parent 50), STORAGE_QUOTA_MB (300) over owned files, 3 unfinished uploads, the 1 h sweep,
                           magic bytes of uploads
  _lib/rateLimit.ts        DB token buckets (429): login per IP, METAR, NOTAMs, ref, share creation (30/day) per pilot
  _lib/routes/             session.ts, me.ts, aircraft.ts, passengers.ts, waypoints.ts, flights.ts, ref.ts, weather.ts,
                           attachments.ts, files.ts (fileRoutes: aircraft photo/documents and operator documents, chunked),
                           shares.ts, operators.ts, declarations.ts, admin.ts, notams.ts, filing.ts
                           + index.ts (the registry)
server/server.ts           local server: API + dist/ with SPA fallback (npm start / npm run serve)
server/dev.ts              dev server: API + Vite middleware with hot reload (npm run dev)
tools/build_ref.ts         data/aip.js, vfr.js, sun.js, tools/runways.json, tools/ad_hours.json, tools/enr5_areas.json
                           → src/data/ref/*.json + migrations 002, 005, 012, 017
tools/parse_enr5.ts        eAIP ENR 5.1 (P/R/D, LGC101), 5.2 (TSAs), 5.3.1 (local flying areas; ENR 5.5 refers to it) text
                           → tools/enr5_areas.json (RefArea: limits, circle/polygon, activity, remarks)
tools/aip_files.ts         the eAIP's side.htm (table of contents) → src/data/ref/aip-files.json (section → PDF path)
tools/extract_ad_hours.ts  eAIP AD 2.3, AD 1.6.N.3/4 text → tools/ad_hours.json (operational hours, ATS, handling,
                           customs, remarks, verbatim; parsed by src/calc/adHours.ts in build_ref)
tools/parse_runways.py     eAIP AD 2.12/2.13, AD 1.6.N.12/13 text → tools/runways.json (declared distances, slopes, …)
tools/parse_ad_airspace.py eAIP AD 2.17, AD 1.6.N.17 text → src/data/ref/ad-airspaces.json (aerodrome CTR/ATZ: limits,
                           class, units; client map layer only, REF.adAirspaces — not in the ref_* tables)
tools/build_seed.ts        data/aircraft/*.json → fleetSeed(): the owner's SX-ASV/SX-ASG as the migrations leave them
                           (003, frozen, + 014; checked by tests/api/migrations.test.ts); used by the tests
data/                      aip.js, vfr.js, sun.js (made by the Python tools from the eAIP; sources for build_ref.ts),
                           aircraft/{reims-f172m,fleet,compass-cards}.json
tests/unit/                vitest: calc/ (incl. club.test.ts: all 90 club calculator cases), data/, exports/, screens/
src/**/__tests__/          vitest: map and export-model tests next to their code (also run by npm test)
tests/api/                 vitest: API, auth, migrations (PGlite in memory)
tests/e2e/                 harness.mjs (CDP), oracle.mjs (independent navlog reference), png.mjs, firefox.mjs, sharing.e2e.test.mjs,
                           smoke.e2e.test.mjs, lists.e2e.test.mjs (lobby and account lists),
                           flight.e2e.test.mjs (whole workflow: map drawing/snapping, panels, navlog vs oracle,
                           every export + PDF page size, W&B vs an independent sum, take-off vs club case 60)
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
   Derived values the lobby shows (navlog ETE and fuel) are written with `setDerived()`: saved, but no undo step.
4. **Calculations** run on the client (`src/calc`), wired in `panels/calc.tsx` (`useFlightCalc`). Weather comes from Open-Meteo directly from the browser (`src/data/weather.ts`). METAR/TAF come through `GET /api/weather/metar`; a METAR is used for performance when it is at most 90 min old and within 90 min of the take-off/landing time, otherwise the forecast.
5. **Exports**: `/flights/:id/export/:kind` loads the flight and renders print-ready A4 pages (`@media print`, named `@page`s: navlog landscape, Form 731 landscape, the others portrait). The editor, exports and waypoints routes are lazy-loaded chunks (MapLibre is only fetched with the map).

## API routes (all JSON, under /api)

| Method | Path | Notes |
|---|---|---|
| GET | /session | `{authed, mode, googleClientId, pilot}`. No auth needed. |
| POST | /login | `{credential}` (Google ID token). 401 if bad, 403 if not in ALLOWED_EMAILS, 404 in local mode. |
| POST | /logout | Ends this session only. |
| POST | /session/revoke-all | "Sign out everywhere": ends every session of the pilot, clears the cookie. |
| GET, PUT | /me | Profile (`PilotUpdate`; settings are merged). `defaultAircraftId` must be an aircraft you own or that is shared with you. |
| DELETE | /me | `{confirm: <account e-mail>}` (local mode `"delete"`): deletes the pilot and everything they own (routes/account.ts: every table's `pilot_id` rows, then the pilot with its cascades; owned aircraft go even when shared), ends all sessions, clears the cookie. |
| GET | /me/export | Everything the pilot owns as a JSON download (GDPR portability; files listed without their bytes). |
| GET, POST | /aircraft | List (by registration): own and shared aircraft, each with `access` (`HangarAircraft`: role, owner); create from `AircraftInput` (you own it). 409 on a duplicate registration. A pilot with no default aircraft gets the new one as default. |
| GET, PUT, DELETE | /aircraft/:id | GET: any access; PUT: owner or editor (403 for viewers); DELETE: owner only. PUT merges the top-level fields. Flights referencing a deleted aircraft get `aircraftId: null`. A compass card's `report` must be a file of this aircraft (400 otherwise); files no card references are deleted on PUT. POST drops `report` references. |
| GET, POST | /aircraft/:id/shares | Sharing (`src/shared/sharing.ts`): GET anyone with access (owner first); POST `{email, role: 'view'\|'edit'}` by owner/editor → 201. 404 for an e-mail with no account (case-insensitive), 400 for yourself or the owner, 409 when they already have access. |
| PUT, DELETE | /aircraft/:id/shares/:pilotId | Change the role / remove (owner or editor); anyone may remove themselves ("remove from my hangar"). The owner is not a share. Removing clears that pilot's default if it was this aircraft. |
| POST | /aircraft/:id/attachments | (editor or owner) `AttachmentInput` (PDF/PNG/JPEG/WebP, base64, ≤ 3 MB) → 201 `AttachmentRef` (compass swing reports). |
| GET, DELETE | /aircraft/:id/attachments/:fileId | GET returns `Attachment` (`AttachmentRef` + base64 `data`). |
| GET | /aircraft/:id/files | `AircraftFiles` {photo, documents} (anyone with access). The aircraft list/get also carry `photo`. |
| POST | /aircraft/:id/files | (editor or owner) `AircraftFileStart` {kind photo (JPEG/PNG/WebP ≤ 5 MB, resized to 1600 px in the browser) or document (PDF ≤ 80 MB), name, title, mime, size} → 201 `AircraftFile` (incomplete). |
| PUT | /aircraft/:id/files/:fileId/chunks/:seq | (editor or owner) `{data}` base64, `AIRCRAFT_FILE_CHUNK_BYTES` (2 MiB) each but the last: a POH never needs a request above the ~4.5 MB serverless limit. |
| POST | /aircraft/:id/files/:fileId/complete | All chunks in → the file is listed; a new photo replaces the old. |
| GET | /aircraft/:id/files/:fileId/chunks/:seq | `{data}`: the client assembles a Blob (src/data/aircraftFiles.ts) for the PDF viewer (iframe of a blob: URL; CSP frame-src blob:) or a download. |
| PUT, DELETE | /aircraft/:id/files/:fileId | (editor or owner) `{title}` / remove. Saving the aircraft only removes unreferenced swing *reports*. |
| GET, POST | /operators | `OperatorItem[]`: own, shared, and seen through an aircraft (view); create (you own it). |
| GET, PUT, DELETE | /operators/:id | GET any access; PUT owner or editor (merges; renames its aircraft's fallback text); DELETE owner (aircraft keep the name as text). `requiresWbPerf` needs `declarationsEmail`. |
| GET, POST, PUT, DELETE | /operators/:id/shares[/:pilotId] | As for aircraft. GET also lists who sees it through an aircraft (`direct: false`, `via`: registrations); those change by sharing the aircraft. |
| GET, POST, PUT, DELETE | /operators/:id/files… | Documents (operations manual), chunked like the aircraft files. |
| GET | /flights/:id/declarations | `DeclarationsState`: the flight's aircraft's operator, the last sending (`hash`). |
| POST | /flights/:id/declarations/send | `{content: WbPerfContent, resend?}`: PDF to the operator's declarations e-mail, pilot cc'd. Subject and body from the server's records only; the content (bounded, links and e-mail addresses removed) only draws the PDF. 409 when not asked for / already sent (without resend); 429 over the sending caps; 503 e-mail not configured. |
| GET | /admin/pilots | `AdminPilot[]` (ADMIN_EMAILS only; 403 otherwise). `GET /session` says `admin`. |
| GET | /admin/mail?pilot=&kind= | `AdminMail[]`: the e-mail action log, newest first (300), ADMIN_EMAILS only. |
| GET, POST | /passengers | List (by name); create. |
| GET, PUT, DELETE | /passengers/:id | Delete keeps manifest snapshots (`passengerId` becomes `null`) and moves their Form 731 signature and signing link to the key `seat:<seat>` (still valid). A flight PUT naming a passenger that is not the pilot's (e.g. deleted meanwhile) drops the link and keeps the snapshot. |
| GET, POST | /waypoints | Saved custom points (names upper-cased). |
| GET, PUT, DELETE | /waypoints/:id | |
| GET | /flights | `?trash=1` lists the trash. Ordered by GREATEST(updated, opened). |
| POST | /flights | `FlightCreateRequest` (partial doc; optional client `id`). |
| GET | /flights/:id | `Flight` including `crew`. |
| PUT | /flights/:id | `{flight: FlightDoc, version}` returns `{version, updated}`. 409 with the current Flight as the body. 400 on validation errors. |
| DELETE | /flights/:id | Moves to trash. |
| POST | /flights/:id/restore, /copy, /opened | |
| GET | /flights/:id/forms | Form 731 and GenDec state; `gendec.handling`: handling at each end at the flight's time (AIP + the flight's last NOTAM briefing) and who sends the GenDec. |
| POST | /flights/:id/forms/gendec/handled | `{handled: true \| false \| null}`: the flight's override (`options.genDecHandled`; a PUT of the flight never changes it). |
| GET | /ref/airac, /ref/bundle, /ref/{aerodromes,runways,airspaces,fis,vfr-points,vfr-routes,atc-units,areas} | Current AIRAC, read-only. /ref/bundle has an ETag by AIRAC (304 on If-None-Match) and `Cache-Control: private, max-age=86400`. |
| GET | /weather/metar?ids=… | METAR + TAF from aviationweather.gov (≤ 6 ICAO ids; the client splits longer lists), cached per station; stale reports up to 3 h when upstream fails. |

Tenancy: every query includes `pilot_id = <session pilot>`. Another pilot's record answers 404. References between owned rows are composite `(id, pilot_id)` foreign keys (flight_crew → passengers), so the database itself prevents cross-pilot references. `tests/api/api.test.ts` checks isolation for every entity.

Operators (migration 018, `api/_lib/operators.ts`, `tests/api/operators.test.ts`) are shared the same way (`operator_shares`), and everyone with access to an aircraft views its operator: derived on every query, so it ends with the aircraft's share unless the operator is shared directly. Assigning an aircraft to an operator needs edit access to the operator. `Aircraft.operator` is the linked operator's name (joined as `operator_name`), else the old free text.

Shared aircraft are the exception (migration 013, `api/_lib/access.ts`, `tests/api/sharing.test.ts`): `aircraft.pilot_id` is the owner, `aircraft_shares` gives other pilots `view` (see it, use it on their flights) or `edit` (also change it and its files, manage sharing). Only the owner deletes. No access answers 404, too little 403. flights.aircraft_id and pilots.default_aircraft_id are plain FKs to aircraft(id) (ON DELETE SET NULL) and the API checks access. When access ends, the pilot's flights keep the aircraft id: the editor shows it as unavailable, a PUT keeps that unchanged id without the seat checks, forms/filing/exports see no aircraft; the pilot's default is cleared. Attachments keep pilot_id = owner.

**Adding a route**: add it to the module that owns it (e.g. `api/_lib/routes/weather.ts` exports `routes: Route[]`). Every module is already listed in `routes/index.ts`, so the dispatcher needs no edits. A handler returns the body (200), `reply(status, body, headers)`, or `undefined` (204), and throws `HttpError` for errors.

## Database, migrations and seeds

- Tables: `pilots`, `sessions`, `aircraft`, `passengers`, `waypoints`, `flights`, `flight_crew`, `aircraft_attachments` (file content, base64), `aircraft_shares` (aircraft, pilot, role view|edit), `operators`, `operator_shares`, `operator_files` + `operator_file_chunks`; shared `ref_airac`, `ref_aerodromes`, `ref_runways`, `ref_airspaces`, `ref_fis`, `ref_waypoints` (VFR points), `ref_vfr_routes`, `ref_atc_units`, `ref_sun`, `ref_areas` (ENR 5, migration 017); `schema_migrations`. Large owned documents (aircraft fuel, mass_balance, performance, equipment, compass_cards; flight route, leg_overrides, atc, options, summary) are jsonb. The ref tables keep the full record in `doc` jsonb.
- Migrations are TS modules (SQL as a default-exported string, or a `run(q)` function) listed in `api/_lib/migrate.ts`, so the Vercel bundle contains them. The runner records each one in `schema_migrations`, applies each in its own transaction, and serialises runners with a session advisory lock (plus an in-process queue for PGlite). It runs from `openDb()`: on server start, in tests, and on the Vercel cold start before serving.
  - `001_schema` converts the v2 production schema in place: `users` → `pilots` (same ids), `sessions.user_id` → `pilot_id` (sessions survive), `flights` → `legacy_flights` (kept as a backup). It then creates the new tables.
  - `002_ref_2609` (generated by `tools/build_ref.ts`) loads the reference data for AIRAC 09/26.
  - `003_existing_pilot_data` (generated by `tools/build_seed.ts` at the time; frozen since) is one-time: the owner's account (matched by the SHA-256 of its e-mail, so the address is not in this public repo) gets its profile values and SX-ASV/SX-ASG; every pilot existing when it runs gets `seeded_at` set, the others with nothing. Pilots created later have `seeded_at` set at creation, so they get nothing.
  - `004_legacy_flights` converts each `legacy_flights` row (v2 `data` JSON) into a v3 flight: same id, version and timestamps. Waypoints are matched to aerodromes and VFR points, otherwise they become custom points. `ov` altitude/TAS/wind overrides become legOverrides, `taxiMin` becomes taxiOutMin, and the PIC goes on the manifest. A v2 ATC/terminal list the pilot edited (hidden rows, rows added by hand, `T.<row>.*` cells) becomes the v3 generated list with those edits applied (`legacyAtc`); an unedited one stays null (generated). Typed-over computed cells (`L<i>.ete` etc.) and per-flight fuelFlow/fuelExtra have no v3 equivalent and stay only in `legacy_flights`.
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
npx tsx tools/build_seed.ts   # print the owner's seeded aircraft (003 is applied and frozen)
```
The W&B and performance sheets are computed in the browser (weather, models), so the export sends what it shows as `WbPerfContent` (text as printed + chart geometry) and the server draws the PDF with its own writer: nothing to install on Vercel, no headless browser. The client hashes `wbPerfText` (SHA-256, crypto.subtle) the way the server does, to show "changed since it was sent".

The signed-in pilot is one copy for the app (AuthGate): `setPilot` is posted to the other tabs (BroadcastChannel) and a tab re-reads `/api/me` when it comes to the foreground, so details fixed in an export's tab show everywhere at once. Exports read it with `usePilot()`, never their own `GET /me`.

Abuse limits (env, optional): `HCAA_DAILY_CAP` (forms to the HCAA per 24 h, all pilots; default 200), `STORAGE_QUOTA_MB` (per pilot; default 300).

With `GOOGLE_CLIENT_ID` (and optionally `ALLOWED_EMAILS`, `ADMIN_EMAILS`) set, local runs use Google sign-in. With `DATABASE_URL=postgres://…` they use that database. Never point a local run at the production database. Without `GOOGLE_CLIENT_ID` the local server refuses a `postgres://` `DATABASE_URL` (local mode would serve an unauthenticated 'local' pilot from that database) unless `LOCAL_MODE_ON_POSTGRES=1` is set for a disposable Postgres. The built client is served locally with the same security headers (CSP, `X-Frame-Options: DENY`) that `vercel.json` sets in production, so the e2e suite fails on any CSP violation.

Deployment (not done by agents): Vercel builds with `vite build` to `dist/`. `vercel.json` rewrites `/api/*` to the function and every other non-file path to `index.html` (the SPA). HTML is served with no-cache, `/assets/*` is immutable, and www redirects to the apex. `.vercelignore` drops aip/, trn-docs/, tools/, tests/ and server/.

## Ownership

The parallel build phase is over and everything is integrated (one commit). From here on, any agent may
change any file, but the contracts above (`src/shared/**`, `state.tsx`'s `useEditor()`, the API routes)
change only together with their users, and an applied migration is never edited.
