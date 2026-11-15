# Pig's Gotta Fly

Pig's Gotta Fly (https://pigsgottafly.com) is a personal VFR flight planner for the Athinai FIR (LGGG).

Version 3 is being rebuilt in TypeScript with Vite, React and MapLibre. The design is in [PLAN-v3.md](PLAN-v3.md); code layout, contracts and API routes are in [ARCHITECTURE.md](ARCHITECTURE.md). The v2 navlog filler (one 1,400-line `js/app.js`) remains in git history.

## Run it

```sh
npm install
npm run dev        # http://127.0.0.1:8765/ — API + client with hot reload; flights in server/pgdata (PGlite), no sign-in
npm start          # production build, then the same server
npm run typecheck && npm test && npm run test:e2e
```

### Hosting (pigsgottafly.com)

Production runs on Vercel. `vite build` produces `dist/`, and `/api/…` runs as one function (`api/index.ts`) backed by Postgres on Neon. Each pilot signs in with Google and sees only their own records.

- Environment (Vercel project settings):
  - `DATABASE_URL` (set by the Neon integration)
  - `GOOGLE_CLIENT_ID` (required: the function refuses to serve without it)
  - optionally `ALLOWED_EMAILS` (comma-separated)
- Migrations run on cold start (`api/_lib/migrate.ts`). Migration 001 converts the v2 schema in place, keeping accounts, sessions and flights.

## Reference data

`data/aip.js`, `data/vfr.js` and `data/sun.js` are generated from the Greek eAIP by the Python tools in `tools/` (see [AIP-UPDATE.md](AIP-UPDATE.md)). `npm run ref` then converts them into the client's typed JSON (`src/data/ref/`) and into the SQL migration that loads the API's `ref_*` tables.

The AIP archive in `aip/` did not match either published checksum, so the data is unverified. Cross-check it against the official AIP before relying on it.

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

## Files

See [ARCHITECTURE.md](ARCHITECTURE.md).

## Data sources

- Aerodromes, airspace, VFR charts and sunset tables: AIP Greece (eAIP), Hellenic Aviation Service Provider. Not for operational use without checking the current AIP and NOTAMs.
- VFR reporting points not printed on the AIP charts: [open flightmaps](https://www.openflightmaps.org) (region LGGG).
- Weather: [Open-Meteo](https://open-meteo.com) (ECMWF IFS by default).
- Font: [Inter](https://rsms.me/inter/), SIL Open Font License (`fonts/OFL.txt`).
