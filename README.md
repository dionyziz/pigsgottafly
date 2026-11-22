# Pig's Gotta Fly

Pig's Gotta Fly (https://pigsgottafly.com) is a VFR flight planner for the Athinai FIR (LGGG). You draw the route on a map; the app computes the navlog, fuel, mass and balance, and take-off/landing performance, and fills in the paperwork for a flight in Greece.

The design is in [PLAN-v3.md](PLAN-v3.md). The code layout, contracts and API routes are in [ARCHITECTURE.md](ARCHITECTURE.md).

## Features

- **Accounts.** Sign in with Google or with Apple. Every pilot has their own profile, hangar, passengers, saved waypoints and flights; the API scopes every query to the signed-in pilot. A new pilot starts empty and is asked for name, phone and home aerodrome on first use.
- **Lobby.** Works like Google Docs: search, upcoming flights first, and a ⋮ menu to open, rename, copy, or move to trash (with undo and restore).
- **Flight editor.** A full-window MapLibre map with layers drawn from the AIP in VFR-chart style:
  - aerodromes (hover or click one for its hours and handling on the flight's date), TMA/CTR/ATZ sectors with class and vertical limits, VFR reporting points, and VFR routes with their charted altitudes;
  - over OpenFreeMap, OpenTopoMap or OpenStreetMap, with an optional openflightmaps aero overlay.
- **Route drawing.** Click to add points; points snap to aerodromes, VFR points and your saved waypoints. You can also place named custom points, drag points, drag a leg's midpoint to insert a point, delete points, and undo/redo. Leg labels show the magnetic course (WMM2025 variation), the distance, and the altitude, which you can click to edit.
- **Default altitudes.** A leg along a charted VFR route gets the route's charted altitude, in its charted direction. Other legs follow the v2 rules, and custom points take the altitude of the closest charted leg.
- **Left panel:**
  - when: date, block-off UTC with local time, taxi out/in, and the computed take-off, landing and block-on times;
  - aircraft;
  - manifest: PIC and passengers with seats, type-ahead from your passenger list, and create-on-the-spot;
  - fuel: required, fuel on board, capacity warning;
  - an editable ATC/frequency list;
  - take-off and landing performance cards;
  - aerodrome hours: each aerodrome of the route on the flight's date (AIP AD 2.3 / AD 1.6 operating hours, ATS, handling), with the NOTAMs that change them, and whether it is open at the planned time;
  - flight plan requests (touch-and-go, intermediate stop);
  - NOTAMs;
  - exports.
- **Navlog strip.** A collapsible strip of live legs: Open-Meteo ECMWF winds at each leg's midpoint, altitude and time, with WCA, TH, MH, CH from the compass card, GS, ETE and fuel. It also lists weather hazards along the route (thunderstorms, visibility, cloud below the planned altitude), which are drawn on the map too.
- **Calculations** are pure TypeScript in `src/calc` and unit-tested:
  - W&B and performance are cross-checked against 90 reference cases from an independent W&B and performance calculator (`tests/unit/calc/club.test.ts`, which documents each difference);
  - the e2e navlog is checked against an independent oracle.
- **METAR/TAF** from aviationweather.gov, fetched through the API.
- **Exports.** Print-ready A4 pages, one route per document:
  - navigation log (one sheet per 9 legs);
  - Form 731, with e-signatures: passengers sign through a share link, correcting their own details first if need be (the pilot is told);
  - General Declaration, with who submits it worked out from the handling hours at both ends (AIP + NOTAMs; per-flight override);
  - ICAO 2012 FPL message plus a filled form, with AFTN addressees from AIP ENR 1.11;
  - weight & balance with the CG envelope chart, and take-off/landing performance, as one signed document;
  - NOTAM briefing.
- **Optional services** (enabled by environment variables):
  - e-mailing Form 731 and the GenDec to HCAA;
  - NOTAMs and flight-plan filing through autorouter.
- **Operators.** The club or owner who operates an aircraft: name, contacts, operations manual (PDF), shared like an aircraft (anyone with one of its aircraft sees it). Its name is the operator on the GenDec, FPL OPR/ and the W&B sheet. An operator can ask for the W&B and performance sheets before each flight: the export then sends them to it as PDF.
- **Hangar.** Identity, FPL equipment and item 19, speeds, fuel, mass and balance with envelopes, performance tables, and compass swing cards with attached reports. A new aircraft can start from a type template (Reims F172M).

## Run it locally

Node 24.

```sh
npm install
npm run dev        # http://127.0.0.1:8765/ (API + client with hot reload, PGlite in server/pgdata, no sign-in)
npm start          # production build, then the same server
npm run typecheck && npm run lint && npm run format:check && npm run knip && npm test && npm run build && npm run test:e2e
```

Without `GOOGLE_CLIENT_ID` the local server runs in local mode as a single `local` pilot, without sign-in. It refuses a `postgres://` `DATABASE_URL` in local mode unless `LOCAL_MODE_ON_POSTGRES=1` is set. The local server does not read `.env.local`. Never point a local run at the production database. `PORT` and `HOST` default to 8765 and 127.0.0.1.

The e2e tests need Google Chrome installed. They drive the built client headlessly over CDP.

## Deploy (pigsgottafly.com)

Production runs on Vercel with Postgres on Neon:

```sh
vercel deploy --prod
```

- Vercel builds `dist/` with `vite build`. The API runs as one function, `api/index.ts`, and `vercel.json` rewrites `/api/*` to it and every other path to the SPA.
- **Migrations run on cold start.** The function applies pending numbered migrations (`api/_lib/migrations/`, recorded in `schema_migrations`, serialised with an advisory lock) before it serves.
  - Migration 001 converts the v2 schema in place, keeping accounts, sessions and flights.
  - Migration 003 seeds the existing owner's profile and SX-ASV/SX-ASG once.
  - Migration 004 converts v2 flights.
- Environment variables (Vercel project settings):
  - `DATABASE_URL`: required, set by the Neon integration.
  - `GOOGLE_CLIENT_ID`: required. The function refuses to serve without it.
  - `APPLE_CLIENT_ID`: optional. The Services ID for **Sign in with Apple** (e.g. `com.pigsgottafly.web`); unset, the Apple button is not shown and `POST /api/login/apple` answers 404. The App Store requires it next to Google's sign-in (guideline 4.8). See *Sign in with Apple* below.
  - `ALLOWED_EMAILS`: optional, comma-separated. Limits who can sign in (Google and Apple); an address a pilot invited (Invite pilots) may sign in too.
  - `AUTOROUTER_EMAIL` / `AUTOROUTER_PASSWORD`: optional, for the NOTAM briefing. Add `AUTOROUTER_FILING=1` for flight-plan filing.
    - This is one shared account, so only the pilots on `AUTOROUTER_PILOTS` (default `ALLOWED_EMAILS`) may use it; `*` lets every signed-in pilot use it. With both lists empty, nobody can.
    - Filing only accepts a plan whose item 7 is the registration of the flight's aircraft.
  - `RESEND_API_KEY`: optional. E-mails Form 731 and the GenDec to HCAA, and the W&B and performance sheets to an operator that asks for them, with `FORMS_FROM` as the sender (default `Pig's Gotta Fly <noreply@pigsgottafly.com>`).
    - Any signed-in pilot may send. The pilot is cc'd on every e-mail and is its reply-to address.
    - A form version that was already sent goes again only on an explicit re-send.
    - SPF/DKIM must be set up for the sender domain.
  - `ADMIN_EMAILS`: optional, comma-separated (default: nobody). These pilots see the admin page (`/admin`: every pilot, their counts and shares) and get an e-mail for each new signup (sent through Resend, no cc; a failed e-mail never blocks the sign-in).

### Sign in with Apple

The sign-in screen shows Apple's button under Google's when `APPLE_CLIENT_ID` is set. It uses Apple's JS
(popup), and the server checks Apple's identity token against Apple's keys (`POST /api/login/apple`,
`api/_lib/routes/session.ts`). A pilot is found by Apple's user id (`pilots.apple_sub`). The first time,
an existing pilot with the same verified e-mail is linked, but never through a Hide My Email relay address.
Anyone else gets a new account.

What the owner sets up in the Apple Developer account (Certificates, Identifiers & Profiles):

1. **Identifiers → App IDs**: the App ID (`com.pigsgottafly.app`) with the *Sign in with Apple* capability
   enabled, as the primary App ID.
2. **Identifiers → Services IDs → +**: a Services ID, e.g. `com.pigsgottafly.web` (description "Pig's Gotta Fly").
   Enable *Sign in with Apple* → *Configure*: primary App ID `com.pigsgottafly.app`, **Domains and
   Subdomains** `pigsgottafly.com`, **Return URLs** `https://pigsgottafly.com/`. Save, then Continue → Register.
3. In Vercel: `APPLE_CLIENT_ID` = that Services ID (Production), then redeploy.

No private key or client secret is needed: the app only verifies the identity token, it never calls Apple's
token endpoint. For a local test, add the local origin to the Services ID's domains (Apple accepts only
HTTPS origins, so use a tunnel) and run with `APPLE_CLIENT_ID` set.

## iPhone and iPad app

`native/ios/` is the native app (Swift, SwiftUI, MapLibre Native), described in [NATIVE.md](NATIVE.md): Fly (a
moving map with GPS that works offline), Brief and Navlog for a flight, New flight, small route edits, the
profile and account deletion. Full planning, filing and the forms stay on the website; a flight opens there in
an in-app Safari view. Everything it computes comes from `src/native/core.ts`, built into `core.js` and run in
JavaScriptCore, so the app and the website show the same numbers.

- XcodeGen: `native/ios/project.yml` → `PigsGottaFly.xcodeproj` (generated, not committed). Team Dionysis
  Zindros (`F2UQTZ295F`), automatic signing, bundle id `com.pigsgottafly.app`.
- Sign-in: the app's *Sign in* opens `/app-login` in Apple's sign-in sheet (Google or Apple ID), and the page hands
  back a one-time code (`POST /api/app-code`, `GET /api/app-session`, `api/_lib/routes/appLogin.ts`,
  `src/app/appLogin.ts`).
- `native/ios/PigsGottaFly/PrivacyInfo.xcprivacy`: the privacy manifest. Keep it in step with
  `native/ios/AppStore/app_privacy.md` and the privacy policy.
- Fixture mode (no network, no sign-in) for tests and screenshots: launch arguments `-fixtures` (the API answers
  from `native/ios/PigsGottaFly/Fixtures/`), `-emptyAccount` (a brand-new pilot), `-noNetwork`,
  `-fixturePosition lat,lon[,track,gs]`, `-openFlight <id>`, `-tab fly|brief|navlog`.

```
npm run native:core      # rebuild core.js after changing the shared TypeScript (committed)
npm run native:build     # xcodegen + unit and UI tests on the iPhone 17 Pro simulator
npm run native:open      # xcodegen + Xcode
npm run ios:version      # version = package.json "version", build = commit count, into project.yml
npm run ios:upload       # ios:version, xcodegen, Release archive, export and upload to App Store Connect
```

Versions: bump `"version"` in package.json for a new App Store version; `npm run ios:version` (which
`ios:upload` runs first) writes it and a new build number into `native/ios/project.yml` (commit the change).
Every upload needs a higher build number. The export signs with the team's Apple Distribution certificate and the
"com.pigsgottafly.app AppStore" profile (both made with fastlane's get_certificates / get_provisioning_profile and
the App Store Connect API key in `~/.appstoreconnect/private_keys/`), and uploads with that key.

### Publishing

`native/ios/AppStore/` holds the App Store Connect listing as files to paste (name, subtitle, description,
keywords, promotional text, support and privacy URLs, category, age rating, review notes, the App Privacy answers)
and the screenshots (`screenshots/iphone-6.9`, 1320×2868, iPhone 17 Pro Max, and `screenshots/ipad-13`,
2064×2752, iPad Pro 13-inch (M5); taken from the simulators in fixture mode). Only the owner can do these:

1. Xcode must be signed in with the team's Apple ID (Settings → Accounts), so that the export can sign with an
   App Store distribution certificate.
2. The app record exists in App Store Connect (6837510399, bundle id `com.pigsgottafly.app`).
3. Paste `native/ios/AppStore/*.txt`, answer App Privacy from `app_privacy.md`, upload the screenshots.
4. `npm run ios:upload`: version and build number, archive and upload to App Store Connect
   (`native/ios/ExportOptions.plist`). Try the build in TestFlight.
5. For Sign in with Apple on the sign-in page: a Services ID (e.g. `com.pigsgottafly.web`) with Sign in with
   Apple, domain `pigsgottafly.com`, return URL `https://pigsgottafly.com/`; `APPLE_CLIENT_ID` set to it in
   Vercel.
6. Choose the build on the version page and submit for review.

## Reference data

`data/aip.js`, `data/vfr.js` and `data/sun.js` are generated from the Greek eAIP by the Python tools in `tools/` (see [AIP-UPDATE.md](AIP-UPDATE.md)). `npm run ref` then converts them into the client's typed JSON (`src/data/ref/`) and into the SQL migration that loads the API's `ref_*` tables, which are tagged with the AIRAC cycle (currently 09/26). For a new AIRAC, add a new migration; never edit an applied one.

The AIP archive in `aip/` did not match either published checksum.

VFR reporting points and routes (all 21 eAIP VFR route charts, plus open flightmaps):
- The 446 reporting points cover every chart, plus the rest of Greece via open flightmaps.
- 329 route segments with altitudes on 17 charts: LGAV, LGBL (partial), LGKL, LGKO, LGKP, LGKR, LGKV, LGMK, LGMT, LGPA, LGRP, LGSA, LGSK, LGSM, LGSR, LGSY, LGTS. LGTG, LGIR, LGLR and LGAD have names only. Each chart file in `tools/vfr_charts/` lists in its notes which legs were left out and why.
- How the data was produced:
  - Coordinates come from the AIP where printed; otherwise from open flightmaps.
  - Altitudes are read from the chart images, using OCR and then checking by eye.
- How it was checked:
  - Each chart image is georeferenced (`tools/vfr_chart.py`, RMS 0.02–0.1 NM).
  - Every route's printed distance must match its endpoints.
  - Points that disagree are reviewed on an overlay (`tools/vfr_verify.py`).

## Data sources

- Aerodromes, airspace, runways, VFR charts and sunset tables: AIP Greece (eAIP), Hellenic Aviation Service Provider.
- VFR reporting points not printed on the AIP charts: [open flightmaps](https://www.openflightmaps.org) (region LGGG).
- Weather: [Open-Meteo](https://open-meteo.com) (ECMWF IFS); METAR/TAF: [aviationweather.gov](https://aviationweather.gov).
- Magnetic variation: World Magnetic Model 2025 (NOAA/BGS).
- Base maps: OpenFreeMap, OpenTopoMap, OpenStreetMap contributors.
- Fonts: [Inter](https://rsms.me/inter/) and Homemade Apple (signatures), each under its own licence in `public/fonts/`.
