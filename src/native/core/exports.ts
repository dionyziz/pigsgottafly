// File & forms: the documents of a flight as the website's export pages build them. The FPL message
// (the AFTN text POST /filing takes), the navlog sheets (the body of POST /exports/navlog/email), the
// W&B and performance sheets (the body of POST /declarations/send), Form 731, the General
// Declaration and the NOTAM briefing.
import { briefingModel as briefingModelOf } from '../../features/exports/briefing/model';
import { routeTextWith } from '../../features/exports/form731/common';
import { form731ModelWith } from '../../features/exports/form731/model';
import { buildFpl, oneLine } from '../../features/exports/fpl/fpl';
import { fplInputWith, fplWarnings } from '../../features/exports/fpl/input';
import { fplPlanning } from '../../features/exports/fpl/planning';
import { genDecModelWith } from '../../features/exports/gendec/model';
import { navlogDocumentOf } from '../../features/exports/navlog/model';
import { computeExportCalc } from '../../features/exports/wb/exportCalc';
import { wbPerfOf } from '../../features/exports/wbperf/declaration';
import { type Flight, navlogContentOf, type Passenger, type Pilot, wbPerfText } from '../../shared';
import type { NotamBriefing } from '../../shared/briefing';
import { flightPilot } from '../../shared/sharing';
import { arg, calcRef, type CoreRef, type FlightCallInput, flightContext, type Json, plain, refOf } from './shared';

/** The pilot the documents are made for (useFlightPilot): the session pilot, or a shared flight's owner. */
const sheetPilot = (c: ReturnType<typeof flightContext>): Pilot | null =>
  c.session ? flightPilot(c.session, c.flight) : null;

/**
 * The FPL message as the FPL page builds it (fplInputFrom + buildFpl): `fpl` is { fields, message,
 * lines, complete, warnings, fixes }, `oneLine` the message on one line, `warnings` the page's list
 * ({ text, fix? }: the aircraft first). Its EET comes from the navlog with the winds aloft, the
 * endurance from the fuel plan.
 */
export function fplMessage(input: Json<FlightCallInput>) {
  const c = flightContext(arg(input));
  const { navlog, fuel } = fplPlanning({
    flight: c.flight,
    aircraft: c.aircraft,
    settings: c.settings,
    legs: c.setup.legs,
    weather: c.weather,
    ref: calcRef(c.ref),
  });
  const fpl = buildFpl(
    fplInputWith(
      { flight: c.flight, aircraft: c.aircraft, pilot: c.pilot, navlog, fuel },
      c.ref.bundle.aerodromes,
      c.ref.find,
    ),
  );
  return plain({
    fpl,
    oneLine: oneLine(fpl),
    warnings: fplWarnings(fpl, { aircraftId: c.flight.aircraftId, aircraftFound: !!c.aircraft }),
  });
}

/**
 * The MD 4.2 navlog sheets as the navlog page builds them: `document` is { sheets, terminal,
 * warnings, sources } and `content` the body of POST /api/flights/:id/exports/navlog/email (the
 * sheets, normalized as the server takes them).
 */
export function navlogContent(input: Json<FlightCallInput>) {
  const c = flightContext(arg(input));
  const document = navlogDocumentOf({
    flight: c.flight,
    aircraft: c.aircraft,
    settings: c.settings,
    weather: c.weather,
    metar: c.metar,
    ref: calcRef(c.ref),
    nowMs: c.nowMs,
  });
  return plain({ document, content: navlogContentOf({ sheets: document.sheets }) });
}

/**
 * The MD 4.3 loading sheet and the MD 4.4 performance log as the W&B + performance page builds them:
 * `wb` and `perf` the sheet models (with their verdicts), `content` the body of POST
 * /api/flights/:id/declarations/send, `text` what the server hashes to tell a changed sheet
 * (SHA-256, base64url) and `warnings` the page's list.
 */
export function wbPerfContent(input: Json<FlightCallInput>) {
  const c = flightContext(arg(input));
  const pilot = sheetPilot(c);
  const calc = computeExportCalc({
    doc: c.flight,
    aircraft: c.aircraft,
    settings: c.settings,
    weather: c.weather,
    metar: c.metar,
    nowMs: c.nowMs,
    ref: calcRef(c.ref),
  });
  const r = wbPerfOf({
    doc: c.flight,
    aircraft: c.aircraft,
    pilot,
    calc,
    route: routeTextWith(c.flight.route, c.ref.find),
  });
  return plain({ ...r, text: wbPerfText(r.content) });
}

/**
 * Form 731 (`kind: '731'`) or the General Declaration (`kind: 'gendec'`) as the forms pages fill them,
 * with what is missing as `warnings` and each one's Fix in `fixes`. `pilot` is GET /api/me;
 * `passengers` GET /api/passengers (details the manifest snapshots lack).
 */
export function formModel(
  input: Json<{
    kind: '731' | 'gendec';
    flight: Flight;
    aircraft?: FlightCallInput['aircraft'];
    pilot: Pilot;
    passengers?: Passenger[] | null;
    ref?: CoreRef | null;
  }>,
) {
  const i = arg(input);
  const ref = refOf(i.ref);
  const flight = i.flight;
  const aircraft =
    (flight.aircraftId ? [i.aircraft, flight.access?.aircraft].find((a) => a?.id === flight.aircraftId) : null) ?? null;
  const props = { flight, aircraft, pilot: flightPilot(i.pilot, flight), passengers: i.passengers ?? [] };
  if (i.kind === 'gendec') return plain(genDecModelWith(props, ref.find));
  if (i.kind === '731') return plain(form731ModelWith(props, ref.find));
  throw new Error(`unknown form ${String(i.kind)}`);
}

/** The NOTAM briefing laid out for print (GET /api/flights/:id/notams), as the briefing page shows it. */
export function briefingModel(input: Json<{ flight: Flight; briefing: NotamBriefing | null }>) {
  const i = arg(input);
  const f = i.flight;
  return plain(briefingModelOf({ doc: f, title: f.summary?.title || f.title, briefing: i.briefing ?? null }));
}
