# Architecture (v3)

The design is in PLAN-v3.md. This file covers how the code is laid out and the contracts between its parts.

## Stack

- **Client**: TypeScript, Vite 8, React 19, react-router 8 (BrowserRouter, imported from `react-router`), MapLibre GL 6 (ES modules; imported through src/app/maplibre.ts, which sets the worker URL).
- **API**: one Vercel Node function (`api/index.ts`) that dispatches to a route registry. Postgres runs on Neon (`@neondatabase/serverless`) in production, and on PGlite (`@electric-sql/pglite`) locally and in tests.
- **Tests**: vitest for unit and API tests (in-memory PGlite), plus a dependency-free headless-Chrome CDP harness for end-to-end tests.
- **Tooling**: TypeScript 7 type-checks (`npm run typecheck`); the `typescript` package stays on 6.0, the newest with the JS API that typescript-eslint and Vercel's function builder load. ESLint, Prettier and knip; `.github/workflows/ci.yml` runs every check, the e2e suite included, on pushes and pull requests to main. Renovate (`renovate.json`) proposes updates weekly.

## Layout

```
index.html                 Vite entry (→ src/main.tsx)
pdf.html                   second Vite entry (→ src/pdf/main.tsx): the page the server prints the operator's W&B and
                           performance PDF and the pilot's e-mailed navlog from (api/_lib/sheetPdf.ts)
public/                    icons, manifest, fonts/Inter (copied to dist/ as-is)
src/
  shared/                  THE CONTRACT: domain + API + ref types, constants, type templates
    types.ts               Pilot, Aircraft (FuelSpec, MassBalance, Station/SeatPosition, Envelope,
                           PerformanceTables, Equipment, CompassCard), Passenger, Waypoint, Flight/FlightDoc,
                           RoutePoint, LegOverride, FlightCrew, AtcEntry, FlightOptions, FlightSummary
    ref.ts                 RefAerodrome, RefRunway, RefAirspace, RefFis, RefFir, RefVfrPoint, RefVfrRoute, RefAtcUnit,
                           RefSunTable, RefBundle, RefAirac
    mapLayers.ts           MapLayers (base map + one toggle per map layer), DEFAULT_MAP_LAYERS, mapLayersOf (lenient
                           normalisation, API and client): FlightOptions.mapLayers (per flight) and PilotSettings.mapLayers
                           (copied to new flights by POST /flights)
    api.ts                 request/response bodies of every /api route
    constants.ts           DEFAULT_SETTINGS (unset values), SETTING_SUGGESTIONS, profileMissing(), seatLayout(),
                           validateCrew(), EXPORT_KINDS, legKey(), uid(), autoTitle(), emptyFlightDoc()
    templates.ts           aircraft TYPE templates (AFM data, blank airframe): aircraftFromTypeJson(), blankAircraft()
    format.ts              THE formatters: pad, fmtClock(min,{z,fallback}) 'HH:MM', fmtClockMs, fmtDateTimeMs
                           'YYYY-MM-DD HH:MMZ', fmtDuration(min,{fallback}) '1h44', fmtEte '00:10'
                           (navlog ETE/ATE columns), fmtAltitude '3000'/'FL065'
                           (TRANSITION_ALTITUDE_FT), fmtLocalClock, fmtLocalDayTime, fmtSize, errorMessage(e)
    date.ts                LOCAL_TZ = Europe/Athens (the one local zone), parseIsoDate, isIsoDate, isoDay, todayUtc,
                           localToday, localDayTime, fmtDate, daysBetween, addDays, relativeDay, ageOn, utcToLocal,
                           localOffsetLabel
    aerodrome.ts           aerodromeName(a) (ICAO, else the last part of the name), aerodromePoint(a): the one rule for
                           route points (new flight, editor, map, server home route)
    operators.ts           Operator, OperatorItem (access, viaAircraft), OperatorSharing; isEmail
    aircraftHistory.ts     the aircraft edit log and version history in words (entryTitle, changeText,
                           versionChangeText, revisionSummary: also the API's revision summaries)
    declarations.ts        WbPerfContent (the W&B and performance sheets as drawn: the export page draws them from it,
                           sends it to an operator, and the server prints it with the same sheets), wbPerfContentOf
                           (normalization, both sides), wbPerfText (hashed: "changed since sent"), DeclarationsState
    weatherGrid.ts         forecast contract of GET /api/weather/grid: variable sets (wind, hazard), model grid steps
                           (ECMWF/GFS 0.25°, ICON-EU 0.0625°), gridCorners (the nodes around a point, bilinear weights),
                           nodeKey/pointKey, forecastAvailability, WeatherGridResponse
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
    weather.ts             Open-Meteo data (port of v2 js/weather.js): sampleAt, sampleSurface, fetchRouteWeather (winds
                           at each leg midpoint, interpolated bilinearly between the model grid nodes around it:
                           windCorners + blendLocations, winds as u/v; surface at the aerodromes, exact points),
                           surfaceConditions, chooseSurface (METAR vs forecast), windProviderFromLegs()
    weatherGrid.ts         fetchGrid: GET /api/weather/grid, cached in memory per location and model run (until the
                           server's recheckMs), concurrent requests shared, only uncached locations asked for
    weatherMetar.ts        parseMetar, parseTaf, fetchMetarTaf (through GET /api/weather/metar)
    notams.ts              NOTAM briefing: fetchNotams (GET /api/flights/:id/notams), texts (validity, limits, decoded
                           subject), Q-line circle rings for the map, visibleNotams (relevant / show all)
    hazardWeather.ts       corridor samples for hazards (every ~10 NM, ±5 NM, 0.25° grid nodes through fetchGrid):
                           fetchHazardWeather, computeRouteHazards (editor strip + map)
    atc.ts                 generateAtcList(AtcGenInput), atcInput(), regenerateAtcList()
    entityStore.ts         entity cache + invalidation bus (no React): keys pilot|passengers|aircraft|operators|waypoints|flights;
                           invalidate(keys) → refetch what is on screen + BroadcastChannel('pgf') to the other tabs;
                           hidden tabs defer until shown; focus/visibility revalidates (> 5 s old); per-key request
                           sequence (a slow answer never overwrites a newer one); putEntity (with broadcast: the value itself goes to
                           the other tabs, stored at once even in a hidden tab), onInvalidate, onRevalidate
    entities.ts            useEntity('pilot'|'passengers'|'aircraft'|'operators'|'waypoints'): cached, shared, refetched on change
    api.ts (mutations)     every create/update/remove invalidates its key, plus what the server derives from it:
                           aircraft create/remove → 'pilot' (default aircraft) and 'operators' (their aircraft lists),
                           aircraft update → 'operators'; operator update/remove → 'aircraft' (the operator's name);
                           aircraft shares → 'aircraft' + 'operators' (+ 'pilot' on remove); operator shares → 'operators'
                           (+ 'aircraft' on remove); aircraft files → 'aircraft' (photo), operator files → 'operators';
                           passenger remove → 'flights'; flights → 'flights'; api.me.update stores the pilot (all tabs)
    useAsync.ts            loading hook (newest request wins) + {refetchOnFocus, invalidatedBy: EntityKey[]}
    sequence.ts            sequencer()/useSequencer()/latestOnly(): only the newest async request sets state
    useFlightWeather.ts    one weather + METAR loader for a flight (leg midpoints, departure, stops, destination;
                           metarRelevant(date) = one "near now" rule; a failed fetch ends loading): for panels/calc.tsx,
                           NavlogExport, wb/useExportCalc, fpl/useFplData
    aipLinks.ts            links to the official AIP Greece PDFs (HASP eAIP): AIP_EAIP_BASE (the AIRAC's online eAIP,
                           set by tools/update_aip.sh), aipSection/aipUrl ('LGAV AD 2.3' → AD 2 LGAV PDF; the
                           eAIP start page when a section has no PDF), from ref/aip-files.json
    ref/                   reference data shipped with the client (generated JSON) + index.ts typed accessors:
                           AIRAC, AERODROMES, RUNWAYS, AIRSPACES, AD_AIRSPACES, AREAS (ENR 5), FIS, FIR (fir.json), VFR_POINTS, VFR_ROUTES, ATC_UNITS, SUN_TABLES,
                           REF (RefBundle), aerodrome(idOrIcao), vfrPoint(id), runwaysOf(id),
                           resolveAerodrome(text), searchAerodromes(q)
  app/                     AipLink / AipRefText (AIP references as links to their PDF, new tab), App (router), AuthGate + SignIn (Google Identity Services), session context,
                           AboutPage (/about: the one place the weather model and the data sources are named)
                           (useSession/usePilot), Shell/TopBar, AccountMenu, toast, ErrorBoundary, styles.css (design tokens, base
                           elements, shell, list tables, the print-sheet-page rule; no var(--token, fallback) anywhere),
                           errorReporter.ts (window errors, rejections, ErrorBoundary catches, API 5xx → POST /api/client-errors)
                           staleBuild.ts (after a deploy: reload once onto the new build on a stale-chunk error or
                           vite:preloadError, not preventDefault-ed; ErrorBoundary shows the loading screen for any error
                           in the 10 s after this page started that reload), maplibre.ts (MapLibre 6 with its worker URL:
                           every map imports maplibregl from here)
  ui/                      ui.css: global component classes (button variants sm/icon/ghost.danger/danger-fill/linkish; hint,
                           form-error, warn-text, danger-text, ellipsis, num, tnum; grid2/grid3/span2, hide-sm, unit-input,
                           field/check; dialogs, menus, empty, searchbox, tabs, combo; component styles). Mono only for codes; tnum for measurements
                           index.ts: the component library (import from '../../ui'): Dialog + DialogFooter (danger left), ConfirmDialog,
                           Menu/KebabMenu, EmptyState, AsyncView, Loading (screen/inline/sm, a div), Icon (one name → path map) +
                           CloseButton + RowRemove, Chip (tones; mono/count/sm), SearchBox, rowClick, Field/IssueList/Check,
                           NumberField (live commit, clamp on blur, limit shown; parsing in shared/number.ts), Combobox (comboKey),
                           AerodromeInput (RefAerodrome|null) / AerodromeTextInput, PersonPicker, Collapsible (whole header toggles,
                           remembered), useSortable + DragHandle (pointer, Alt+↑/↓; shared/list.ts moveAt), CardSection, Panel,
                           WarningList (level + link or in-place fix), useHighlightFields, FilePicker, PdfViewer (Blob or URL),
                           SegmentedControl (one of a few options; one outer border, even dividers; ←/→).
                           useAutosave (debounced save of a form value, on blur, Ctrl+S, leaving and tab close via
                           keepalivePut; settle() for a dialog's Done, adopt() for a copy from another tab) +
                           SaveStatus ("Saving…/Saved/Not saved") + AutosaveFooter (Delete · status · Done): every
                           editor of an existing record autosaves (aircraft, operator, profile, passenger, pilot's
                           details, waypoint); invalid fields hold the save back and say why under themselves; only
                           dialogs that create a record keep a button (Add passenger, Add waypoint, Add aircraft…).
                           TimeField ('HH:MM' typed with or without the colon, or picked from a 15-minute listbox that
                           opens on focus; optionNote, e.g. the local time) and DateField ('YYYY-MM-DD', dashes put in as
                           digits are typed, paste, min/max, a month calendar popover); parsing in shared/typedInput.ts.
                           Every time and date input in the app is one of these.
                           Pages import these from src/ui directly (no re-export shims left).
  features/
    lobby/                 LobbyPage (fixed header: h1 Flights, fixed-width tabs, New flight kept hidden in Trash),
                           NewFlightPage (AerodromeTextInput status lines say why Create is disabled; aerodromePoint),
                           RouteThumb, format.ts (flight search and split), lists.css (lobby rows, list tables, form cards)
    profile/               ProfilePage (autosaves, nothing required; embeds PersonFields; follows the pilot while
                           nothing is unsaved),
                           AccountSection (download my data, delete account with a typed confirmation)
    legal/                 /privacy and /terms (public, no sign-in; linked from the sign-in screen and the account menu)
    hangar/                HangarPage, AircraftPage (autosave: useAutosave, debounced PUT of the whole aircraft, on blur,
                           Ctrl+S and leaving; "Saving…/Saved" by the registration; a bar only for errors (links focus
                           their inputs, issueTarget: inputs are named by their issue path) or a failed save (Retry);
                           useScrollSpy: the section nav follows the scroll); stations, envelope points, compass cards
                           and their points reorder by drag handle; AircraftFiles (photo, else the aircraft's placeholder
                           picture public/aircraft/placeholder-N.webp; DocumentsSection for any FileScope), ShareDialog,
                           HistorySection (Version history: the revisions; one opens the aircraft as it left it in
                           place of the form, read-only, its differences highlighted: VersionPreview + versions.ts
                           (markChanged, pathTarget); Restore, confirmed in the page, then a toast with Undo),
                           history.ts (the cards' "Updated … by …")
    operators/             OperatorsPage (useEntity('operators')), OperatorPage (autosaves; header as the aircraft
                           page's; details, W&B/performance requirement, documents, aircraft, who has access), OperatorPicker (the aircraft page's operator dropdown
                           with "New operator…")
    admin/                 AdminNav (tabs Pilots | Errors | E-mails), AdminPage (/admin: every pilot), ErrorsPage
                           (/admin/errors: grouped errors, stack, resolve), MailPage (/admin/mail: the e-mail action
                           log filterable by pilot and kind); the API answers 403 to non-admins
    passengers/            PassengersPage (delete: the row's bin or the dialog's Delete, confirmed, with Undo), PassengerDialog + PilotDetailsDialog, PersonFields (the one person editor),
                           person.ts (form state, validatePerson → {field, message}[]), formIssues.ts (useFormIssues:
                           messages under their fields, first bad field focused; also used by profile and waypoints)
    waypoints/             WaypointsPage
    editor/                EditorPage (layout: collapsible flight panel; resizable.tsx sizes panels by style during a
                           drag, RouteMap resizes the canvas in the same frame), state.tsx (EditorProvider/useEditor: SHARED EDITOR CONTRACT),
                           map/ (MapView → RouteMap: VFR-chart layers, drawing, snapping, leg labels; airspace.ts +
                           AirspacePopover: TMA/CTR/ATZ and ENR 5 area (P/R/D/MIL/local flying) shapes and layer toggles, hover
                           tooltip, click details (identity only: type, limits, lateral, activity, units, remarks, AIP link);
                           dragging a route point snaps it and it becomes the point dropped on (routeEdit.movePoint);
                           notamLayer.ts + NotamPopover: NOTAM areas, hover tooltip, click details),
                           AerodromePopover: aerodrome hover tooltip / click details with the hours on the flight date;
                           MapPopover (MapTip, MapPopover, PopItem + useAccordion, useInsideMap): the frame of those three and
                           of the snap / weather tooltips, all kept inside the map (flipped left / up near its edges); MapToolbar
                           (route tools, LayersControl, MapHint: fades near the cursor, not near its close button), MapLayerToggles
                           (the layer list, also the profile's "Map layers for new flights"), PointMenu (+ NameBox), mapPrefs.ts
                           (flightLayers: flight → profile → this browser's old choice → all; tips per browser); layers are
                           saved with the flight (useEditor().setMapLayers: not an undo step); style.LAYER_GROUPS maps toggles to
                           MapLibre layers; snapping and hover details follow the layers shown; the FIR boundary and the
                           ATHINAI | MAKEDONIA line (features.firFeatures); route points grow with a
                           halo on hover (feature-state), legs carry direction arrowheads (features.routeArrowFeatures);
                           colours = the --map-* tokens, read by style.ts loadChartTokens),
                           notams.tsx (NotamProvider/useNotams: the flight's NOTAM briefing, show all, selected NOTAM),
                           AerodromeHours.tsx (an aerodrome's hours, ATS, handling on a date, NOTAM changes, AIP text),
                           focus.ts (focusInEditor(key): a warning's fix opens the panel and the box holding the field and
                           focuses it in place, like ?focus=; editorWarningFix(text) via exports/fix planningFix),
                           panels/ (FlightPanel sections on src/ui Collapsible (store pgf.editor.sections; take-off/landing
                           cards and aerodrome-hours items collapse too, with a summary), RouteSection (origin/destination fields), NavlogStrip; calc.tsx = useFlightCalc (weather via data/useFlightWeather): navlog,
                           fuel, W&B, performance, aerodrome hours at the planned times (aerodromeChecks.ts), warnings)
    exports/               ExportPage: /flights/:id/export/:kind → navlog/ (MD 4.2), form731/, gendec/ (MD 4.7),
                           fpl/ (ICAO 2012 message + form), wbperf/ (one signed document: wb/ MD 4.3 + envelope
                           chart, then performance/ MD 4.4; /export/wb and /export/performance redirect to it;
                           SendPanel + declaration.ts: "Send to <operator>" when the aircraft's operator asks for them;
                           the sheets WbSheet/PerfSheet are drawn from WbPerfContent, on the page and in the PDF),
                           briefing/ (NOTAM briefing). The flight is loaded after flightStore.flushNow() and refetched on
                           focus / 'flights' changes; aircraft and passengers via useEntity (useExportData.ts); weather via
                           useFlightWeather; screen panels are src/ui Panel. fix.ts + WarningList.tsx (ExportWarnings, the one
                           .export-warnings box around src/ui WarningList): every on-screen export warning links to
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
  _lib/pgErrors.ts         database errors by SQLSTATE (unique / FK / check → 400 or 409), never by message text
  _lib/access.ts           aircraft access (owner / shared edit / view): aircraftFor, listAircraft, accessibleSql, AIRCRAFT_FROM
  _lib/aircraftLog.ts      the aircraft edit log: diffAircraft (short values old → new, lists and tables summarized),
                           logEdit (one pilot's saves within AIRCRAFT_LOG_COALESCE_MS are one entry), logEvent
                           (creation, files, photo, sharing), listLog (GET /aircraft/:id/log), updatedAt/updatedBy;
                           the version history: snapshotOf (the aircraft and its attached files by reference, kept on
                           every entry but sharing), listRevisions, getRevision, headRevision, diffSnapshots; restoring
                           is routes/aircraft.ts restore()
  _lib/operators.ts        operator access (owner / shared edit / view / view through an aircraft): operatorFor, listOperators
  _lib/mail.ts             Resend: sendMail (for a pilot: always cc'd, reply-to), sendSystemMail (the app's own: signup notices, error alerts, share notices)
  _lib/shareMail.ts        the e-mail to a person an aircraft or an operator is shared with (who, what, access, link); logged, capped, never fails the share
  _lib/monitor.ts          error monitoring: recordError (app_errors, grouped by fingerprint) + throttled alert e-mails,
                           migrateReporting (a failed migration is recorded and e-mailed, then rethrown), client report rate limit
  _lib/sheetPdf.ts         the W&B and performance PDF e-mailed to an operator and the navlog e-mailed to the pilot:
                           headless Chromium (CHROME / a local Chrome; on Vercel @sparticuz/chromium, x86_64) prints
                           dist/pdf.html (src/pdf/: the export pages' sheets and CSS) from the sent WbPerfContent /
                           NavlogContent, A4 with the print CSS; no session, no network (requests answered from dist/ on
                           disk, the rest aborted); ApiConfig.sheetPdf / navlogPdf (configFromEnv; SHEET_PDF=off)
  _lib/filers/             filing backends behind one driver interface (types.ts): autorouter.ts, fax.ts (+ faxProviders.ts:
                           Telnyx, Sinch, dry run; faxRoutes.ts: where a departure's plan is faxed; icaoMessages.ts: DLA/CNL),
                           select.ts (FILERS order, fallback on transient failures); see "Filing backends"
  _lib/declarationPdf.ts   the fallback when that print fails (recorded in app_errors): the same sheets drawn with the
                           pdf.ts writer
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
                           app mails without a pilot), 032_rate_limits.ts (token buckets; indexes for the upload sweep),
                           040_app_errors.ts (app_errors, app_error_alerts; IF NOT EXISTS),
                           042_crew_overrides.ts (flight_crew.overrides: manifest fields edited on the flight),
                           043_aircraft_placeholder.ts (aircraft.placeholder 1–3: random at creation, backfilled),
                           044_weather_cache.ts (weather_cache: Open-Meteo data per model, endpoint, run, set, location and
                           UTC day, with expiry; weather_budget: Open-Meteo calls per UTC day),
                           045_passenger_email.ts (passengers.email, NULL for existing passengers),
                           054_flight_shares.ts (flight_shares, flight_invites: flights shared by e-mail)
                           055_pilot_invitations.ts (pilot_invitations, pilot_invitation_aircraft: invitations to the app),
                           057_aircraft_log.ts (aircraft_log: the edit log; author_id SET NULL when an account is deleted)
                           060_aircraft_revisions.ts (aircraft_log.snapshot: the version history; kinds restore and
                           baseline; aircraft_attachments.detached; backfill: a revision of every aircraft as it is)
                           055_pilot_invitations.ts (pilot_invitations, pilot_invitation_aircraft: invitations to the app)
                           058_notam_source_cache.ts (notam_source_cache: a paid NOTAM source's results per location
                           and UTC-day window)
  _lib/notams.ts           NOTAM decoding (toNotam: RawNotam → Notam, Q code subjects/conditions) and relevance to the
                           flight (assessNotams)
  _lib/notamSources/       NOTAM source drivers (see "NOTAM sources" below): types.ts (NotamSourceDriver, RawNotam),
                           autorouter.ts, nms.ts and notamify.ts (client + driver), icao.ts (ICAO text → fields), merge.ts
                           (de-duplication, NOTAMR/C chains), multiplex.ts (parallel, per-source timeouts and status),
                           cache.ts (per location and day, in the DB), index.ts (NOTAM_SOURCES order, configured sources)
  _lib/sendCaps.ts         sending caps (429) and the e-mail action log: per pilot 20 e-mails/24 h, 5 per flight and form,
                           10 declarations/24 h to one address, 10 min between sends of a flight's form (Form 731 to a
                           passenger, '731-pax': per flight and recipient; share notices, 'share-aircraft',
                           'share-operator' and 'share-flight', 20/24 h counted apart from the forms and 10/24 h to one person); HCAA_DAILY_CAP
                           (default 200) for all pilots together; signing links 60/24 h and 20 per flight
  _lib/limits.ts           per-pilot counts (aircraft 50, operators 20, flights 2000, passengers 500, waypoints 1000, files
                           per parent 50), STORAGE_QUOTA_MB (300) over owned files, 3 unfinished uploads, the 1 h sweep,
                           magic bytes of uploads
  _lib/rateLimit.ts        DB token buckets (429): login and client error reports per IP, METAR, weather grid, NOTAMs, ref, share
                           creation (30/day) per pilot; takeTokens(cost) for weighted buckets (weatherFetch: Open-Meteo calls per pilot)
  _lib/routes/             session.ts, me.ts, aircraft.ts, passengers.ts, waypoints.ts, flights.ts, ref.ts, weather.ts,
                           weatherGrid.ts (the Open-Meteo proxy and shared forecast cache),
                           attachments.ts, files.ts (fileRoutes: aircraft photo/documents and operator documents, chunked),
                           shares.ts, flightShares.ts, invitations.ts, operators.ts, declarations.ts, admin.ts, notams.ts, filing.ts,
                           monitoring.ts (health, client-errors, admin/errors)
                           + index.ts (the registry)
server/server.ts           local server: API + dist/ with SPA fallback (npm start / npm run serve)
server/dev.ts              dev server: API + Vite middleware with hot reload (npm run dev)
server/syntheticOpenMeteo.ts  generated forecasts for local runs (no Open-Meteo calls unless OPEN_METEO_LIVE=1)
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
tools/build_fir.ts         AIP ENR 2.1 FIR / CTA lines + the OpenStreetMap land borders (the base map's source: the ways the
                           Greece relation shares with each neighbour's, from the Overpass query in its header, 25 m
                           Douglas-Peucker) → src/data/ref/fir.json, checked closed, simple and around the outlying
                           aerodromes; the Corfu strait and the Aegean line to Türkiye are documented approximations;
                           client map layer only (REF.fir)
tools/smoke.ts             post-deploy smoke test: npm run smoke -- https://pigsgottafly.com
.github/workflows/uptime.yml  every 10 min: /api/health and / must answer 200 (a failed run e-mails the repo owner)
tools/build_seed.ts        data/aircraft/*.json → fleetSeed(): the owner's SX-ASV/SX-ASG as the migrations leave them
                           (003, frozen, + 014; checked by tests/api/migrations.test.ts); used by the tests
data/                      aip.js, vfr.js, sun.js (made by the Python tools from the eAIP; sources for build_ref.ts),
                           aircraft/{reims-f172m,fleet,compass-cards}.json
tests/unit/                vitest: calc/ (incl. club.test.ts: all 90 club calculator cases), data/, exports/, screens/
src/**/__tests__/          vitest: map and export-model tests next to their code (also run by npm test)
tests/api/                 vitest: API, auth, migrations (PGlite in memory); sheetPdf.test.ts prints the W&B and performance
                           sheets and a navlog in a local Chrome/Chromium (CHROME; skipped when there is none), building dist/pdf.html
tests/setup/               noExternalApis.ts: the test process's fetch refuses Open-Meteo, aviationweather.gov, autorouter, NMS
                           (cgifederal-aim.com, aim.faa.gov), Notamify and the fax services
                           (vitest setupFiles and the e2e harness; startServer's close() fails the test if anything tried)
tests/helpers/             openMeteoGrid.ts: fake Open-Meteo from recorded ECMWF responses + gridApi (the real route on PGlite)
tests/e2e/                 harness.mjs (CDP; API server with mocked Open-Meteo/METAR upstreams, pages refuse external APIs), oracle.mjs (independent navlog reference), sharing.e2e.test.mjs,
                           smoke.e2e.test.mjs, lists.e2e.test.mjs (lobby and account lists), freshness.e2e.test.mjs
                           (two tabs: a profile edit / flight rename in one shows in the other),
                           flight.e2e.test.mjs (whole workflow: map drawing/snapping, panels, navlog vs oracle,
                           every export + PDF page size, W&B vs an independent sum, take-off vs club case 60)
tests/fixtures/            club-wbp-cases.json: answers of mesogeion-aeroclub.gr/wbp.php, used to cross-check W&B and performance
```

**The v2 client** has been removed from the tree but stays in git history. Copies for reference: `/private/tmp/claude-501/-Users-dionyziz-workspace-aviation-pigsgottafly/3261d83d-0148-481e-af56-405734dd7472/scratchpad/legacy/` holds `js/app.js` (UI, MD4.2 sheet, terminal-information/ATC listing, default altitudes, VFR point naming), `js/nav.js`, `js/weather.js`, `js/store.js`, `js/aircraft.js`, `css/style.css` (the MD4.2 print sheet styles), `index.html`, the v2 API (`api.mjs`, `db.mjs`, `server.mjs`) and the v2 tests (`tests/`).

## Conventions

- **Freshness**: pages read the pilot's records through `useEntity` (or `useAsync` with `invalidatedBy`), never a one-off `api.*.get()` in an effect; mutations go through `api.*` (which invalidates). The session pilot (`usePilot()`) is the 'pilot' entity, so a profile change in any page or tab, or a window focus, refreshes it.
- **Formatting**: use `src/shared/format.ts` / `date.ts` (no local `pad2`, `fmtDate`, `clockZ` copies). Local time is always Greek time (`LOCAL_TZ`), whatever the device zone. `tsconfig` is strict plus `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noImplicitOverride` and `verbatimModuleSyntax`.
- **Units**: kg, m (arms), kg·m, L, kt, ft, NM (route), m (runway), °C, hPa. Fuel densities are not per aircraft: the W&B always uses `FUEL_DENSITY` (`src/shared/fuel.ts`: AVGAS 0.72, MOGAS 0.75, Jet A-1 0.80); a stored `densityKgPerL` is ignored and the hangar saves the standard value. Dates are `YYYY-MM-DD`, clock times are `HH:MM` UTC, and record timestamps are epoch ms.
- **Imports**: `src/shared`, `src/calc`, `api/` and `tools/` use explicit `.js` extensions, because the API runs as Node ESM. `tsconfig.node.json` (NodeNext) enforces this. Client code (`src/app`, `src/features`, `src/data`) uses Bundler resolution: no extensions, and `../shared` works.
- **Nothing pilot-specific is an app default**. A new pilot starts with an empty profile (`homeAerodrome: null`, taxi and reserve `null`) and an empty hangar. Sign-up asks for nothing: the account has its e-mail only. New flight asks for the origin when there is no home aerodrome (and can make it the home aerodrome); the flight plan, the forms and "Ready to fly" (its "Your details" row) name the PIC details they lack, with a link to add them that comes back. `SETTING_SUGGESTIONS` are placeholders only. Calculations treat `null` as "not set" and warn. Only the pilot who already existed in production gets his stated values (LGTT, 15/15/60) and SX-ASV/SX-ASG, through one-time migration 003.
- **Route points** always store a name, lat and lon snapshot, plus `kind` and `refId` (aerodrome id, VFR point id `CHART/NAME`, saved waypoint id, or `null` for a custom point). Per-leg overrides are keyed by `legKey(a, b) = "<a.uid>><b.uid>"`, so inserting a point resets only the leg it splits.
- **The manifest** (`FlightDoc.crew`) is saved with the flight and stored in the `flight_crew` table. The PIC is the pilot (`passengerId: null`). `validateCrew` rules: exactly one PIC, one person per seat, seats must exist on the aircraft (`seatLayout(stations)`). Snapshots keep old forms correct. A snapshot follows its person (passenger list / profile) field by field until that field is edited on the flight (`FlightCrew.overrides`, panels/manifest.ts); "Reset from the saved details" clears the overrides.

## Data flow

1. **AuthGate** calls `GET /api/session`. In Google mode without a session it shows the GIS button, then `POST /api/login {credential}`, which sets an HttpOnly cookie. Local mode signs you in as the `local` pilot. Any 401 later dispatches `pgf:unauthorized` and brings the sign-in screen back.
2. **Lobby** calls `GET /api/flights`. "New flight" goes to `/flights/new`, which calls `POST /api/flights {}`; the server fills in the profile defaults: home → home route, taxi times, default aircraft, wind model, PIC on the manifest.
3. **Editor**: `flightStore.load(id)` returns the server copy, or the local copy while offline. `EditorProvider` holds the `FlightDoc`. Every `update(fn)` is an undo step, unless calls share a `coalesce` key within 1.5 s; it also recomputes the summary and calls `flightStore.save()`, which saves to localStorage at once and sends a debounced `PUT {flight, version}`. On 409 our copy wins on top of the server version (last writer wins, as in v2). Derived values come from the context: `legs` (buildLegs), `altitudeDefaults`, `altitudesFt`.
   Derived values the lobby shows (navlog ETE and fuel) are written with `setDerived()`: saved, but no undo step.
4. **Calculations** run on the client (`src/calc`), wired in `panels/calc.tsx` (`useFlightCalc`). Forecasts come from Open-Meteo through `GET /api/weather/grid` (`src/data/weather.ts`, `weatherGrid.ts`; the browser never calls Open-Meteo, and the CSP does not allow it). METAR/TAF come through `GET /api/weather/metar`; a METAR is used for performance when it is at most 90 min old and within 90 min of the take-off/landing time, otherwise the forecast.
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
| GET, PUT, DELETE | /aircraft/:id | GET: any access; PUT: owner or editor (403 for viewers); DELETE: owner only. PUT merges the top-level fields. Flights referencing a deleted aircraft get `aircraftId: null`. A compass card's `report` must be a file of this aircraft (400 otherwise); on PUT, reports the stored cards referenced and these do not are deleted, and unreferenced uploads older than 30 min (a save may leave before an upload ends). POST drops `report` references. |
| GET, POST | /aircraft/:id/shares | Sharing (`src/shared/sharing.ts`): GET anyone with access (owner first); POST `{email, role: 'view'\|'edit'}` by owner/editor → 201. An e-mail no account uses (case-insensitive) is invited to the app with this aircraft (`pending`, key = the address; 404 in local mode); 400 for yourself or the owner, 409 when they already have access or the invitation has it. |
| PUT, DELETE | /aircraft/:id/shares/:pilotId | Change the role / remove (owner or editor); anyone may remove themselves ("remove from my hangar"). The owner is not a share. Removing clears that pilot's default if it was this aircraft. With an invited address: that aircraft's pending share only (the invitation stays). |
| GET, POST, DELETE | /invitations[/:id[/aircraft/:aircraftId]] | Inviting pilots to the app (migration 055, `routes/invitations.ts`): `PilotInvitation[]` (open ones); POST `InviteRequest` (e-mail, note, aircraft the pilot owns or edits) → `InviteResponse`; an address with an account gets the aircraft shared at once (`existing: true`). Every sign-in with the invited address accepts it and shares the aircraft (if the inviter may still share them). E-mailed ('invite'), capped and rate-limited like shares. An invitation admits its address past `ALLOWED_EMAILS`. DELETE cancels it, or one of its aircraft. |
| POST | /aircraft/:id/attachments | (editor or owner) `AttachmentInput` (PDF/PNG/JPEG/WebP, base64, ≤ 3 MB) → 201 `AttachmentRef` (compass swing reports). |
| GET, DELETE | /aircraft/:id/attachments/:fileId | GET returns `Attachment` (`AttachmentRef` + base64 `data`). |
| GET | /aircraft/:id/log | `AircraftLogPage`: the edit log, newest first (`?before=&limit=`), anyone with access. |
| GET | /aircraft/:id/revisions | `AircraftRevisionPage`: the version history, newest first (`?before=&limit=`): every log entry but sharing, with `summary` (its History line, by name). Anyone with access. |
| GET | /aircraft/:id/revisions/:rev | `AircraftRevisionDetail`: the snapshot, the differences from the current aircraft (`from` now, `to` the version; files no longer stored say so) and `head` (the newest revision). |
| POST | /aircraft/:id/revisions/:rev/restore | (editor or owner; 403 for viewers) `AircraftRestoreRequest {head?, headAt?}`: 409 with the current `HangarAircraft` when the newest revision is not that one any more. Validated as a PUT (400, 409 for a registration in use). Writes the version as a new `restore` revision ("restored the version of … by …"), so it can be undone by restoring `previous`. Files: those of the version still stored are attached again (titles too); the others are detached, not deleted; a photo, document or swing report deleted since is skipped and named (`skipped`), as is a link to an operator no longer ours. → `AircraftRestoreResult`. |
| GET | /aircraft/:id/files | `AircraftFiles` {photo, documents} (anyone with access). The aircraft list/get also carry `photo` and `placeholder` (1–3, the picture shown without a photo; set at creation, never changed). |
| POST | /aircraft/:id/files | (editor or owner) `AircraftFileStart` {kind photo (JPEG/PNG/WebP ≤ 5 MB, resized to 1600 px in the browser) or document (PDF ≤ 80 MB), name, title, mime, size} → 201 `AircraftFile` (incomplete). |
| PUT | /aircraft/:id/files/:fileId/chunks/:seq | (editor or owner) `{data}` base64, `AIRCRAFT_FILE_CHUNK_BYTES` (2 MiB) each but the last: a POH never needs a request above the ~4.5 MB serverless limit. |
| POST | /aircraft/:id/files/:fileId/complete | All chunks in → the file is listed; a new photo replaces the old. |
| GET | /aircraft/:id/files/:fileId/chunks/:seq | `{data}`: the client assembles a Blob (src/data/aircraftFiles.ts) for the PDF viewer (iframe of a blob: URL; CSP frame-src blob:) or a download. |
| PUT, DELETE | /aircraft/:id/files/:fileId | (editor or owner) `{title}` / remove. Saving the aircraft only removes unreferenced swing *reports*. |
| GET, POST | /operators | `OperatorItem[]`: own, shared, and seen through an aircraft (view); create (you own it). |
| GET, PUT, DELETE | /operators/:id | GET any access; PUT owner or editor (merges; renames its aircraft's fallback text); DELETE owner (aircraft keep the name as text). `requiresWbPerf` needs `declarationsEmail`. |
| GET, POST, PUT, DELETE | /operators/:id/shares[/:pilotId] | As for aircraft. GET also lists who sees it through an aircraft (`direct: false`, `via`: registrations); those change by sharing the aircraft. |
| GET, POST, PUT, DELETE | /flights/:id/shares[/:key] | Sharing a flight (`FlightSharing`): as for aircraft, but an e-mail no account uses gets an invite (`pending`, key = the address) instead of 404; every sign-in with that verified address turns its invites into shares. Both e-mail the person ('share-flight'). |
| GET, POST, PUT, DELETE | /operators/:id/files… | Documents (operations manual), chunked like the aircraft files. |
| GET | /flights/:id/declarations | `DeclarationsState`: the flight's aircraft's operator, the last sending (`hash`). |
| POST | /flights/:id/declarations/send | `{content: WbPerfContent, resend?}`: PDF to the operator's declarations e-mail, pilot cc'd. Subject and body from the server's records only; the content (bounded, links and e-mail addresses removed) only draws the PDF: the website's own print of the sheets (sheetPdf.ts), its registration, aircraft, operator, date, pilot and route replaced by the server's; if the print fails, the server's writer (declarationPdf.ts) and an app_errors entry. 409 when not asked for / already sent (without resend); 429 over the sending caps; 503 e-mail not configured. |
| GET | /flights/:id/exports/navlog/email | `NavlogMailState`: the signed-in pilot's address, the last navlog of the flight e-mailed to them, whether it can be sent (and why not). Owner or a pilot the flight is shared with. |
| POST | /flights/:id/exports/navlog/email | `{content: NavlogContent}`: the navlog as shown (bounded, links and e-mail addresses removed: navlogContentOf), printed as the website prints it (sheetPdf.ts) and e-mailed to the signed-in pilot only, `<date>-navlog.pdf` ('navlog' in mail_log). No other writer: a failed print is a 502 (in mail_log and app_errors). 403 no e-mail address; 429 over the sending caps (a minute between sends of a flight); 503 e-mail or printing not available. |
| GET | /admin/pilots | `AdminPilot[]` (ADMIN_EMAILS only; 403 otherwise). `GET /session` says `admin`. |
| GET | /admin/mail?pilot=&kind= | `AdminMail[]`: the e-mail action log, newest first (300), ADMIN_EMAILS only. |
| GET | /admin/errors?status=open\|resolved\|all | `AppErrorGroup[]` (src/shared/monitoring.ts), newest first (ADMIN_EMAILS only). |
| GET | /admin/errors/:fingerprint | `AppErrorDetail` (with the last stack). POST `/admin/errors/:fingerprint/resolve` resolves it; a recurrence re-opens it and alerts. |
| GET | /health | No sign-in. `HealthResponse`: 200 when the database answers and every migration is applied, else 503. AIRAC out of date and e-mail not configured are warnings (an expired AIRAC is recorded once as a `cron` error). |
| POST | /client-errors | No sign-in. `ClientErrorReport` → 204; 429 over 30 per IP per 10 min (rate_limits bucket `clientErrors`), 413 over 16 KB. Subject to the CSRF checks (same Origin, application/json) like every POST. Recorded as kind `client` with the session's pilot, if any. |
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
| PUT | /sign/:token/details | No sign-in. The link's passenger corrects their own Form 731 row (`fullName`, `idNumber`, `phone`, checked like a passenger record): the pilot's passenger record and the flight's manifest snapshot change (the flight's version moves on). What changed (first → latest value) and whose signatures it invalidated stay on the link (`form_links.details_changed`, migration 056) until they sign, and go in the pilot's "signed" e-mail. 20/hour per link. |
| GET | /ref/airac, /ref/bundle, /ref/{aerodromes,runways,airspaces,fis,vfr-points,vfr-routes,atc-units,areas} | Current AIRAC, read-only. /ref/bundle has an ETag by AIRAC (304 on If-None-Match) and `Cache-Control: private, max-age=86400`. |
| GET | /weather/metar?ids=… | METAR + TAF from aviationweather.gov (≤ 6 ICAO ids; the client splits longer lists), cached per station; stale reports up to 3 h when upstream fails. |
| GET | /weather/grid?kind=wind\|hazard&model=&from=&to=&locs=k;k…[&fresh=1] | `WeatherGridResponse` (src/shared/weatherGrid.ts): hourly Open-Meteo data per grid node (`38.25,23.75`, on the model's grid) or aerodrome (`p:37.936,23.945`, winds only, ≤ 12), ≤ 100 locations, ≤ 2 days. Served from `weather_cache` (shared by every pilot) for the model's latest run (meta.json, checked again once the next run is due; `fresh=1` at most once a minute); missing locations fetched in batched multi-location requests. Each Open-Meteo call is weighted as Open-Meteo counts it and taken from `OPEN_METEO_DAILY_BUDGET` (default 8000/UTC day, all pilots) and the pilot's `weatherFetch` bucket (2000/day); over either, or when Open-Meteo refuses, the location is null and `message` says why (never a 5xx). Rate-limited per pilot (200/10 min). |

Tenancy: every query includes `pilot_id = <session pilot>`. Another pilot's record answers 404. References between owned rows are composite `(id, pilot_id)` foreign keys (flight_crew → passengers), so the database itself prevents cross-pilot references. `tests/api/api.test.ts` checks isolation for every entity.

Operators (migration 018, `api/_lib/operators.ts`, `tests/api/operators.test.ts`) are shared the same way (`operator_shares`), and everyone with access to an aircraft views its operator: derived on every query, so it ends with the aircraft's share unless the operator is shared directly. Assigning an aircraft to an operator needs edit access to the operator. `Aircraft.operator` is the linked operator's name (joined as `operator_name`), else the old free text.

Shared aircraft are the exception (migration 013, `api/_lib/access.ts`, `tests/api/sharing.test.ts`): `aircraft.pilot_id` is the owner, `aircraft_shares` gives other pilots `view` (see it, use it on their flights) or `edit` (also change it and its files, manage sharing). Only the owner deletes. No access answers 404, too little 403. flights.aircraft_id and pilots.default_aircraft_id are plain FKs to aircraft(id) (ON DELETE SET NULL) and the API checks access. When access ends, the pilot's flights keep the aircraft id: the editor shows it as unavailable, a PUT keeps that unchanged id without the seat checks, forms/filing/exports see no aircraft; the pilot's default is cleared. Attachments keep pilot_id = owner.

Version history (migration 060, `api/_lib/aircraftLog.ts`, `tests/api/aircraftRevisions.test.ts`): every aircraft_log entry that changes the aircraft or its files (creation, an editing session, a file or photo change, a restore; not sharing) keeps `snapshot`, the aircraft as it left it: the AircraftInput record and the photo and documents attached, as file metadata (the content stays in aircraft_attachments, never copied). One pilot's saves within AIRCRAFT_LOG_COALESCE_MS are one entry, so one revision per editing session, its snapshot updated by each save. All revisions are kept: a snapshot is the aircraft's jsonb (a few kB, mostly the performance tables), so even hundreds of sessions are well under a megabyte per aircraft; prune the oldest if that ever matters. Restoring never deletes a file: what the version does not have is `detached` (listed nowhere, readable by no route, still counted in the owner's quota) so that undoing the restore can attach it again. Files deleted by hand stay deleted: a version referring to one restores without it. Swing reports a restore leaves unreferenced stay until a later save sweeps them (the usual 30-minute rule).

Shared flights (migration 054, `access.ts` `flightFor`, `api/_lib/routes/flightShares.ts`, `tests/api/flightSharing.test.ts`): `flights.pilot_id` is the owner, `flight_shares` gives `view` (read the flight, its briefing, filing and forms state; GET answers `Flight.access` with the owner, their details and settings and the flight's aircraft as the owner sees it) or `edit` (also PUT the flight and its manifest, the GenDec override, manage sharing). Owner only: trash/restore, filing (file, delay, cancel, refresh), Form 731/GenDec sends and signing links, declarations. Rows kept per pilot for the flight (flight_crew, flight_filings, flight_notams, the forms' tables) always use the owner's id. A shared flight in its owner's trash is out of reach of the others. GET /flights lists shared flights with `sharedBy` and `role` (never in the trash); a copy is the copier's.

## NOTAM sources

`GET /api/flights/:id/notams` (`api/_lib/routes/notams.ts`) briefs from every NOTAM source available to the pilot on that flight, together (`tests/api/notamSources.test.ts`, `tests/api/nmsSource.test.ts`, `tests/api/briefing.test.ts`).

- **Driver** (`api/_lib/notamSources/types.ts`): `{ id, label, availableFor({ pilotId, ownerId }), fetch({ locations, window, signal }) → RawNotam[], timeoutMs?, cacheTtlMs? }`. `locations` are item A codes (the route's aerodromes, alternates, aerodromes near the route, the FIR LGGG); `window` is block off − 1 h … block on + 1 h. `RawNotam` is the common form: series/number/year, type N/R/C and the NOTAM it replaces or cancels, the Q line (FIR, code letters 2–3 and 4–5, traffic, purpose, scope, lower/upper FL, centre and radius), items A–G (B/C as epoch ms, C `null` = PERM, EST), the ICAO text when the source gives it, the issue time when it does, and the source id. A source that only gives the text is read with `icao.ts`.
- **Licensing gate**: `availableFor` decides whether a source is queried at all for this pilot and flight, so nothing it returns can reach a pilot it is not for. autorouter (`autorouter.ts`): only the `AUTOROUTER_PILOTS`, only on their own flights (its licence is the account's). The international NOTAM feed (`nms.ts`): every pilot (its terms allow redistribution). Notamify (`notamify.ts`): every pilot (the app's own key). The stored briefing (`flight_notams`) records the sources it came from and is served (fresh or as the fallback) only to a pilot entitled to all of them.
- **Multiplexing** (`multiplex.ts`): the available sources are queried at once, each with its own time limit (25 s; aborted after it). A failing or slow source costs only its own NOTAMs; every source's outcome (`ok` / `error` / `timeout`, count, message, and its freshness: `newestIssued`, the latest issue time among its NOTAMs, and `newestNotam`, its highest number of the busiest series of a queried FIR, to spot a source lagging behind) goes into `NotamBriefing.sources` and the panel's meta line ("157 NOTAMs from autorouter, International NOTAM feed, Notamify"). The briefing is `error` only when every source failed (then the stored briefing, if any, with "Could not refresh"). A briefing with a failed source is not served from the store again.
- **Merging** (`merge.ts`): one record per NOTAM. Identity: series + number + year, of the same office: equal Q-line FIRs, or, when one lacks a FIR, overlapping locations (item A + FIR). The most complete record wins (start time, Q-line coordinates, FIR, Q code, item E, F/G, ICAO text; then NOTAM_SOURCES order) and its gaps are filled from the others; `Notam.sources` lists every source that had it. A NOTAMR removes the NOTAM it replaces and a NOTAMC the one it cancels (same office), along whole chains; the NOTAMC itself stays, hidden by the relevance rules. The merged list then goes through `assessNotams` as before. A NOTAM of another state's office naming the FIR (Q-line FIR not LG…, e.g. Turkish LTXX/LTBB NOTAMs with item A `LTBB LGGG`) is relevant only for an aerodrome the flight uses or when its area is within the corridor, never as "whole FIR" or "no position given" (`homeFir`).
- **Caching** (`cache.ts`): a source with `cacheTtlMs` (NMS, Notamify: 15 min) is cached per source, location and UTC-day window in `notam_source_cache` (shared by every instance), and asked only for the locations it has no fresh rows for, with the window widened to whole UTC days, so the FIR is fetched once for every flight of the day. autorouter (free) is not cached there. On top, each flight's briefing is stored in `flight_notams` for 10 minutes. `refresh=1` skips both.
- **Order**: `NOTAM_SOURCES` (e.g. `autorouter,nms,notamify`) lists the sources to use, first preferred; unset, every configured one in that order (autorouter, nms, notamify).
- **NMS** (`nms.ts`): the FAA NOTAM Management Service API (NMS-API). Its terms allow redistribution but not characterizing the data as FAA data, so the pilot sees it as "International NOTAM feed" (label, error messages, About and Privacy pages); only code and these docs name the provider. `POST {NMS_BASE}/v1/auth/token` (`grant_type=client_credentials`, HTTP Basic `NMS_CLIENT_ID:NMS_CLIENT_SECRET`) → a bearer token for `expires_in` 1799 s, kept per server instance and renewed a minute before it expires, or once on a 401. `GET {NMS_BASE}/nmsapi/v1/notams?location=LGAV` with `nmsResponseFormat: GEOJSON` → `{ status, data: { geojson: Feature[] } }` (a location with nothing: `{ status, data: {} }`). One location per request (the API takes one), 4 at a time; it returns the NOTAMs active now and later, and the window is applied here. Fields come from `notamTranslation[type ICAO].formattedText` (`icao.ts`), else from `coreNOTAMData.notam` (`number`, `type`, `selectionCode`, `affectedFir`, `traffic`/`purpose`/`scope`, `minimumFl`/`maximumFl`, `coordinates` + `radius`, else the geometry's Point, `effectiveStart`/`effectiveEnd` (`PERM`), `estimated`, `schedule`, `text` = item E, `lowerLimit`/`upperLimit`, `issued`). No documented rate limit; cached 15 minutes anyway. Hosts: pre-production `https://api-staging.cgifederal-aim.com` (the current credentials), production `https://api-nms.aim.faa.gov` (separate credentials). Coverage (pre-production, Nov 2026): every Greek-issued NOTAM autorouter (EUROCONTROL) had for 54 aerodromes and LGGG but the newest few, plus series M; it also returns the Turkish office's NOTAMs naming LGGG (FIR LTXX). `npx tsx tools/nms_smoke.ts [LGAV LGGG …] --env <.env.local>` checks the live service.
- **Notamify** (`notamify.ts`, https://skymerse.gitbook.io/notamify-api): `GET https://api.notamify.com/api/v2/notams/raw?location=…(≤5)&starts_at&ends_at&page&per_page=30` with `Authorization: Bearer NOTAMIFY_API_KEY` (the raw endpoint: no AI interpretation, which the app does not use). 1 credit per page; 20 requests a minute (one 429 with a short Retry-After is waited out); starts_at no earlier than a day ago (moved up). Locations go 5 to a request, every page is read, and a briefing spends at most `NOTAMIFY_MAX_CREDITS` (default 40) pages: past that the source fails rather than give an incomplete list. Fields come from the ICAO text (`icao_message`), else from the record (`notam_number`, `notam_type`, `referenced_notam_number`, `qcode`, `starts_at`/`ends_at`, `is_permanent`, `is_estimated`, `message`).
- **Adding a source**: a driver module in `api/_lib/notamSources/`, its id in `NotamSource` (`src/shared/briefing.ts`) and `NOTAM_SOURCE_IDS`, its settings in `ApiConfig`/`configFromEnv`, and a line in `configuredSources`.

**Adding a route**: add it to the module that owns it (e.g. `api/_lib/routes/weather.ts` exports `routes: Route[]`). Every module is already listed in `routes/index.ts`, so the dispatcher needs no edits. A handler returns the body (200), `reply(status, body, headers)`, or `undefined` (204), and throws `HttpError` for errors.

## Filing backends

Flight plans are filed through drivers behind one interface (`api/_lib/filers/types.ts`), so a backend that
fails does not stop the pilot from filing:

```ts
interface Filer {
  id: 'autorouter' | 'fax';
  labelFor: (adep: string) => string;            // 'autorouter', 'Fax to Athens Central AIS'
  capabilities: { file; delay; cancel; status; ackRej: boolean };
  availableFor: (pilot, { adep }) => { available: boolean; reason: string | null };
  file:   (db, plan)            => Promise<{ providerId, status, message, logText, faxTo?, after? }>;
  delay:  (db, ref, newEobt)    => Promise<{ status?, message, logText, sent?, after? }>;
  cancel: (db, ref, reason)     => Promise<{ status?, message, logText, sent?, after? }>;
  status: (db, ref)             => Promise<{ status, eobt?, logText }>;
  transmitted: (ref, message)   => Promise<AftnMessage[]>;   // for the e-mail copy
}
```

A failure is a `FilerError(message, httpStatus, transient)`. It is transient when the service is down,
timed out or refused for its own reasons (5xx, 429, network). A refusal of the plan itself (autorouter's
parse errors, the caps) is not transient.

- **autorouter** (`filers/autorouter.ts`): wraps `AutorouterClient` unchanged. It has every capability,
  including ATC's ACK/REJ through the plan status. It is only for `AUTOROUTER_PILOTS` and needs `AUTOROUTER_FILING=1`.
- **fax** (`filers/fax.ts`): the plan is printed by the website's own print path. `sheetPdf.ts` `chromiumFaxPdf`
  renders `src/pdf/` kind `fplfax` (`FaxSheets.tsx`) as two pages:
  - a cover page: to the unit, from the pilot (name, phone, e-mail), flight id, EOBT, route, the FPL
    message, and "please acknowledge to …";
  - the filled ICAO form, drawn from the filed message (`parseFpl.ts`).

  The PDF is faxed through the deployment's fax service (`filers/faxProviders.ts`). Where it goes depends on
  the departure (`filers/faxRoutes.ts`): `FAX_ROUTES` overrides by ICAO, and the default is Athens Central AIS,
  +30 210 35 32 635, 24 h, per AIP GEN 3.1.5.3 and AOPA Hellas 2025. `FAX_AIS_NUMBER` replaces the default
  number. The number used is stored on the filing (`flight_filings.fax_to`), and the DLA and CNL go to the same
  number, as one cover page with the ICAO message (`filers/icaoMessages.ts`).

  Capabilities: file, delay, cancel and status (delivery). There is no ACK/REJ: the office re-keys the plan by
  hand. Statuses: `sending` → `delivered` | `failed`. A failed plan fax is final and can be filed again; a failed
  DLA or CNL puts the plan back as it was.

  Every fax is a `fax_log` row (migration 057), written before the print and capped (429):
  - 10 per pilot and 6 per flight per 24 h;
  - `FAX_DAILY_CAP` (default 100) for the whole service;
  - anything the service accepted counts, delivered or not.

  Delivery comes back by webhook, `POST /api/filing/fax/webhook/:provider` (`Route.webhook`: no session and no
  JSON/same-origin check; the handler verifies the signature on the raw body), or by polling on "Refresh status".
  Either way it is applied idempotently (`applyDelivery`) and logged as `delivery`.

Selection (`filers/select.ts`): `FILERS` orders the backends (default `autorouter,fax`; an unconfigured fax
service is left out). A flight is filed by the first backend available for the pilot and its departure. On a
transient failure the next one is tried, and each attempt is logged with `via`. The pilot can pick one
(`FileRequest.via`), and then there is no fallback.

`flight_filings.provider` and `provider_id` record which backend filed the plan and its reference. Delay,
cancel and refresh always go to that backend, and are refused with 503 if it is no longer available.
`FilingState.filers` lists each backend with its label, capabilities and availability. The UI
(`FilingPanel.tsx`) says which service filed the plan and what it can report, e.g. "Delivered by fax to Athens
Central AIS (+30 210 3532635) — no acknowledgement".

### Fax services

The comparison, researched 2026-11, to send 2-page PDFs to +30 from a Node server:

| Service | Greece (+30) | Delivery report | PDF | Account | Status |
|---|---|---|---|---|---|
| Telnyx Programmable Fax (first choice; implemented, `FAX_PROVIDER=telnyx`) | yes; $0.007/page plus the per-minute voice rate to Greece, which is in the rate deck and not published per page ([pricing](https://telnyx.com/pricing/fax)) | webhooks `fax.delivered` / `fax.failed`, **signed with Ed25519** (`telnyx-signature-ed25519` over `timestamp\|body`) ([docs](https://developers.telnyx.com/docs/messaging/messages/receiving-webhooks)) | multipart `contents` ([send a fax](https://developers.telnyx.com/api-reference/programmable-fax-commands/send-a-fax)) | pay-as-you-go, no monthly fee; Level 2 verification for international; one number (~$1/mo) | active |
| **Sinch Fax v3** (ex-Phaxio; the default) | likely; no per-country rate published; $0.045/page headline ([pricing](https://sinch.com/apis/fax-api/)) | one `FAX_COMPLETED` callback, **unsigned**: our URL carries an HMAC of the fax log id | multipart `file` | prepaid balance | active ([v2→v3](https://developers.sinch.com/docs/fax/v2-v3migration)) |
| Fax.Plus (Alohi) | yes | HMAC-signed webhooks | upload, then send | API only on Enterprise (from ~$960/yr) ([pricing](https://www.fax.plus/pricing)) | active |
| eFax Corporate (Consensus) | yes | HMAC (on request) | — | enterprise contract | active |
| Documo / mFax | international disabled by default, extra cost | basic auth / OAuth only | multipart | subscription + Enterprise API | active |
| Notifyre | Greece listed, rate after login | webhooks | — | pay per page | active |
| ClickSend | €0.0431/page to Greece | — | — | **fax closed to new customers** ([pricing](https://www.clicksend.com/us/pricing/gr/)) | closed |
| Twilio | — | — | — | — | **shut down 2021-12-17** |
| SRFax, InterFAX, FAXAGE, RingCentral | stale API / no international (FAXAGE) / subscription add-on | unsigned or token echo | — | — | — |

Telnyx was the first choice, as the only pay-as-you-go service with **signed** delivery webhooks and a plain
multipart PDF upload that reaches Greece. Its sign-up refused the pilot's accounts, so Sinch is the default:
pay-as-you-go with prepaid credit, multipart PDF, and polling and callbacks.

Sinch does not sign its callbacks, so each fax's callback URL carries its `fax_log` id and our HMAC-SHA256 of
that id under `FAX_WEBHOOK_SECRET`. The token is compared in constant time; a wrong or missing token, or no
secret configured, gets a 404. The report must also name the fax that log row sent.

Sinch needs `FAX_PROJECT_ID`, `FAX_API_KEY` (key id), `FAX_API_SECRET` and `FAX_WEBHOOK_SECRET`, and optionally
`FAX_SERVICE_ID` and `FAX_FROM`. To use Telnyx, set `FAX_PROVIDER=telnyx` with `FAX_API_KEY`, `FAX_CONNECTION_ID`,
`FAX_FROM` and `FAX_WEBHOOK_PUBLIC_KEY`.

Adding a service means one more `FaxProvider` in `faxProviders.ts`, with `send`, `get` and `webhook` (verify, then
report `{ faxId, state, error, pages }`), plus its settings in `faxFromEnv`.

Tests never fax. `tests/setup/noExternalApis.ts` refuses telnyx.com and sinch.com, and the services are mocked
(`tests/api/faxFiling.test.ts`). `FAX_DRY_RUN=1` prints the PDF and logs it (and writes it to `FAX_DRY_RUN_DIR`)
instead of sending, then reports it delivered (`tests/e2e/faxFiling.e2e.test.mjs`).

## Database, migrations and seeds

- Tables: `pilots`, `sessions`, `aircraft`, `passengers`, `waypoints`, `flights`, `flight_crew`, `aircraft_attachments` (file content, base64), `aircraft_shares` (aircraft, pilot, role view|edit), `operators`, `operator_shares`, `operator_files` + `operator_file_chunks`; shared `ref_airac`, `ref_aerodromes`, `ref_runways`, `ref_airspaces`, `ref_fis`, `ref_waypoints` (VFR points), `ref_vfr_routes`, `ref_atc_units`, `ref_sun`, `ref_areas` (ENR 5, migration 017); `schema_migrations`. Large owned documents (aircraft fuel, mass_balance, performance, equipment, compass_cards; flight route, leg_overrides, atc, options, summary) are jsonb. The ref tables keep the full record in `doc` jsonb.
- Migrations are TS modules (SQL as a default-exported string, or a `run(q)` function) listed in `api/_lib/migrate.ts`, so the Vercel bundle contains them. The runner records each one in `schema_migrations`, applies each in its own transaction under a transaction-scoped advisory lock (`pg_advisory_xact_lock`) and re-checks inside it whether another instance applied it meanwhile (Neon's pooler does not hold session locks), plus an in-process queue for PGlite. It runs from `openDb()`: on server start, in tests, and on the Vercel cold start before serving.
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
npm run typecheck    # TypeScript 7 (the typescript7 alias) for the client (tsconfig.app.json) and node/api/tools (tsconfig.node.json)
npm run lint         # ESLint (typescript-eslint with types, react-hooks, @eslint-react, sorted imports); lint:fix fixes
npm run format       # Prettier (format:check in CI); CSS, Markdown, generated data and applied migrations are left alone
npm run knip         # unused files, exports and dependencies
npm test             # vitest: tests/unit + tests/api
npm run test:e2e     # vite build + headless Chrome (CDP, SwiftShader WebGL) smoke test
npm run build        # dist/
npm run smoke -- https://pigsgottafly.com   # post-deploy check (health, SPA, an asset, /api/session)
npm run ref          # regenerate src/data/ref/*.json + migration 002 from data/*.js
npx tsx tools/build_seed.ts   # print the owner's seeded aircraft (003 is applied and frozen)
```
The W&B and performance sheets are computed in the browser (weather, models), so the export draws them from `WbPerfContent` (text as printed + chart and runway-diagram geometry) and sends that same content; the server prints it with the very same sheet components and CSS (dist/pdf.html in headless Chromium: `@sparticuz/chromium` on Vercel, about 66 MB of the function; the vector PDF the browser's Print gives), so the operator gets what the pilot saw. Linux has neither Arial nor Menlo: src/pdf/pdf.css maps them to the metric-compatible Arimo and DejaVu Sans Mono (public/fonts) where they are not installed. The client hashes `wbPerfText` (SHA-256, crypto.subtle) the way the server does, to show "changed since it was sent".

The signed-in pilot is one copy for the app (AuthGate): `setPilot` is posted to the other tabs (BroadcastChannel) and a tab re-reads `/api/me` when it comes to the foreground, so details fixed in an export's tab show everywhere at once. Exports read it with `usePilot()`, never their own `GET /me`.

Abuse limits (env, optional): `HCAA_DAILY_CAP` (forms to the HCAA per 24 h, all pilots; default 200), `STORAGE_QUOTA_MB` (per pilot; default 300), `OPEN_METEO_DAILY_BUDGET` (Open-Meteo calls per UTC day, all pilots; default 8000).

Forecasts: local runs (`npm run dev`, `npm start`, the tests) never call Open-Meteo: they get generated data (`server/syntheticOpenMeteo.ts`, the source line says "synthetic data") unless `OPEN_METEO_LIVE=1`; tests inject a fake built from recorded responses (`tests/helpers/openMeteoGrid.ts`). `tests/unit/data/weatherEquivalence.test.ts` checks that the proxy gives the same surface conditions (QNH), source line and hazards as the old browser-side fetching (frozen in `tests/unit/data/legacy/weatherBefore.ts`), that the winds aloft are the bilinear blend of the grid nodes around each leg midpoint (exact at a node, the u/v mean in the middle of a cell, linear on an edge), and that the navlog stays within a few knots and minutes of the old nearest-node one.

Winds aloft cost: each leg asks for the up-to-four nodes around its midpoint (fewer on a cell edge or a node; neighbouring legs share them), so a fresh flight costs about 4× the wind nodes of the nearest-node scheme (measured on the test routes: 13 legs, 13 → 48 nodes). A wind node is 45 variables, i.e. 4.5 Open-Meteo calls; a 2-leg flight's weather (winds + aerodromes + hazard corridor) went from ≈ 78 to ≈ 105 calls, a 6-leg one from ≈ 170 to ≈ 250, before any sharing through the cache.

With `GOOGLE_CLIENT_ID` (and optionally `ALLOWED_EMAILS`, `ADMIN_EMAILS`) set, local runs use Google sign-in. With `DATABASE_URL=postgres://…` they use that database. Never point a local run at the production database. Without `GOOGLE_CLIENT_ID` the local server refuses a `postgres://` `DATABASE_URL` (local mode would serve an unauthenticated 'local' pilot from that database) unless `LOCAL_MODE_ON_POSTGRES=1` is set for a disposable Postgres. The built client is served locally with the same security headers (CSP, `X-Frame-Options: DENY`) that `vercel.json` sets in production, so the e2e suite fails on any CSP violation.

Deployment: Vercel builds with `vite build` to `dist/`. `vercel.json` rewrites `/api/*` to the function and every other non-file path to `index.html` (the SPA). HTML is served with no-cache, `/assets/*` is immutable, and www redirects to the apex. `.vercelignore` drops aip/, trn-docs/, tools/, tests/ and server/.

## Monitoring

Errors are recorded in-house (`api/_lib/monitor.ts`, table `app_errors`, migration 040), grouped by a fingerprint (kind, message with numbers/ids/quoted values blanked, route pattern, and for server errors the top stack frame without line numbers):
- **server**: every unhandled error in the dispatcher and every 5xx answer (HttpError or Reply), with the route pattern, method, status, the pilot id, user agent and release (`VERCEL_GIT_COMMIT_SHA`);
- **migration**: `openDb()` runs `migrateReporting()`: a failed migration is logged as `[pgf-migration-failed]`, recorded (the monitor creates its tables itself when 040 has not run yet) and e-mailed, then rethrown; `api/index.ts` logs `[pgf-startup-failed]`, answers 500 (`/api/health` 503) and retries the start-up on the next request;
- **client**: `src/app/errorReporter.ts` (window error, unhandledrejection, ErrorBoundary, API 5xx; stale-chunk errors and extension noise skipped; one report per distinct error per 10 min, 20 per page) → `POST /api/client-errors`;
- **cron**: health-check warnings (an expired AIRAC).

No request bodies are stored; e-mail addresses and long tokens are masked, URLs are paths with ids as `:id`. The admins (`ADMIN_EMAILS`) get an e-mail (`sendSystemMail`) for a new group, a recurrence after 24 h quiet or after "resolve", a burst (more than 20 in 10 min) and every migration failure, at most one per group per hour (a resolved group that recurs is exempt) and 20 a day overall. Recording and alerting never throw. They are listed on `/admin/errors`. Uptime: `.github/workflows/uptime.yml` polls `/api/health` and `/` every 10 minutes.

## Contracts

The contracts above (`src/shared/**`, `state.tsx`'s `useEditor()`, the API routes) change only together with
their users, and an applied migration is never edited.
