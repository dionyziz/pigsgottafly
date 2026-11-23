# Updating Pig's Gotta Fly for a new AIP (AIRAC) cycle

Everything AIP-derived lives in `data/` and is generated. One script does the mechanical part; a few things need a human look.

## 1. Run the update

```sh
tools/update_aip.sh ~/Downloads/new-aip  2612  "AIRAC AMDT 10/26 (wef 26 NOV 2026)"
```
- the first argument is the folder holding `aipgr_*.zip.001…`
- `2612` is the AIRAC cycle, used for the open flightmaps download
- the label is shown in Settings → About

It prints the archive SHA-256 (compare it with the published checksum), tests the zip, extracts the ISO and rebuilds:

| Output | From | Tool |
|---|---|---|
| `data/aip.js`: aerodromes (ARP, elevation, runways, frequencies) | AD 2, AD 1.6 | `parse_ad.py` → `build_aip.py` |
| `data/aip.js`: TMAs / MTMAs / FIS | ENR 2.1, ENR 4.1 (**hand-transcribed** in `build_aip.py`) | `build_aip.py` |
| `data/sun.js`: sunset | GEN 2.7 | `parse_sun.py` |
| `data/vfr.js`: VFR points (with their charts and AIP references) and route altitudes | the VFR charts (AD 2-LGxx-VFR, AD 1.6.N-LGxx-VFR) and their coordinate tables, the heliports' reporting points (AD 3.N.21), ENR 4.4 for IFR fixes a chart prints without coordinates, open flightmaps | `parse_vfr.ts`, `fetch_ofm.py`, `vfr_chart.py`, `build_vfr.py` |
| `tools/runways.json`: runway bearings, lengths, surfaces, thresholds, declared distances, slopes | AD 2.12/2.13, AD 1.6.N.12/13 | `parse_runways.py` (corrections in its `OVR` table, e.g. LGBL TORA from the AD 2.13 remark) |
| `src/data/ref/ad-airspaces.json`: aerodrome CTRs and ATZs (map layer, client only) | AD 2.17, AD 1.6.N.17 (+ ENR 4.1 VORs for arc centres) | `parse_ad_airspace.py`, run after `npm run ref` (arcs **hand-transcribed** in its `ARCS` table) |
| `tools/enr5_areas.json`: prohibited, restricted, danger, military training and local flying areas | ENR 5.1, 5.2, 5.3.1, the AIP SUPs in force | `parse_enr5.ts` (prints what it draws approximately; hand corrections in its `OVERRIDES` table; SUP areas in its `SUP_AREAS` table) |
| `src/data/ref/aip-files.json` + `AIP_EAIP_BASE` in `src/data/aipLinks.ts`: links to the AIP PDFs, and to each aerodrome VFR chart (`VFR LGxx`: AD 2.24 / AD 1.6.N.24 `…_VFR_en.pdf`, linked from the map info boxes) | the eAIP's `side.htm`, the AIRAC label | `aip_files.ts`, `sed` in the script |
| `src/data/ref/navaids.json`: radio navaids (VOR, VOR/DME, NDB, locators: ident, frequency, channel, position, DME elevation, variation, declination; map layer, client only) | ENR 4.1, AD 2.19, AD 1.6.N.19 | `parse_navaids.ts` |
| `tools/ad_hours.json`: operational hours, ATS, handling, customs and remarks as printed | AD 2.3, AD 1.6.N.3 (+ AD 1.6.N.4 handling) | `extract_ad_hours.ts`, run after `npm run ref`, then `npm run ref` again (parsed by `src/calc/adHours.ts` into `RefAerodrome.hours`) |

Then it stops before the reference data: a new cycle's data goes into NEW migrations (never edit an applied
one such as 002, 005 or 012). Point `MIGRATION` / `RUNWAY_MIGRATION` / `HOURS_MIGRATION` / `AREAS_MIGRATION` in `tools/build_ref.ts` at new files
(set `MIGRATION_FROZEN = false`, `VFR_MIGRATION = null` and `VFR_ROUTES_MIGRATION = null`: the new MIGRATION carries
the VFR points and routes), register them in `api/_lib/migrate.ts`, then run `npm run ref && npm test && npm run test:e2e`.
A correction to an applied AIRAC's data goes into its own migration (as 048 replaced 002's VFR points and 062 its VFR
routes).

## 2. Check by hand what the script flags

1. **VFR charts.** Step 3 of the script lists each chart as `CHANGED`, `NEW` or `REMOVED` (it compares PDF fingerprints in `tools/vfr_charts/manifest.json`).
   - For each one, open the chart and update `tools/vfr_charts/<ICAO>.json`:
     - `points`: **every** named reporting point of the chart, including IFR fixes on the TMA boundary and points
       of a neighbouring chart drawn at a route end. Copy printed coordinates as `dms`; a point another chart prints
       with coordinates is `"same_as": "<ICAO>"`; an IFR fix printed without coordinates takes its ENR 4.4 position
       as `dms` with `"ref": "ENR 4.4"`; otherwise `"from": "ofm"` (`ofm_name` when open flightmaps spells it
       differently), or `"from": "map"` with `near`. Points of the chart's text table (tools/vfr_points.json) are
       taken from the table, a spec entry for them only adds the open flightmaps check;
     - `routes`: a, b, altitude (`min`/`max`; both `null` for a segment drawn without an altitude: the map draws
       it unlabelled and no leg altitude is taken from it), the printed distance as `nm`, and `oneway` for arrowed
       per-direction altitudes;
     - `chart`: the edition date and AMDT.
   - Rerun `build_vfr.py` (last command of step 5). It refuses to build if a route's printed distance disagrees with its coordinates, if a printed position doesn't land on the chart's symbol / the open flightmaps point, or if a point lies outside the FIR or more than 120 NM from its chart's aerodrome. That is how misreadings are caught.
   - **Completeness.** `parse_vfr.ts` (step 5) prints the points read per chart and heliport and warns when a table
     lists more positions than it read (a new layout, a new degree sign such as `º`); every warning needs a fix in
     the parser and a fixture row in `tests/unit/data/vfrPoints.test.ts`. A chart with a table must show a count, and
     `build_vfr.py` prints the points per chart: compare each with the triangles on the chart (a chart that shows
     fewer is missing a spec entry). Expected (AIRAC 2609): LGAV 55, LGIR 37, LGKL 21, LGTG 23, LGLR 31, LGAD 12,
     AD 3.19 / AD 3.70 9 each. Names printed in several places merge into one point when within 1 NM (`charts`,
     `sources`); `tests/unit/data/vfrPoints.test.ts` checks known points (KALAMO on LGTG and others once missed).
   - Overlays for a visual check: `<work dir>/charts/overlay_*.png`, or `tools/vfr_verify.py <chart.png> tools/vfr_ocr/<ICAO>_p1-1.json out.png NAME=lat,lon …`.
2. **Airspace (ENR 2.1).** If step 3 shows a newer AMDT for `ENR_2_1`, diff the TMA/MTMA tables against `build_aip.py` (polygons, lower/upper limits, units, frequencies). Arc centres come from ENR 4.1 VOR positions.
3. **Aerodromes.** `parse_ad.py` handles the usual AD 2 / AD 1.6 layouts; a new layout shows up as a failing `tests/unit/aip.test.js` check or a missing frequency. Corrections go in the `OVR` table in `build_aip.py`.
4. **Sunset (GEN 2.7).** The tables are the "average year" 2028, valid 2024–2033 (GEN 2.7.4). After 2033, expect a new table; `parse_sun.py` will pick it up. It also replaces isolated misprints with the neighbouring days and prints them (currently LGAL 30 Nov).
5. **Aerodrome CTR/ATZ.** `parse_ad_airspace.py` prints each designation it cannot read. Lateral limits with arcs are written out by hand in its `ARCS` table (quote the AIP text next to them); check them when an AD 2.17 changes. `tests/unit/data/adAirspaces.test.ts` checks radii, closed rings and limits.
6. **Runways.** `tools/build_ref.ts` prints a warning for each slope it cannot sign (same unsigned value both ways and no threshold elevations). Spot-check a few aerodromes' declared distances against the PDFs; `tests/unit/data/runways.test.ts` checks bearings, reciprocals, thresholds and distances for consistency.
7. **Operational hours.** `tests/unit/calc/adHours.test.ts` lists what every aerodrome's AD 2.3 / AD 1.6 text parses to (AD hours, ATS, handling, customs). A changed text shows up there: check the new parse against the AIP and update the table. Text the parser cannot represent exactly is marked partial (shown as the AIP text, evaluated as unknown); keep that list short and deliberate.
8. **ENR 5 areas.** `parse_enr5.ts` prints each area it draws approximately (e.g. "excluding … ATZ" not cut out) or cannot draw; `tests/unit/data/enr5.test.ts` holds verbatim pages and the expected parse, and minimum counts per kind. A new layout or a new kind of lateral limit shows up there.
   **AIP SUPs:** areas established by a SUP, valid UFN (SUP 01/23 UAV AREA1/2, SUP 09/24 LGTRA1A–C) or for some
   dates (SUP 07/26 LGD102A–C, SUP 39/26's exercise areas), are drawn from the `SUP_AREAS` table, which names each
   area, its limits and the dated windows the SUP prints for it (as printed, checked against the area's page:
   every window printed on a page must be transcribed); the coordinates are read from the SUP text. Each area
   carries the SUP's dates (`validFrom` / `validUntil`, narrowed to its windows' days) and its windows (UTC): the
   maps draw it only on the days in force, the flight's warnings count it only when a leg is flown in a window,
   and an expired SUP's areas drop out by themselves. The parser warns about a SUP that prints coordinates but is
   not in the table (add it, or to `SUP_NOT_AREAS` when the coordinates are not an area), a table SUP whose text
   changed or which is no longer in the AIP (drop it once expired).
9. **Radio navaids.** `parse_navaids.ts` prints a warning for each table where it read fewer stations than there are frequencies, and for a station printed with a different frequency in ENR 4.1 and an AD 2.19. `tests/unit/data/navaids.test.ts` holds verbatim station rows and the expected parse, and checks the shipped list (known stations, positions inside the FIR).
10. **AIP links.** The script points `AIP_EAIP_BASE` at `https://aisgr.hasp.gov.gr/aipgr_incl_amdt_<NNYY>_wef_<ddmonyyyy>/cd/ais/`; open one link to check HASP kept that pattern (`tests/unit/data/aipLinks.test.ts` checks it matches the AIRAC).
11. **Compass cards** are not AIP data: each pilot keeps them in the hangar (aircraft page → Compass swing) after each swing.

## 3. Ship

`npm test && npm run test:e2e` must pass. Restart the server (`npm start`).
