# Pig's Gotta Fly

Pig's Gotta Fly (https://pigsgottafly.com) fills in the MD4.2 "Flight Planner" nav log and prints it on one A4 landscape page, laid out like the paper form.

Live at https://pigsgottafly.com. To run it locally: `npm install`, `npm start`, and open http://127.0.0.1:8765/. An internet connection is needed only for weather.
The server sends no-cache headers, and asset links carry content hashes (`npm run stamp`), so a browser never mixes old and new files.

## Use

`npm start` serves Pig's Gotta Fly at http://127.0.0.1:8765/. Flights are stored in `server/pgdata/` (PGlite).

**My flights** (home): **Blank flight**, **From Windy route** (paste the route-planner link), and the list of flights, upcoming first. Each row's ⋮ menu has Open, Open in new tab, Rename, Make a copy and Move to trash (with Undo). The search box filters by name, date and aircraft.

**A flight** has its own link (`/#/f/…`) that opens it ready to edit on any signed-in device. It saves as you type ("Saved" next to the title). Offline edits are kept on the device and sent when the connection returns. Click the title to rename it; by default it is the route, e.g. `LGMG → LGEL → LGMG`.

- **File**: New flight, Make a copy, Open route in Windy, Print, Download file, Open file…, Move to trash
- **Edit**: Undo, Redo, Reverse route, Restore removed rows (shown when there are any), Clear my edits
- **Flight**: Change route…, Refresh weather, Settings… (compass card, wind model, taxi minutes, variation, fuel, aerodrome radius)

Date, block time, aircraft and Print stay in the top bar. New flights start with the aircraft and settings you used last.

### Hosting (pigsgottafly.com)

Production runs on Vercel: the files are served as static assets and `/api/…` runs as one function (`api/index.mjs`), with flights in Postgres (Neon). Each pilot signs in with Google and sees only their own flights.

- Environment (Vercel project settings): `DATABASE_URL` (set by the Neon integration), `GOOGLE_CLIENT_ID`, and optionally `ALLOWED_EMAILS` (comma-separated) to limit who can sign in.
- Create the client ID in Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web application), with `https://pigsgottafly.com` under *Authorized JavaScript origins*.
- Deploy: `vercel deploy --prod`. The schema is created on first use (`api/_lib/db.mjs`).
- Locally, `npm start` uses PGlite (Postgres in-process, data in `server/pgdata/`) and needs no sign-in; set `DATABASE_URL` and `GOOGLE_CLIENT_ID` to run against a real database with accounts. The tests use an in-memory PGlite.
- Flights from the old SQLite version: sign in once, then `DATABASE_URL=… node tools/migrate_sqlite.mjs you@gmail.com`.

Editing:
- Clicking a cell selects its contents, so typing replaces them.
- **Ctrl/⌘+Z** undoes; **Ctrl/⌘+Shift+Z** or **Ctrl+Y** redoes. All keystrokes in one cell count as one step.
- Each sheet has its page number in a circle beside the date. Whole-flight totals appear on every sheet.

Header weather (forecast, METAR style):
- The **TEMP** (`15/08`, `M02/M06`), **WIND** (`23008KT`, calm `00000KT`) and **SKY** boxes show the departure field at block time on the first sheet.
- On the last sheet of a multi-sheet log, they show the destination at the estimated landing time.
- SKY is the lowest cloud layer of 1 okta or more below 5000 ft (e.g. `FEW027`; the base is estimated from the temperature–dewpoint spread at ~400 ft/°C). Otherwise it reads `NSC` if there is any cloud, or `SKC` if clear.

VFR reporting points and routes (all 21 eAIP VFR route charts, plus open flightmaps):
- A waypoint within 1.5 NM of a VFR reporting point takes its name, unless an aerodrome lies within 1 NM. The 446 points cover every chart, plus the rest of Greece via open flightmaps.
- A leg joining two reporting points along a charted VFR route gets the charted altitude as its default (blank if not charted; you can always type over it). Direction-specific altitudes (arrowed labels) and one-way routes apply only in their direction.
- 329 route segments on 17 charts: LGAV, LGBL (partial), LGKL, LGKO, LGKP, LGKR, LGKV, LGMK, LGMT, LGPA, LGRP, LGSA, LGSK, LGSM, LGSR, LGSY, LGTS.
- Names only, no route altitudes: LGTG (military / light-aircraft routes), LGIR, LGLR, LGAD. Each chart file in `tools/vfr_charts/` lists in its notes which legs were left out and why.
- How the data was produced and checked:
  - Coordinates come from the AIP where printed (text tables, or transcribed from the chart images); otherwise from open flightmaps.
  - Altitudes are read from the chart images: zoomed crops, Tesseract OCR, then by eye.
  - Each chart image is georeferenced (`tools/vfr_chart.py`: symbol detection + OCR, matched to known points, RMS 0.02–0.1 NM). Transcribed coordinates must land on a chart symbol or on the open flightmaps point.
  - Every route's printed distance must match its endpoints' coordinates. That check caught three misreadings during transcription.
  - Points that disagree are reviewed on an overlay (`tools/vfr_verify.py`) and recorded in the chart file.

## What it computes

| Column | Rule |
|---|---|
| TRUE COURSE, DIST LEG | Great-circle initial course and distance between the Windy waypoints, rounded to whole degrees and NM |
| PREDICTED WIND, TEMP | Forecast at the leg midpoint and leg altitude, at the estimated mid-leg time (block start + start-up/taxi minutes + elapsed). Interpolated between pressure levels by geopotential height, and between hours |
| WCA (−L +R), TRUE HDG | Wind triangle, using the values as written on the sheet |
| VAR | 5°E, written `-5` per the form's "−E +W" convention |
| DEV, COMPASS HDG | Linear interpolation of the aircraft's compass card ("For" = magnetic heading, "Steer" = compass heading); CH = MH + DEV |
| ETE | Leg time rounded to the nearest minute, shown as `0:04` |
| ATE | Time remaining to destination after the leg (sum of the later legs' ETEs); `0:00` on the last leg |
| DIST REM | Distance remaining after the leg; `0` on the last leg |
| FUEL USED | Leg time × 30 L/h, always rounded **up** to a whole litre |
| TOTALS | Sum of the leg distances and of the rounded ETEs. Fuel is the sum of the rounded-up leg fuels plus 4 L for start-up/taxi/take-off/landing (breakdown in Notes). Rightmost box: `SUNSET hh:mmZ` at the destination (NOAA algorithm, rounded down) |
| Left blank | ETA, ATA, GS ACT, FUEL REM, VOR, squawk, and the ATIS/QNH/runway/take-off/block-end header boxes |

Each value is rounded where it is written, and later columns are computed from the written numbers, so the sheet can be re-checked by hand.

**Winds** come from Open-Meteo (free, no key). The default model is ECMWF IFS 0.25°, which is the model Windy shows by default; GFS and ICON are also available.
Windy's own point-forecast API requires a paid key. Forecasts reach about 15 days ahead.
If a leg has no wind, the sheet uses calm wind and the screen shows a red warning.

**Compass cards**:

| Aircraft | Swung | Expires |
|---|---|---|
| SX-ASV | 2026-02-05 | 2028-02-05 |
| SX-ASG | 2025-02-06 | 2027-02-06 |

SX-ASG also has its GMU card, selectable under ⚙.
A chip and a line in Notes appear when the card expires within 90 days of the flight date, or has already expired.

## Terminal information

Generated from the Greek eAIP, AIRAC AMDT 09/26 (wef 29 OCT 2026). It lists:
- the departure aerodrome, the destination aerodrome, and every aerodrome within 2 NM of the route (radius adjustable);
- for each aerodrome: elevation (feet, written as a plain number), runways as `03/21`, and frequencies per unit. Each unit shows its primary frequency, then one backup (secondary/RGA). Units sharing the same frequencies are merged (`TWR/APP`);
- every TMA / MTMA a leg enters at its planned altitude, with its vertical limits and frequencies (e.g. ATHINAI TMA INFORMATION 124.025/131.175 for VFR);
- ATHINAI INFORMATION / MAKEDONIA INFORMATION (FIS) 130.925 / 130.700 / 119.750. Both are always listed.

Caveats:
- Lower limits given as "ft AGL" are compared as if MSL. This errs towards listing an airspace.
- Where a TMA edge follows the Istanbul or Tirana FIR boundary (Chios, Mitilini, Samos, Kerkira), the AIP gives no coordinates for that edge. It is drawn outside the FIR, so the TMA is over-approximated.
- Closed CAT B aerodromes are excluded, and water aerodromes are not auto-listed.
- **The AIP archive in `aip/` did not match either checksum provided.** The data has not been verified against a known-good copy, so cross-check it against the official AIP before relying on it.

### Regenerating the AIP data

```sh
cat aip/aipgr_*.zip.0* > /tmp/aip.zip && unzip /tmp/aip.zip -d /tmp/aip && bsdtar -xf /tmp/aip/*.iso -C /tmp/aip/iso
cd "/tmp/aip/iso/ais/eaip/pdf" && mkdir -p /tmp/aip/txt
for f in "AD 2"/AD2-*/LG_AD_2_LG??_en.pdf "AD 1/AD 1.6 CAT B AERODROMES/catb"/*.pdf; do pdftotext -layout "$f" "/tmp/aip/txt/$(basename "$f" .pdf).txt"; done
python3 -I tools/parse_ad.py /tmp/aip/txt /tmp/aip/ad_raw.json
python3 -I tools/build_aip.py /tmp/aip/ad_raw.json data/aip.js
npm test && npm run test:e2e
```

- VFR: `parse_vfr.py` (text coordinate tables), `fetch_ofm.py 2611` (open flightmaps), `known_points.py`, `vfr_chart.py` (georeference each chart image; needs `tesseract`), `build_vfr.py tools/vfr_points.json tools/vfr_charts tools/vfr_ocr tools/ofm_points.json data/vfr.js` (merge + checks).
- `parse_ad.py` extracts aerodromes (ARP, elevation, runways, AD x.18 frequencies).
- `build_aip.py` adds the TMA/MTMA/FIS definitions transcribed by hand from ENR 2.1 (arc centres from ENR 4.1), plus a few manual corrections.

## Files

- `api/_lib/api.mjs`: flights API and Google sign-in; `api/_lib/db.mjs`: Postgres schema and driver (Neon or PGlite); `api/index.mjs`: the Vercel function; `server/server.mjs`: local server; `js/store.js`: client storage and sync
- `index.html`, `css/style.css`: app shell and form replica (print: A4 landscape)
- `js/nav.js`: geodesy, wind triangle, deviation, rounding/sums, sunset, Windy URL parsing (pure; unit-tested)
- `js/weather.js`: Open-Meteo fetch and height/time interpolation
- `js/aircraft.js`: compass cards
- `js/app.js`: UI and sheet
- `data/aip.js`: generated AIP data
- `tests/unit/`: `npm test` (geometry, rounding, cards, sunset, AIP data checks)
- `tests/e2e/`: `npm run test:e2e`. Runs complete flight plans in headless Chrome over CDP, plus Firefox over WebDriver BiDi (skipped if Firefox isn't installed). No dependencies; `CHROME=` / `FIREFOX=` override the browser binaries.
  - Open-Meteo is mocked, so every cell is checked exactly against an independent reference calculation (`tests/e2e/oracle.mjs`).
  - A layout audit fails on clipped text, overflowing labels, scrollbars, or a sheet that doesn't fit the window, on screen and in print.
  - PDFs are checked for page count and A4 landscape.
  - Screenshots and PDFs land in `tests/e2e/artifacts/`.

## Data sources

- Aerodromes, airspace, VFR charts and sunset tables: AIP Greece (eAIP), Hellenic Aviation Service Provider. Not for operational use without checking the current AIP and NOTAMs.
- VFR reporting points not printed on the AIP charts: [open flightmaps](https://www.openflightmaps.org) (region LGGG).
- Weather: [Open-Meteo](https://open-meteo.com) (ECMWF IFS by default).
- Font: [Inter](https://rsms.me/inter/), SIL Open Font License (`fonts/OFL.txt`).
