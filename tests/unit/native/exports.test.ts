// The core's File & forms documents against the website's export pages' models, for the same flight
// and the same weather answers: the FPL message, the navlog sheets, the W&B and performance sheets,
// Form 731, the General Declaration and the NOTAM briefing.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { buildLegs } from '../../../src/calc';
import { REF, runwaysOf, SUN_TABLES } from '../../../src/data/ref';
import { flightWeatherPlan } from '../../../src/data/useFlightWeather';
import { clearCache, fetchRouteWeather } from '../../../src/data/weather';
import { decodeMetarTafResponse } from '../../../src/data/weatherMetar';
import { briefingModel as webBriefing } from '../../../src/features/exports/briefing/model';
import { routeText } from '../../../src/features/exports/form731/common';
import { type Form731Model, form731Model } from '../../../src/features/exports/form731/model';
import { buildFpl, oneLine } from '../../../src/features/exports/fpl/fpl';
import { fplInputFrom, fplWarnings } from '../../../src/features/exports/fpl/input';
import { fplPlanning } from '../../../src/features/exports/fpl/planning';
import { genDecModel } from '../../../src/features/exports/gendec/model';
import { navlogDocumentOf } from '../../../src/features/exports/navlog/model';
import { computeExportCalc } from '../../../src/features/exports/wb/exportCalc';
import { wbPerfOf } from '../../../src/features/exports/wbperf/declaration';
import {
  briefingModel,
  declarationText,
  formModel,
  fplMessage,
  navlogContent,
  wbPerfContent,
  weatherRequests,
} from '../../../src/native/core';
import { type Flight, navlogContentOf, type Passenger, wbPerfText } from '../../../src/shared';
import { fakeOpenMeteo, gridApi } from '../../helpers/openMeteoGrid';
import { AC, ad, API_REF, briefing, flight, METAR_ANSWER, notam, NOW, PILOT, ROUTE } from './fixtures';

const json = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

let api: Awaited<ReturnType<typeof gridApi>>;
beforeAll(async () => {
  api = await gridApi({ fetch: fakeOpenMeteo().fetch, now: () => NOW });
});
afterAll(() => api.close());

/** The answers the app fetches for the core, and the same weather through the website's loaders. */
async function weatherOf(f: Flight) {
  const answers: Record<string, unknown> = {};
  for (const p of weatherRequests({ flight: f, ref: API_REF, now: NOW })) {
    const rel = p.slice('/api/'.length);
    answers[p] = rel.startsWith('weather/metar') ? METAR_ANSWER : await api.get(rel);
  }
  clearCache();
  const legs = buildLegs(f.route, f.date);
  const plan = flightWeatherPlan({
    date: f.date,
    model: f.options.windModel,
    route: f.route,
    options: f.options,
    legs,
  });
  const weather = await fetchRouteWeather({
    date: f.date,
    model: f.options.windModel,
    legMidpoints: plan.mids,
    departure: plan.depLoc,
    destination: plan.destLoc,
    stops: plan.stops.map((s) => s.loc),
    get: api.get,
    now: () => NOW,
  });
  return { answers, legs, weather, metar: decodeMetarTafResponse(METAR_ANSWER) };
}

const webRef = {
  aerodromes: REF.aerodromes,
  vfrPoints: REF.vfrPoints,
  vfrRoutes: REF.vfrRoutes,
  airspaces: REF.airspaces,
  fis: REF.fis,
  sunTables: SUN_TABLES,
  runwaysOf,
  terrain: null,
};

const cases: Record<string, () => Flight> = {
  'LGTT → DAPORI → KORINTHOS → LGMG': () => flight(ROUTE()),
  'with a stop at LGMG and back': () => {
    const r = [ad('LGTT'), ad('LGMG'), ad('LGTT')];
    return flight(r, {
      options: { ...flight(r).options, aerodromeRequests: [{ pointUid: r[1].uid, kind: 'stop', stopMin: 30 }] },
    });
  },
};

describe.each(Object.entries(cases))('%s', (_, make) => {
  test('fplMessage: the FPL page’s message and warnings', async () => {
    const f = make();
    const wx = await weatherOf(f);
    const out = fplMessage({ flight: f, aircraft: AC, pilot: PILOT, ref: API_REF, weather: wx.answers, now: NOW });
    const { navlog, fuel } = fplPlanning({
      flight: f,
      aircraft: AC,
      settings: PILOT.settings,
      legs: wx.legs,
      weather: wx.weather,
      ref: webRef,
    });
    const fpl = buildFpl(fplInputFrom({ flight: f, aircraft: AC, pilot: PILOT, navlog, fuel }));
    expect(out.fpl).toEqual(json(fpl));
    expect(out.oneLine).toBe(oneLine(fpl));
    expect(out.warnings).toEqual(json(fplWarnings(fpl, { aircraftId: 'ac1', aircraftFound: true })));
    expect(out.fpl.message).toMatch(/^\(FPL-SXASV-VG/);
  });

  test('navlogContent: the navlog page’s sheets and the e-mail body', async () => {
    const f = make();
    const wx = await weatherOf(f);
    const out = navlogContent({ flight: f, aircraft: AC, pilot: PILOT, ref: API_REF, weather: wx.answers, now: NOW });
    const doc = navlogDocumentOf({
      flight: f,
      aircraft: AC,
      settings: PILOT.settings,
      weather: wx.weather,
      metar: wx.metar,
      ref: webRef,
      nowMs: NOW,
    });
    expect(out.document).toEqual(json(doc));
    expect(out.content).toEqual(navlogContentOf({ sheets: doc.sheets }));
    expect(out.document.sheets[0].header.aircraft).toBe('SX-ASV');
  });

  test('wbPerfContent: the W&B + performance page’s sheets, content and warnings', async () => {
    const f = make();
    const wx = await weatherOf(f);
    const out = wbPerfContent({ flight: f, aircraft: AC, pilot: PILOT, ref: API_REF, weather: wx.answers, now: NOW });
    const calc = computeExportCalc({
      doc: f,
      aircraft: AC,
      settings: PILOT.settings,
      weather: wx.weather,
      metar: wx.metar,
      nowMs: NOW,
      ref: webRef,
    });
    const web = wbPerfOf({ doc: f, aircraft: AC, pilot: PILOT, calc, route: routeText(f.route, f.date) });
    expect(out.wb).toEqual(json(web.wb));
    expect(out.perf).toEqual(json(web.perf));
    expect(out.content).toEqual(json(web.content));
    expect(out.warnings).toEqual(web.warnings);
    expect(out.text).toBe(wbPerfText(web.content));
    // what the server hashes of the sent sheets is what the app hashes of the shown ones
    expect(declarationText({ content: JSON.parse(JSON.stringify(out.content)) }).text).toBe(out.text);
  });
});

describe('forms and the briefing', () => {
  const passengers = [
    {
      id: 'p_rear-left',
      fullName: 'Robin Rider',
      phone: '+30 69 0000',
      idNumber: 'AK 123',
      idType: 'ID',
      email: '',
    } as unknown as Passenger,
  ];

  test('formModel: Form 731 and the General Declaration as the forms pages fill them', () => {
    const f = flight(ROUTE());
    const props = { flight: f, aircraft: AC, pilot: PILOT, passengers };
    expect(formModel({ kind: '731', flight: f, aircraft: AC, pilot: PILOT, passengers, ref: API_REF })).toEqual(
      json(form731Model(props)),
    );
    expect(formModel({ kind: 'gendec', flight: f, aircraft: AC, pilot: PILOT, passengers })).toEqual(
      json(genDecModel(props)),
    );
    const noAc = formModel({ kind: '731', flight: { ...f, aircraftId: null }, pilot: PILOT }) as Form731Model;
    expect(noAc.warnings).toContain('No aircraft is selected: the registration is blank.');
    expect(noAc.airport).toMatch(/\(LGTT\)$/);
  });

  test('briefingModel', () => {
    const f = flight(ROUTE());
    const b = briefing([notam(), notam({ key: 'B2/26', relevant: false })]);
    expect(briefingModel({ flight: f, briefing: b })).toEqual(
      json(webBriefing({ doc: f, title: f.summary.title || f.title, briefing: b })),
    );
    expect(briefingModel({ flight: f, briefing: null }).status).toBe('loading');
  });
});
