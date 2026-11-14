# Navlog web tool — plan

> Status: implemented. See README.md. Decisions taken after this plan was written:
> winds from Open-Meteo (ECMWF default, no Windy key available); ETE = leg time `0:04`, ETA and FUEL REM left blank;
> "passing over" radius 2 NM; FIS ATHINAI + MAKEDONIA always listed; AIP checksum did not verify (flagged in the app).

A static, offline-capable single-page app (`index.html` + `app.js` + `data/*.js`) that fills in the
MD4.2 "Flight Planner" nav log and prints it on one A4 landscape page laid out like the paper form.
No build step; open `index.html` or serve the folder with `python3 -m http.server`.

## 1. Route input (Windy)
- Paste a Windy route-planner URL (`https://www.windy.com/route-planner/vfr/LAT,LON;LAT,LON;...?yyyy-mm-dd-hh`,
  also the older `/distance/vfr/` form). The app parses the waypoints; the `?yyyy-mm-dd-hh` suffix pre-fills the date.
- Button that opens Windy's route planner in a new tab (centered on Greece) to draw the route, and a button to
  re-open the current route on Windy.
- True course (initial great-circle bearing) and distance (NM) per leg are computed from the waypoint
  coordinates — the same geometry Windy uses for its leg readouts.
- Waypoints are auto-named: an aerodrome within 2 NM gets its ICAO code/name from the AIP, otherwise `WP n`.
  Every name is editable inline.

## 2. Inputs per flight
- Date (printed top right, outside the boxes), block start (UTC, HH:MM).
- Aircraft: SX-ASV, SX-ASG, or free text (no deviation card → DEV 0, with a warning).
- Per-leg altitude (ft) and plan TAS (default 80 kt on first and last leg, 92 kt otherwise; editable).
- Every computed cell can be overridden by typing over it.

## 3. Winds aloft
- For each leg: position = leg midpoint, time = estimated time at that midpoint (block start + taxi + elapsed).
- Forecast wind direction/speed and temperature at the leg altitude, interpolated between pressure levels using
  geopotential height. Source: Windy Point Forecast API when a key is configured; otherwise Open-Meteo
  (free, same ECMWF/GFS models). See open question below.
- Timeline is iterated (wind → GS → times → re-fetch) until stable.

## 4. Computations
- WCA = asin(W·sin(WD−TC)/TAS), TH = TC + WCA, GS by the wind triangle.
- VAR = 5°E (form convention "−E +W" → MH = TH − 5).
- DEV from the aircraft compass card by linear interpolation of the 12 "For/Steer" points; CH = MH + DEV.
  - SX-ASV card dated 05/02/2026, expires 2028-02-05.
  - SX-ASG card dated 06/02/2025, expires 2027-02-06. (GMU card also stored for reference.)
  - Warning banner when the flight date is within 90 days of, or past, expiry.
- ETE per leg = leg time rounded to nearest minute, shown `0:04`.
- ATE column = remaining time to destination (sum of rounded ETEs of later legs; last leg `0:00`).
- DIST LEG; DIST REM = distance remaining after the leg (last leg `0`).
- FUEL USED per leg = ceil(exact leg minutes × 0.5 L); totals sum the rounded-up values, plus 4 L for
  start-up/taxi/take-off/landing (shown as its own line).
- ATA left blank. TAKE-OFF, BLOCK END, ATIS, SKY, TEMP, WIND, QNH, RUNWAY left blank for in-flight use.
- Totals row: distance, time, fuel; rightmost box shows `SUNSET hh:mmZ` at the destination (NOAA solar
  algorithm, computed locally for the destination ARP and date).

## 5. Terminal information (from the Greek AIP, AIRAC AMDT 09/26, wef 29 OCT 2026)
- Rows for: departure, destination, and every aerodrome the route passes over (within 5 NM of a leg).
- Field (ICAO + name), elevation (ft), runways as `03/21` pairs, radio frequencies: primary and
  secondary/backup where the AIP lists one (TWR/AFIS/INFO, GND, ATIS).
- Greek TMAs the route enters (lateral polygon + vertical limits vs. planned altitude), with their frequency.
- ATHINA INFORMATION and MAKEDONIA INFORMATION frequencies (sector by position where the AIP allows).
- All rows editable; add/remove rows manually.

## 6. Data extraction
- AIP AD 2 (≈40 aerodromes) and AD 1.6 CAT B (≈44 aerodromes): ARP, elevation, runways, frequencies.
- ENR 2.1: TMA lateral/vertical limits and units/frequencies; FIS frequencies.
- Extracted by script from `pdftotext -layout`, then reviewed by hand; stored in `data/aip.js` with source
  section references so values can be audited.

## 7. Output
- Screen: form-like editable view with a side panel for inputs.
- Print: `@page A4 landscape`, the grid reproduces the paper form (9 leg rows + departure/arrival + totals,
  terminal information block, notes).
- State saved in localStorage; export/import JSON.

## 8. Verification
- Unit tests for geometry, wind triangle, deviation interpolation, rounding/summing rules, sunset (vs. a
  known almanac value), URL parsing.
- Spot-check AIP data for several aerodromes against the PDFs.
- Headless browser run of an example route (e.g. LGMG → LGKC → LGMG) with print-to-PDF check.
