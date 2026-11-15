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
| `data/vfr.js`: VFR points and route altitudes | VFR charts + open flightmaps | `parse_vfr.py`, `fetch_ofm.py`, `vfr_chart.py`, `build_vfr.py` |
| `tools/runways.json`: runway bearings, lengths, surfaces, thresholds, declared distances, slopes | AD 2.12/2.13, AD 1.6.N.12/13 | `parse_runways.py` (corrections in its `OVR` table, e.g. LGBL TORA from the AD 2.13 remark) |

Then it stops before the reference data: a new cycle's data goes into NEW migrations (never edit an applied
one such as 002 or 005). Point `MIGRATION` / `RUNWAY_MIGRATION` in `tools/build_ref.ts` at new files, register
them in `api/_lib/migrate.ts`, then run `npm run ref && npm test && npm run test:e2e`.

## 2. Check by hand what the script flags

1. **VFR charts.** Step 3 of the script lists each chart as `CHANGED`, `NEW` or `REMOVED` (it compares PDF fingerprints in `tools/vfr_charts/manifest.json`).
   - For each one, open the chart and update `tools/vfr_charts/<ICAO>.json`:
     - `points`: copy printed coordinates as `dms`; otherwise use `"from": "ofm"`, or `"from": "map"` with `near`;
     - `routes`: a, b, altitude (`min`/`max`), the printed distance as `nm`, and `oneway` for arrowed per-direction altitudes;
     - `chart`: the edition date and AMDT.
   - Rerun `build_vfr.py` (last command of step 5). It refuses to build if a route's printed distance disagrees with its coordinates, or if a printed position doesn't land on the chart's symbol / the open flightmaps point. That is how misreadings are caught.
   - Overlays for a visual check: `<work dir>/charts/overlay_*.png`, or `tools/vfr_verify.py <chart.png> tools/vfr_ocr/<ICAO>_p1-1.json out.png NAME=lat,lon …`.
2. **Airspace (ENR 2.1).** If step 3 shows a newer AMDT for `ENR_2_1`, diff the TMA/MTMA tables against `build_aip.py` (polygons, lower/upper limits, units, frequencies). Arc centres come from ENR 4.1 VOR positions.
3. **Aerodromes.** `parse_ad.py` handles the usual AD 2 / AD 1.6 layouts; a new layout shows up as a failing `tests/unit/aip.test.js` check or a missing frequency. Corrections go in the `OVR` table in `build_aip.py`.
4. **Sunset (GEN 2.7).** The tables are the "average year" 2028, valid 2024–2033 (GEN 2.7.4). After 2033, expect a new table; `parse_sun.py` will pick it up. It also replaces isolated misprints with the neighbouring days and prints them (currently LGAL 30 Nov).
5. **Runways.** `tools/build_ref.ts` prints a warning for each slope it cannot sign (same unsigned value both ways and no threshold elevations). Spot-check a few aerodromes' declared distances against the PDFs; `tests/unit/data/runways.test.ts` checks bearings, reciprocals, thresholds and distances for consistency.
6. **Compass cards** are not AIP data: each pilot keeps them in the hangar (aircraft page → Compass swing) after each swing.

## 3. Ship

`npm test && npm run test:e2e` must pass. Restart the server (`npm start`).
