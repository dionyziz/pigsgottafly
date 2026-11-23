# The native iPhone and iPad app

The app is native (Swift, SwiftUI, MapLibre Native): the whole of the website (plan, brief, file, the
hangar, passengers, waypoints, operators, the profile), laid out for the iPhone and the iPad, plus Fly,
the moving map for the cockpit.

The app and the website are maintained together. **Everything computed comes from one TypeScript source.**
The flight's numbers, the chart's style and features, the checklist and progress along the route are
built into `core.js` from `src/native/core/` (which reuses src/calc, src/shared, src/data,
src/features/editor/map/{style,features,airspace,labels}.ts and the panels' pure models). The app runs
`core.js` in JavaScriptCore. The website and the app therefore show the same numbers and draw the same
chart. The app calls the same API at https://pigsgottafly.com/api.

```
native/ios/                    the app (XcodeGen: project.yml → PigsGottaFly.xcodeproj, generated, not committed)
  PigsGottaFly/                Swift sources
  PigsGottaFly/Resources/core.js   built by `npm run native:core` (committed, so Xcode needs no Node)
src/native/core/               the core's API (below), one file per domain; unit-tested in tests/unit/native/
```

## Screens

The app does everything the website does, laid out for the iPhone and the iPad, and adds **Fly**. A
section the app has the place for but not yet the form shows the website's page for it in an in-app
browser (SFSafariViewController); the flight, aircraft or list is read again when it closes. The
section files are listed below with the phase that builds each one.

**Shell** (`App/AppShell.swift`). iPhone (compact width): a tab bar, **Flights · Hangar · People ·
Me**. iPad (regular width): a three-column split view, sidebar **Flights, Hangar, Passengers,
Waypoints, Operators, Profile**, the area's list in the middle column, the open record in the detail.

- **Flights** (`Views/Flights/`, the website's LobbyPage): the pilot's flights and the ones shared with
  them (GET /api/flights), searchable by the website's match text (title, route points, passengers,
  aircraft, date). Upcoming, Past and Shared with me, newest first. Each row: the route thumbnail
  (Canvas from `summary.route`; a local flight is a dot in a dashed ring), the title, the route line
  ("LGTT local · 1:00") and aircraft, the date with the relative day, block-off in UTC and Greek local
  time, the passengers, the filing and shared-by chips; at regular width also distance, time and fuel. Swipe and
  context menu: Fly again (a copy for today), Rename (PUT with the automatic title kept automatic),
  Make a copy, Move to trash (with Undo), Leave (shared), and Share… (the share sheet below). The
  Trash (GET /flights?trash=1) with Restore.
  Pull to refresh.
- **New flight** (the website's NewFlightPage). The list's + creates the flight at once with the
  profile's defaults (POST /api/flights `{}`: the server starts it at the home aerodrome, with no
  destination); a long press
  offers "Choose origin and destination". `Views/NewFlightView.swift` is the sheet for the cases that
  ask first: the first flight asks for the home aerodrome (saved with PUT /api/me before the flight is
  made); the route form takes origin and destination, or Local flight (back to the origin) and its
  estimated total time, or Start with an empty map. With an empty hangar the pilot may type a
  registration and the aircraft is made from the hangar's type template (`PGF.aircraftFromTemplate`,
  POST /api/aircraft). The new flight opens on Plan.
- **A flight** (`Views/Flight/FlightWorkspace.swift`). iPhone: its own tab bar, **Fly · Map · Plan ·
  Brief · File**; the shell's tab bar gives way to it. iPad: the map fills the detail, Plan / Brief /
  File sit in an inspector beside it, and Fly is the toolbar's prominent button. A flight opens on the
  tab it was left on in this session; else a planned flight (route and aircraft) of today (UTC) opens
  in Fly, and any other flight, or one just made in New flight whatever its date, on Plan
  (`FlightTab.initial`, as the website's stage default). The toolbar has Undo and Redo (every edit
  goes through `FlightModel.edit`, which registers the flight as it was with the UndoManager; a 409
  clears the stack), the saving or offline state, and **Share** (`Views/Common/ShareSheet.swift`, the
  website's flight ShareDialog): pilots by e-mail as viewer or editor, also before they have an
  account (a pending invite), the manifest's passengers with an e-mail offered as viewers ("Share
  (view)"), roles, removing, and leaving a flight shared with the pilot. A flight shared with the
  pilot shows "View only · shared by …" (or "Shared by …") atop Plan, Brief and File. Removing a
  passenger the flight is shared with asks "Also stop sharing the flight with …?" (`PGF.unshareOffer`).
  - **Fly** (`Views/Flight/FlyView.swift`): a full-screen moving map, with no tab bar and no navigation
    bar. It shows the chart (the same style and layers as the website), the route with the active leg,
    the own aircraft from GPS with its track line, and a top strip with the next waypoint, bearing,
    distance, ETE and ETA, groundspeed and the leg's planned altitude and heading. The bottom strip
    shows the current leg's frequency and the next one. Track up or north up; re-centre; night
    display. The screen stays on. Its own control goes back to the flights (iPad: back to the map), to
    Brief and to Plan's Navlog. It works offline: the flight, reference data, weather and map tiles for
    the route are saved when the flight is opened with a connection. On iPad it hides the sidebar and
    keeps the aircraft centred in the whole screen.
  - **Map** (`Views/Flight/MapTab.swift`): the planning chart framed on the route. To come (1E): route
    editing (draw, tap to add with snap, drag, insert, custom points), the layer and base-map menu,
    the aerodrome, airspace, navaid and NOTAM sheets.
  - **Plan, Brief, File** (`StageView` in FlightWorkspace.swift): each starts with its stage's readiness
    (`Views/Common/ReadinessHeader.swift`: `PGF.readinessStages` of the core's readiness and paperwork
    rows, each row with its Fix), then its sections. A Fix asks `PGF.focusTarget` where it leads and
    the workspace switches tab and opens the section with that field focused
    (`Views/Common/FocusRouter.swift`), or opens the website's page (the profile).
    - Plan (`Views/Flight/Plan/`, edits in `App/FlightModel+Plan.swift`): **Route**, the origin and
      destination picked as aerodromes (a local flight moves as a whole), "Local flight from …", a
      local flight's duration and "Fly somewhere instead", and the points reordered (drag, Edit),
      inserted before or after a point or where they lengthen the route least (an aerodrome, a VFR
      point, a saved waypoint, or a typed position named WP1, WP2, … as the map names it), renamed and
      removed (context menu, swipe), each one `PGF.routeEdit`; **When**, the date, block start (UTC,
      with the local time), taxi out and in, a local flight's duration, and the times with the local
      time under each; **Aircraft**, the aircraft from the hangar (`PGF.setAircraft`: seats, baggage,
      compass card and category follow; on a shared flight the owner's choice, shown only), its
      figures, the compass card and the winds' model; Manifest & loading (1C); **Fuel**, the taxi
      allowance per take-off, trip, reserves, required, the fuel on board (one field per approved
      fuel, `PGF.fuelEdit`), "Use required + reserve", "Full tanks", the gauge, endurance, fuel at
      landing and the check; **Flight plan options**, two alternates (`PGF.fplOptions`), touch-and-go
      and stop requests with the stop's minutes (`PGF.setRequest`, `PGF.requests`) and the remarks;
      **Navlog**: the legs (altitude, heading, distance, ETE, ETA, fuel) and the totals; quick edits of
      the date, the block-off time, a local flight's duration and a leg's altitude. Every edit is one
      undo step: PUT the flight with the version; the summary follows (title, route, totals) and the
      overrides of legs that are gone are dropped, as the website's editor does. Per-leg TAS, wind and
      temperature come with 1H.
    - Brief (`Views/Flight/Brief/`): **METAR and TAF** for the route's aerodromes and alternates;
      **NOTAMs**, relevant ones by departure, destination and airspace, marked read as on the website;
      **Aerodromes**, each at the time the flight uses it (aerodrome, ATS and handling hours);
      Take-off & landing (1D); ATC (1D); **Warnings**, the core's, each with its Fix.
    - File (`Views/Flight/File/`): **Flight plan** (`FlightPlanView.swift`, `FlightPlanSheets.swift`,
      `App/FilingModel.swift`; the website's FPL page and Filing panel): the status as the backend
      reports it (autorouter: filed, acknowledged or rejected; fax: sending, delivered or failed, with
      the office and number), when it was filed and checked, the EOBT; **File** opens a confirmation
      of exactly what POST /api/flights/:id/filing carries (the backend or the backends tried in turn,
      the flight's identification, EOBT and DOF, the AFTN addressees, the e-mail copies, the AFTN
      message); **Delay…** takes a new EOBT (UTC, +15/+30/+60 min), checked as the server checks it,
      with the DLA a fax carries; **Cancel…** asks first, with the CNL a fax carries; **Refresh
      status**; while a fax is sending its delivery is asked every 5 s until it settles. "Send via"
      (with two backends), the proposed AFTN addressees to untick and typed ones to add, the e-mail
      copies; the FPL message (copy, copy as one line) with the page's warnings and their Fix; the
      ICAO form as a PDF (SheetRenderer `fplform`, signed by the pilot); the filing log; "Connect
      autorouter" when the pilot's account is not linked. Refusals read as on the website (the
      server's text; offline: "Offline: nothing was sent."). Each answer is kept for the flight, so
      the File stage's row follows at once (`FlightModel.applyFiling`), and the flight list reloads
      for its filing chip. Navigation log and NOTAM briefing as PDFs to preview, share, print and e-mail (1H, with
      `Views/Common/PDFPreview.swift`). The forms (`App/FormsModel.swift` holds GET /forms and
      /declarations, the saved copy first; every action's answer replaces it, is saved, and the File
      rows follow): **Form 731** (only with someone besides the PIC on board), each person's signature
      (the PIC signs when the form is made, as on the website), "Request signatures", per passenger
      the signing link shared from the device's share sheet (shown once), New link, Revoke, "E-mail
      the form" (the server mails the form and a new link) or "Add an e-mail address" (the passenger
      editor in a sheet, at the e-mail field), "E-mail all", "Send to HCAA" once everyone has signed and "Re-send" when the form
      changed since; **General Declaration**: each end's handling with its reason, "Submitted by a
      handler" (the flight's override; back to automatic when it agrees, or "Use automatic"), "Send to
      HCAA" when the PIC sends it; **W&B & performance**: the verdicts, the weather they were made with,
      the warnings and "Send to <operator>" when the aircraft's operator asks for the sheets ("changed
      since sent" by the sheets' hash and the operator's address). Each with its missing details (Fix)
      and the sheets with their signatures as a PDF (`FormParts.swift`). What each panel says and
      offers is the core's (`PGF.form731Panel`, `genDecPanel`, `operatorPanel`).
- **Hangar** (`Views/Hangar/`): the pilot's aircraft and the shared ones, the default one marked. The
  list's + is the website's Add aircraft (`AddAircraftView`): the registration and Start from, the
  type templates, the same type as each aircraft in the hangar, or blank (`PGF.newAircraft`); POST
  /api/aircraft, then the new aircraft opens (iPhone: pushed; iPad: selected into the detail). Context
  menu and swipes: Make default aircraft (PUT /api/me), Add another of this type (Add aircraft from
  that aircraft), Delete (the owner, DELETE /api/aircraft/:id) or Remove from my hangar (a shared
  one: its own share), each asked once. A shared aircraft shows "Shared by … · Viewer". **Share…**
  (the row's context menu, and the aircraft page's toolbar; `ShareAircraftView`, the website's
  ShareDialog): the people with access, the owner first, then the pending invitations; the owner and
  editors add people by e-mail as viewer or editor (an address no account uses gets an invitation to
  the app), change a role, remove someone; anyone removes their own access (asked once; the aircraft
  leaves the hangar). **Invite pilots** (the hangar's toolbar; `InvitePilotsView`, the website's
  InviteDialog): an e-mail, a note and the aircraft the pilot owns or edits with a role each (an
  existing account gets them at once), and the open invitations with Cancel. Each aircraft opens its
  sections:
  Identity, Flight plan items, Speeds, Fuel, Mass & balance (1F); Performance, Compass cards,
  Documents, Photo, History (2C). Edits save by themselves (`Views/Common/Autosave.swift`: a PUT when
  the pilot pauses, with the version; on 409 the unsaved changes are applied again to the server's
  copy).
- **People** (`Views/People/`; on iPad three sidebar areas): Passengers and their editor
  (`PassengerEditorView.swift`, the website's passenger dialog: name, phone, e-mail, date of birth,
  weight, nationality, ID / passport number, notes; "Missing …" leading to the field; the problems
  under their fields from `PGF.personIssues`; a saved passenger saves by itself (Autosave) while it
  has no problems, a new one with "Add passenger"; Delete asks first and Undo adds the details back
  as a new record, as the website's toast; the lists read again after each change), Waypoints
  (list; map, typed coordinates and notes 1G), Operators and their editor (1G; documents 2C). An
  operator's Share (its editor's toolbar) is the share sheet: people with access, also those who see
  it through one of its aircraft ("Viewer (aircraft)"), added by e-mail (accounts only), roles,
  removing, leaving.
- **Me** (`Views/Me/`; Profile in the iPad sidebar): the signed-in account; **Profile** (name, phone,
  home aerodrome, PUT /api/me; the pilot's own autorouter account, linked in Apple's sign-in sheet);
  planning defaults, map layers for new flights, licence and medical, data export and "Sign out
  everywhere" (1G, 2C); **Sign out**; **Delete account**: the account's e-mail typed as the
  confirmation, DELETE /api/me { confirm }, then signed out with the cache and the map packs cleared;
  legal pages; the admin pages for admins; the app's and the core's versions.
- **Sign-in**: Apple's sign-in sheet on /app-login (Google or Apple ID) → one-time code → GET
  /api/app-session?code=… with URLSession, which keeps the session cookie (HTTPCookieStorage).

**API** (`Services/API/`): `API.swift` sends a request and maps the status (401 signed out, 404, 409
with the current record, offline); `API+Flights`, `+Aircraft`, `+People`, `+Files`, `+Forms` and
`+Account` wrap every endpoint the website calls (src/data/api.ts), with typed request bodies and the
answer decoded as the caller's Codable type or as JSON. In fixture mode (`-fixtures`) the answers come
from `Services/Fixtures/FixtureRoutes+<Domain>.swift` over the bundled files. Filing is simulated there
(`FixtureRoutes+Filing.swift`; nothing reaches ATC): a flight starts from `filing-<id>.json` (else
filing.json, a plan filed via autorouter); filing via autorouter answers "filed", via fax "sending",
which the next status request turns "delivered"; delay and cancel change the record, every action is
logged. The forms are simulated
in memory and nothing is e-mailed (`FixtureRoutes+Paperwork.swift`, from `forms-<id>.json` and
`declarations-<id>.json`, else `forms.json` and `declarations.json`): links are made, renewed and
revoked, a passenger given a link has signed by the next GET, and the sends to the HCAA and the
operator answer as the server does (409 until everyone signed, or for a version already sent).
`-openFlight fixture-forms` is a flight with a passenger, a GenDec the PIC sends and an operator who
asks for the W&B and performance sheets. Sharing and invitations are
kept in memory; the fixture server knows one other account (copilot@example.com, shared with at once)
and sends no e-mail; a flight's address with no account becomes a pending invite, an operator's is
refused as the server refuses it.

**Launch arguments** (tests, screenshots): `-fixtures`, `-emptyAccount`, `-noNetwork`,
`-fixturePosition lat,lon,track,gs`, `-today YYYY-MM-DD`, `-openFlight <id>`, `-tab
fly|map|plan|brief|file`, `-section <FlightSection>`, `-shellTab flights|hangar|people|me`, `-newFlight
[ICAO]`, `-orientation landscape`.

## core.js API (global `PGF`, JSON in and out, synchronous)

`core.js` is an IIFE that sets `globalThis.PGF` (ES2020, minified, about 600 KB with the reference
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
- `PGF.lineStyles()`: `{ [id]: { color, width, dash, opacity, fill, hatch, casing } }`, how the style
  draws each line and area (`fir`, `tma`, `mtma`, `ctr`, `atz`, `zoneG`, `prohibited`, `restricted`,
  `danger`, `mil`, `act`, `vfrRoute`, `notam`, `route`): colour as `#rrggbb`, width in points at zoom
  10, dashes in line widths (MapLibre's), the area's tint (or hatching) opacity, the hatching symbol or
  null, the route's white casing width (0 for none). The legend beside each layer toggle draws its
  samples with these, as the website's does.
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
- `PGF.aircraftTemplates()`: the hangar's type templates `[{ id, label, description }]`
  (src/features/hangar/templates.ts). `PGF.aircraftFromTemplate({ id, registration })`: the AircraftInput a
  template builds with that registration (upper case), the body of POST /api/aircraft as the website's Add
  aircraft sends it.
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

The sources are src/native/core/, one file per domain (chart, flight, progress, plan, manifest, forms,
exports, filing, hangar, share, people; shared.ts holds the JSON, `ref` and weather plumbing). Every function below
wraps the website's own module (named in brackets); where the website kept a rule inside a React
component, it moved to that module and the component imports it. tests/unit/native/<domain>.test.ts
checks each answer equals the website module's for the same input.

**Plan** (src/native/core/plan.ts)

- `PGF.routeEdit({ route, legOverrides?, op, … })` → `{ route, legOverrides }`: one edit of the route
  as the editor makes it (one undo step), with the overrides of legs that are gone dropped, as the map
  does (`pruneOverrides`) [editor/map/routeEdit.ts]. `op`: `add { point, toEnd? }` (drawing: before a
  round trip's closing point unless `toEnd`), `removeDrawn { toEnd? }`, `insert { index, point }`
  (index = leg + 1 to split a leg), `replace { uid, point }`, `move { uid, point, newUid? }` (a point
  that becomes another one gets `newUid`), `remove { uid }`, `rename { uid, name }`, `setEnd { end:
  'from' | 'to', aerodrome, ref? }` (the route fields; `aerodrome` an id/ICAO or a RefAerodrome; a
  local flight moves as a whole), `makeLocal`, `setAltitude { key, altFt }` (the navlog strip's
  override; null clears it). A `point` without a `uid` gets one.
- `PGF.routeInfo({ route })` → `{ roundTrip, bareRoundTrip, drawIndex, local, autoWaypointName }`.
- `PGF.snap({ ref?, route?, waypoints?, layers?, lat, lon, zoom, exceptUid?, newUid? })` → `{ hit,
  point }`: what a tap or drag at (lat, lon) snaps to at map zoom `zoom`, as the website's map
  (`findSnap` on the route's own points and on the aerodromes, VFR points and waypoints the `layers`
  show, `bestSnap` between them; 12 px on MapLibre's 512 px Web Mercator) [editor/map/snap.ts]. `hit`
  is `{ cand: { kind, refId, name, detail, lat, lon, penaltyPx }, distPx, shadowed? }` or null;
  `point` the route point (uid `newUid`). `exceptUid`: the point being dragged.
- `PGF.localFlight({ route, options })` → `{ local, durationMin, durationOf, defaultMin, maxMin,
  areaNm }` [shared/local.ts].
- `PGF.setRequest({ aerodromeRequests, pointUid, op?, kind, stopMin?, key?, value? })` → the new
  `options.aerodromeRequests`: `op` 'set' (default; a stop's minutes), 'remove' (one kind, or all of
  the point's without `kind`) or 'choice' (`key` 'landingRunway' | 'takeoffRunway' | 'surface',
  `value` null for automatic) [shared/requests.ts].
- `PGF.requests({ route, options, ref? })` → `{ active, allowed, remarks, stopPoints, landingPoints,
  stopMin }`: the active requests in route order, `allowed[i]` `{ 'touch-and-go', stop }` per route
  point, the FPL RMK/ remarks, the full-stop and landing point indices [shared/requests.ts].
- `PGF.fplOptions({ fields, ref? })` → `{ alternates, max }`: FlightOptions.alternates from the
  alternate fields [editor/panels/fplOptions.ts].
- `PGF.fuelLoad({ fuel, totalL, byType?, options? })` → `{ load, byType, byTypeTotal, taxiAllowanceL,
  types, density }`: the fuel on board by type (`load` is FuelLoad: parts, kg, density, mixed,
  unapproved) and the taxi allowance per take-off [shared/fuel.ts].
- `PGF.setAircraft({ doc, aircraft })` → `{ aircraftId, crew, baggageKg, options }`: the flight
  after choosing an aircraft (null: none); people keep their seat where it exists, baggage of gone
  stations is dropped, the compass card and the W&B category follow [editor/panels/aircraftChoice.ts].
- `PGF.fuelEdit({ doc, op, … })` → `{ fobL, options }`: `type { fuel, type, litres }` (one fuel's
  litres typed, null clears it; the FOB is the sum, only the first fuel typed is a plain total),
  `total { litres }`, `default` (required + reserve) [editor/panels/fuelEdit.ts].
- `PGF.readinessStages({ items })` → `[{ stage, label, state, open }]` for plan, brief and file, from
  `computeFlight`'s `readiness` and `paperwork`'s rows [editor/panels/readiness.ts stageSummary].
- `PGF.focusTarget({ text?, fix?, flightId?, aircraftId? })` → `{ fix, focus, section, stage, link }`:
  where a warning's Fix leads (a warning's `text`, or an export model's `fix`): a flight field
  (`focus`, its editor `section` and readiness `stage`) or a page (`link: { to, label }`, the website's
  path) [exports/fix.ts planningFix, fixLink; editor/focus.ts]. `PGF.focusSections()` → `{ fields,
  stages }`: the editor's focus keys by section and the sections by stage.
- `PGF.regenerateAtc({ flight, altitudesFt, pilot?, ref? })` → `{ generated, list, stale, atc }`: the
  ATC list generated for the route at `computeFlight`'s `altitudesFt`, the list shown, whether the
  edited list is stale, and `atc`, doc.atc after Regenerate (null: follow the generator) [data/atc.ts].

**Brief** (src/native/core/brief.ts)

- `PGF.brief({ computed, flight, aircraft?, notams?, ref?, now?, showAll? })` → `{ metar, aerodromes,
  performance, notams }`: the Brief's sections from `computeFlight`'s answer (not computed again).
  `metar`: `{ shown, rows }`, the METAR box's stations with a report, from 6 h before take-off
  [editor/panels/metarStations.ts]. `aerodromes`: `{ closed, items }`, each aerodrome's status at the
  planned time and its hours that day [editor/adDay.ts]. `performance`: `{ has, noGo, endpoints }`,
  each take-off and landing with its verdict, reason, figures and runway/surface choices
  [editor/panels/performance.ts]. `notams`: the briefing by group, with the autorouter-only tag, the
  meta line and Show all [data/notams.ts].

**Manifest** (src/native/core/manifest.ts)

- `PGF.manifest({ crew, stations?, op, … })` → `{ crew, ok, moved, seats, full, picSeat, errors }`: one
  change of the manifest [editor/panels/manifest.ts]. `stations`: the aircraft's M&B stations (none:
  a four-seater's seats). `op`: `seats`, `addPassenger { passenger }` (first free seat; `ok: false`
  when full or on board), `addPic { pilot }` (front left; `moved` is who made room; `ok: false` when
  every seat is taken), `changeSeat { index, seat }` (swaps), `remove { index }`, `editField { index,
  key, value }` (the field stops following its person), `apply { index, person }`, `reset { index,
  person }`, `sync { before, now }` (`{ 'PIC' | passengerId: person }`: snapshots follow their people).
  `errors` is `validateCrew` [shared/constants.ts].
- `PGF.wbChart({ massBalance, points? })` → `{ envelopes, domain }`: the MD 4.3 chart's envelopes
  (`{ category, label, maxKg, outline, cgOutline }` in [moment, mass]) and axes `{ x0, x1, y0, y1,
  xTicks, yTicks }` holding them and the points (e.g. `computeFlight`'s wb.takeoff, wb.landing,
  wb.zeroFuel) [exports/wb/model.ts]. `PGF.cgToMoment({ polygon })` → `{ moment, outline }`: a CG
  envelope in moment space, as stored and as drawn [hangar/model.ts, exports/wb/model.ts].
- `PGF.shareSuggestions({ crew, passengers, people? })` → `{ contacts, suggestions }`: the manifest's
  passengers with an e-mail, and those the flight is not shared with (`people` from GET
  /api/flights/:id/shares) [shared/sharing.ts].

**File & forms** (src/native/core/exports.ts; filing in filing.ts). The flight's ones take `computeFlight`'s `{ flight,
aircraft, pilot, ref, weather, now? }`.

- `PGF.fplMessage(…)` → `{ fpl, oneLine, warnings }`: `fpl` is `{ fields, message, lines, complete,
  warnings, fixes }`; `message` is the AFTN text POST /api/flights/:id/filing takes; `warnings` the
  FPL page's `[{ text, fix? }]` [exports/fpl/input.ts fplInputWith, fpl.ts buildFpl, planning.ts].
- `PGF.filingView({ state, choices?, message?, complete?, busy?, typed? })`: the Filing panel for GET
  /api/flights/:id/filing (`choices`: `{ excluded, extra, noCopy, via }`, the addressees unticked or
  typed, the copies unticked, the backend): `{ status: { label, tone }, open, enabled, disabledReason,
  connect, connectOnly, connectLabel, viaChoice, viaLine, chosen, sendsVia, record, addressees,
  addresses, copies, copyTo, file: { shown, label, enabled, hint }, delay, cancel, refresh, sending,
  log }`, with `message` (fplMessage's) also `request` (the body of POST /filing) and `head` (`{ ident,
  adep, eobt, ades, dof, route }`), `cancelMessage` (the CNL a faxed plan's cancellation carries) and
  `typedAddress` (the typed AFTN address, null when it is not one) [exports/fpl/filing.ts, which
  FilingPanel.tsx renders]. `PGF.filingDelay({ state, eobt?, now? })` → `{ problem, message, via, start }`:
  why a delay to `eobt` cannot be sent (the server's limits, src/shared/briefing.ts FILING_EOBT_*), and the DLA
  a fax carries [shared/icaoMessages.ts], who sends it, and `start`, where the delay form starts (the
  filed EOBT, or now once past, to the minute); the website's Delay form uses the same model. `PGF.filingError({ offline?, message?, load? })` → `{ text }`:
  a refusal (or a failed load) as the panel words it.
- `PGF.navlogContent(…)` → `{ document, content }`: the navlog page's `{ sheets, terminal, warnings,
  sources }` and the body of POST /api/flights/:id/exports/navlog/email [exports/navlog/model.ts
  navlogDocumentOf, shared/navlogSheets.ts navlogContentOf].
- `PGF.wbPerfContent(…)` → `{ wb, perf, content, warnings, text }`: the W&B and performance sheet
  models (with `verdict`), `content` the body of POST /api/flights/:id/declarations/send, `text` what
  the server hashes (SHA-256, base64url) to tell the sheets changed since sent [exports/wbperf/declaration.ts
  wbPerfOf, exports/wb/exportCalc.ts].
- `PGF.formModel({ kind: '731' | 'gendec', flight, aircraft?, pilot, passengers?, ref? })`: Form 731 or
  the General Declaration as the forms pages fill them, with `warnings` and their `fixes`
  [exports/form731/model.ts, exports/gendec/model.ts].
- `PGF.briefingModel({ flight, briefing })`: the NOTAM briefing laid out for print
  [exports/briefing/model.ts].
- `PGF.form731Panel({ forms, links?, origin?, now? })` → `{ needed, allSigned, summary, tone,
  signatures, people, request, emailAll, send, sent, note, emailEnabled }`: the Form 731 signatures
  panel for GET /forms. `people[]` is `{ key, role, name, signed, needsResign, status, email, emailed,
  actions: { renew, revoke, email, addEmail }, addEmailPath, link }`; `link` (`{ url, text }`, the
  signing page and what is shared with it) for the tokens in `links` (the `links` of the answer that
  made them); `signatures` by key are drawn on the sheet; `send` is `{ label, enabled, hint }`
  [exports/form731/signatures.ts].
- `PGF.genDecPanel({ forms, handled? })` → `{ status, tone, send, sent, note, ends, handled, automatic,
  signature, pilotSends, override }`: "Send to HCAA" of the GenDec (`send` null when a handler submits
  it); `override` is what POST /forms/gendec/handled takes for "Submitted by a handler" set to
  `handled` [exports/gendec/send.ts].
- `PGF.operatorPanel({ declarations, hash?, ready? })` → null, or `{ title, status, tone, changed, send:
  { label, enabled, hint, resend }, address, addressPath, sent, note }`: "Send to <operator>"; `hash` is
  the shown sheets' (SHA-256, base64url, of `wbPerfContent`'s `text`) [exports/wbperf/send.ts].
- `PGF.declarationText({ content })` → `{ text }`: what the server hashes of sent sheets (the fixture
  server's "changed since sent") [shared/declarations.ts].

The PDF page (`Resources/pdf/sheets.html`, `npm run native:pdf`, src/pdf/main.tsx) draws Form 731
(kind `form731`: `formModel`'s with `signatures`) and the General Declaration (kind `gendec`, with the
PIC's `signature`) with the website's sheet components. The images the components name by path
(the signatures' watermark, public/icon.svg) are inlined as data: URLs: the web view loads nothing.

**Hangar** (src/native/core/hangar.ts)

- `PGF.validateAircraft({ aircraft, today?, cardWarnDays?, path?, exact?, now? })` → `{ issues, errors,
  missing, at }`: the issues bar's `{ level, section, path, message }` (errors refuse the save), the
  essentials not set, and one field's issues when `path` is given [hangar/model.ts].
- `PGF.aircraftHelpers({ op, … })`: the editors' helpers [hangar/model.ts, shared/templates.ts]. Read:
  `codes`, `split10a { text }`, `join10a { codes }`, `split10b { text }`, `join10b { ssr, ads }`,
  `badPbn { text }`, `item18Dropped { aircraft }`, `cardStatus { card, today?, warnDays? }`, `deviation
  { forDeg, steerDeg }`, `blankCard`, `momentPolygon { polygon, steps? }`, `polygonCheck { polygon,
  point? }`, `blank`, `sameTypeCopy { aircraft, registration }`. Change (the changed copy comes back):
  `addCompassCard { aircraft, today? }`, `addStation { massBalance, kind }`, `setStationKind`,
  `removeStation`, `addSeat`, `removeSeat`, `addCombinedLimit`, `addUtilityEnvelope` (on
  `massBalance`), `setArmRange { station, end, value }`, `addFuelType`, `removeFuelType`,
  `makePrimaryFuel` (`{ fuel, type }`, with `others`), `addRunwayCondition`, `setRunwayConditions`
  (`factors`), `addStallSpeeds { performance }`, `takeoffTable { table, edit, index?, row? }`,
  `landingTable { table, edit, index? }`.
- `PGF.newAircraft({ hangar, registration?, source?, copyOf?, operator? })` → `{ options, source,
  registration, taken, input, error, conflict, added, addedDefault }`: the Add aircraft dialog
  [hangar/add.ts]. `hangar` is GET /api/aircraft; `source` `{ kind: 'template' | 'copy' | 'blank', id? }`
  (default: `copyOf`'s type, else the first template); `options` the Start from choices `[{ source,
  title, description }]`; `input` the body of POST /api/aircraft, null while `error` (no registration,
  or one of the pilot's own aircraft has it: `taken`) holds it back. A copy with an operatorId: pass
  `operator` (GET /api/operators/:id, null when it could not be read) and the copy keeps it only when
  the pilot may assign it. `conflict` is the server's 409 in words; `added` and `addedDefault` the
  toasts (the server makes the new aircraft the default when the pilot has none).
- `PGF.historyText({ entries, myId, versionChanges? })` → `{ entries: [{ title, changes, summary }],
  versionChanges }`: the version history in words [shared/aircraftHistory.ts].

**Sharing** (src/native/core/share.ts)

- `PGF.sharing({ kind?, sharing, myId, email?, role?, passengers? })` → `{ canManage, role, rows,
  roles, suggestions, error, body }`: the share dialog of an aircraft (default), operator or flight
  [hangar/shareModel.ts]. `passengers`: a flight's manifest contacts (`PGF.shareSuggestions`'
  `contacts`); `suggestions` those it is not shared with yet, for whoever manages the sharing.
  `sharing` is GET …/:id/shares; `rows` `[{ key, role, name, email, initial, self, pending, note, via,
  control, roleLabel, removeLabel, canRemove }]` (`key` the pilot id or the invited address, the
  `:key` of PUT/DELETE …/shares/:key; `control` 'owner' | 'aircraft' | 'manage' | 'readOnly');
  `error` or `body` (POST …/shares) for the add form's `email` and `role`.
- `PGF.sharedChip({ access, kind? })` → `{ chip: { text, title } | null }`: "Shared by Alice ·
  Viewer"; with `kind: 'flight'` a flight's "View only · shared by Alice" [editor/EditorPage.tsx].
- `PGF.unshareOffer({ sharing, email, myId, name })` → `{ offer, title, confirm, cancel }`: after a
  passenger leaves the manifest, whom to offer to stop sharing the flight with (`{ name, key }` or
  null) and the question's words [editor/panels/ManifestSection.tsx].
- `PGF.invite({ hangar?, invitations?, email?, note?, picked?, response? })` → `{ shareable,
  invitations, error, body, done }`: Invite pilots. `shareable` the aircraft the pilot owns or edits;
  `invitations` GET /api/invitations as rows `{ id, email, initial, aircraft }` ("SX-ASV (Viewer)");
  `body` POST /api/invitations for `email`, `note` and `picked` ([aircraftId, role] pairs); `done` the
  line after it, from its `response`.

**People** (src/native/core/people.ts)

- `PGF.personIssues({ form? | person?, pilot?, today?, now? })` → `{ form, issues, input, missing }`:
  the passenger (or profile) form's `[{ field, message }]`, the body it saves (null while there are
  issues) and what the forms and W&B still lack, `[{ field, label }]` (the passenger list's
  "Missing …") [passengers/person.ts].
- `PGF.parseCoords({ text?, name? })` → `{ latLon, dms, icao, name }` [waypoints/coords.ts].
- `PGF.parseTyped({ kind, text, min?, max?, step? })`: `time` → `{ value }` (HH:MM or null),
  `duration` → `{ value, field }`, `date` → `{ value, problem, masked }`, `slot` → `{ value }`,
  `routePoint` → `{ value }` (a route point name, '' when invalid) [shared/typedInput.ts,
  editor/map/snap.ts].

New route points and ATC rows get random uids; JavaScriptCore has no Web Crypto, so the core gives
`uid()` a Math.random source when it is missing.

## Offline

On opening a flight with a connection, the app saves to its container: the flight, the aircraft, the
pilot, the saved waypoints, `ref`, the weather answers, the NOTAM briefing and the terrain grid
(public/terrain/greece.bin is also built into the app, for a first launch offline). The relevant NOTAMs marked
read are kept per flight, by their keys, as the website keeps them. It also downloads an
MLNOfflineStorage pack: the route's bounding box plus 15 NM, zooms 6–11, for the base style. Fly mode
works from these with no connection.

## Release

Same bundle id (com.pigsgottafly.app) and App Store Connect record (6837510399) as the Capacitor shell it
replaced. `npm run ios:upload` (README, "iPhone and iPad app"); the listing, the review notes and the
screenshots are in `native/ios/AppStore/`.
