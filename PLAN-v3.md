# Pig's Gotta Fly v3: a complete VFR flight planner

One pilot (me) for now. Every record is owned by a pilot account, so other pilots can be added later without reshaping the data. Windy is dropped: routes are drawn on our own map, and weather comes straight from the sources.

## Screens

### Lobby
As today (Google Docs style): search, upcoming flights first, ⋮ menu (Open, Rename, Make a copy, Move to trash). **New flight** opens the editor with home airfield → home airfield, the default aircraft, and my taxi times.
Top-right account menu: **Profile**, **Hangar**, **Passengers**, **My waypoints**, Sign out.

### Flight editor (the map)
- Full-window map of LGGG with zoom/pan. The left panel has the flight's own details:
  - **When**: date and block-off time (UTC, with local time shown alongside), taxi out and taxi in minutes (copied from my profile on creation, editable per flight). Shows take-off, landing and block-on times.
  - **Aircraft**: picked from the hangar.
  - **Manifest**: PIC (me) plus PAX, added from my passenger list with a type-ahead, or created on the spot. Seat per person, used for W&B.
  - **Fuel**: required (computed), fuel on board (default required + 1 h, from my profile; editable), with a warning above usable capacity.
  - **ATC**: generated list (callsign, primary, backup), editable: add, remove, edit, reorder, and "regenerate".
  - **Exports**: navlog, Form 731, General Declaration, flight plan (AFTN), W&B, take-off/landing performance.
- **Drawing the route**: click to add points; a rubber-band line follows the cursor and **snaps** to the nearest aerodrome or VFR reporting point (or my saved waypoints) within a few pixels. Shift-click (or double-click to name) places a **custom waypoint** for this flight, e.g. ZOFRI. Drag a point to move it, drag a leg's midpoint to insert one, right-click/⌫ to delete. Undo/redo as now.
- **Leg labels** sit on each line like a VFR chart: `062° 14 NM` (magnetic course, distance: not editable) and the altitude, `A030` (click to edit in place). Altitude default: charted VFR route altitude; otherwise the rule we use now, with custom points taking the altitude of the closest charted leg.
- A collapsible **navlog strip** at the bottom shows the computed legs live (wind, WCA, GS, ETE, fuel), with weather warnings.

### Profile
Full name, phone, licence number, nationality (for the forms), home airfield (LGTT, changeable), default aircraft, taxi out/in (15/15), fuel reserve on top of required (60 min), wind model.

### Hangar
One page per aircraft. SX-ASV and SX-ASG are seeded:
- Identity: registration, make and model, ICAO type designator, wake category, colours and markings, home base.
- Flight plan items: equipment (item 10a/10b), PBN, item 18 extras, survival/emergency equipment (item 19: radios, life jackets, dinghies, colour).
- Speeds: cruise TAS (92 kt), traffic pattern TAS (80 kt), climb.
- Fuel: total and usable capacity, fuel type and density, burn (taxi, climb, cruise).
- Mass & balance: empty mass and arm (from the latest weighing report), stations (front seats, rear seats, baggage areas, fuel) with arms and limits, MTOW/MLW, **Normal and Utility category envelopes** (polygons), and moment limits.
- Performance: take-off and landing tables (POH: distance vs pressure altitude, temperature, mass, with the POH corrections for wind, slope and surface).
- Compass swing: one or more cards (magnetic compass, GMU…) with the for/steer table, date swung, expiry (warned within 90 days, as today), and the swing report attached.

### Passengers
List with full name, phone, date of birth, weight, ID document number (plus nationality, needed by the forms). Add, edit, delete, search.

## Calculations (one pure module, unit-tested against an independent reference, like today's oracle)
- Geometry: great-circle true course and distance; **magnetic variation from the World Magnetic Model at the leg midpoint and flight date** (instead of a fixed 5°E). Magnetic course on the map, as on VFR charts.
- Times: block-off + taxi out = take-off; legs flown in sequence; landing + taxi in = block-on. First and last legs at pattern speed, the rest at cruise.
- Wind per leg at the leg midpoint, altitude and mid-leg time (Open-Meteo, as now): WCA, TH, MH, CH (compass card), GS, ETE, fuel per leg from the aircraft's burn. Rounding rules stay as on the paper sheet.
- Fuel: taxi + trip + reserve = required; FOB default = required + 1 h.
- W&B: take-off and landing mass and CG from the manifest weights, seats and fuel; checked against both envelopes.
- Performance: runway picked from the forecast/actual wind; head/tailwind and crosswind components, pressure altitude from QNH and elevation, temperature, slope. TODR/LDR from the POH tables with factors, compared with TODA/LDA from the AIP.
- Weather sources: Open-Meteo for winds aloft and surface; METAR/TAF from aviationweather.gov through our API, where the aerodrome reports them.

## Exports (print-ready A4 pages, browser print → PDF, as the navlog is now)
- (a) **Navlog**: today's MD4.2 sheet, fed from the new flight model.
- (b) **Form 731**: filled with PIC and every passenger's details. *Needs the blank form.*
- (c) **General Declaration**: ICAO Annex 9 Appendix 1 layout, crew + passengers.
- (d) **Flight plan**: ICAO 2012 FPL message ready to paste into AFTN/ARO (items 7–19: registration, VFR/G, type/wake, equipment, departure and time, speed N0092, level VFR, route via points/coordinates, destination and EET, alternates, item 18 DOF/REG/RMK, item 19 endurance from FOB, persons on board, equipment, aircraft colours, PIC name and phone), plus a filled form view.
- (e) **W&B**: loading table and CG envelope chart (normal and utility) with take-off and landing points.
- (f) **Performance**: per departure and destination: runway, components, PA/DA, TODR/TODA and LDR/LDA with the margin.

## Data model (Postgres; tenancy = `pilot_id` on every owned row)

| Table | Owned by | Notes |
|---|---|---|
| `pilots` | – | The account (Google sign-in) and profile: name, phone, licence, home aerodrome, defaults (`settings` jsonb). |
| `sessions` | pilot | Hashed tokens (as now). |
| `aircraft` | pilot | Columns for identity and speeds; `fuel`, `mass_balance`, `performance`, `equipment`, `compass_cards` as versioned jsonb documents, validated in code. |
| `passengers` | pilot | Person records. |
| `flights` | pilot | Date/time, aircraft, taxi times, FOB, title, `route` (ordered points: a reference to an aerodrome/VFR point/my waypoint, or an inline custom point; per-leg altitude overrides), `atc` (the edited list), `version`, trash. |
| `flight_crew` | via flight | Manifest rows: role (PIC/PAX), passenger id, seat, and a **snapshot** of their details at the time, so old forms stay correct after edits. |
| `waypoints` | pilot | My saved custom points (a flight's one-off points live in its route until saved). |
| `ref_aerodromes`, `ref_runways`, `ref_airspaces`, `ref_waypoints`, `ref_atc_units` | shared | Reference data from each AIRAC (aerodromes with runway headings, slopes and declared distances; TMAs/CTRs; VFR points and routes; ATC callsigns and frequencies), tagged with the AIRAC cycle. Loaded by a script, not edited by pilots. |

ATC per flight = generated from `ref_atc_units` (departure, destination, en-route aerodromes, TMAs entered, FIS) then stored on the flight as edited by me.

## Architecture
- **TypeScript + Vite + React** for the client; the calculation and weather modules as plain TS shared with the API and tests. The app outgrows one 1,400-line file once it has a map editor and five more screens.
- **MapLibre GL** map: an open base map, with our own vector layers drawn in VFR chart style (CTR/TMA outlines and labels, aerodromes, reporting points, VFR routes with altitudes). These layers also drive snapping. The openflightmaps raster overlay is optional, for familiarity.
- **API**: Vercel functions as now (`/api/…`), REST per entity, every query scoped by the session's pilot. Postgres on Neon; PGlite locally and in tests. Numbered SQL migrations instead of create-on-start.
- Tests: the unit oracle extended to the new calculations; the CDP end-to-end harness kept (drawing a route by clicking, exports checked page by page).

## Phases
1. **Foundation**: TS/Vite/React shell, migrations and the new tables, API per entity, lobby, profile, hangar (identity, speeds, fuel), passengers. Existing flights migrated.
2. **Map editor**: MapLibre with the LGGG reference layers, route drawing with snapping, custom waypoints, leg labels with editable altitude, manifest/aircraft/time panels.
3. **Calculations and navlog**: WMM variation, weather, times, fuel, ATC generation and editing, navlog export (a).
4. **Forms**: flight plan (d), General Declaration (c), Form 731 (b).
5. **W&B and performance** (e, f): hangar mass & balance and performance editors, AIP runway data (declared distances, slopes), METAR/TAF.

## What I need from you
- SX-ASV and SX-ASG: make/model, the latest weighing report (empty mass and arm), the POH mass & balance section (stations, envelopes), the POH take-off/landing performance charts, fuel capacity and burn, equipment list, and colours.
- Form 731: the blank form (PDF or photo), and what it is filed with.
- Licence number and nationality, if they should appear on the forms.

## Additions (15 Nov 2026)

### Weather hazards along the route
- For every leg, at its planned time and altitude, and for departure/destination at take-off/landing time: flag **thunderstorms** in the vicinity (Open-Meteo `weather_code` 95–99 and high CAPE near the leg; TAF/METAR `TS`, `CB`) and **visibility below 10 km** (Open-Meteo `visibility`; TAF/METAR visibility groups).
- "Vicinity": sample the leg corridor (e.g. every ~10 NM along the leg and ±5 NM either side) within ±1 h of the leg's time.
- Show warnings on the map (highlight the affected leg/area), in the navlog strip, and on the navlog export; say the source and forecast time. Unit-tested with recorded fixtures.

### NOTAMs relevant to the flight
- Load NOTAMs for the departure, destination and en-route/nearby aerodromes and for the FIR (LGGG), from the autorouter briefing API once API access is granted (it is requested), with a fallback source that needs no key if one is available; cache per flight.
- Keep only what is relevant: effective during block-off → block-on (with a margin), Q-line position/radius intersecting the route corridor or the aerodromes used, vertical limits overlapping the planned altitudes (VFR, typically below FL100), and not IFR-only items (e.g. approach procedures) unless they concern the aerodromes used. Show a count of hidden ones with "show all".
- Display: a NOTAM panel in the editor (decoded where possible, raw text always available) and areas drawn on the map; include them in a briefing export.

### Filing the flight plan via autorouter
- Server-side autorouter API client using the app account credentials (Vercel secrets AUTOROUTER_EMAIL / AUTOROUTER_PASSWORD; OAuth client credentials). API access has been requested from autorouter; until granted, the feature must show a clear "filing not enabled yet" state.
- AFTN addressees for Greek VFR plans generated from AIP Greece ENR 1.11 (and ENR 1.10/1.2.13 rules) per route — departure ARO/ATSU, FICs (ATHINAI/MAKEDONIA), TMAs/CTRs and military units affected — shown to the pilot for review and passed in the `addresses` field.
- File / Delay / Cancel buttons on the flight plan export; status (filed, manual correction, rejected, …) polled and stored on the flight; DEP/ARR messages optional. Every action logged per pilot. Tests mock the autorouter API; nothing is filed for real in tests.

### Map interaction for weather and NOTAMs
- Weather hazards (thunderstorm areas, low-visibility areas, per-leg winds/hazard markers) and NOTAM areas/points are drawn as map layers that can be toggled.
- Hovering shows a compact tooltip (e.g. "TS forecast 10:40–11:30Z, ECMWF" or the NOTAM's ID, validity and limits); clicking opens a details popover with the full decoded content, raw text and source/time, and highlights the affected leg in the navlog strip.
