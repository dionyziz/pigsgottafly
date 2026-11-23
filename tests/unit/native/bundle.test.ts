// The built core.js (native/ios/PigsGottaFly/Resources/core.js) as the iPhone app runs it: loaded in
// a fresh context with only the ECMAScript globals (no window, document, fetch, timers, require or
// process, as in JavaScriptCore), every PGF function called with JSON text and its answer read back
// as JSON. And the committed file is what the sources build (a stale core.js fails here).
import fs from 'node:fs';
import vm from 'node:vm';

import { beforeAll, describe, expect, test } from 'vitest';

import { buildFromTemplate } from '../../../src/features/hangar/templates';
import { buildCore, CORE_OUT } from '../../../tools/build_native_core';
import { AC, API_REF, briefing, flight, notam, NOW, PILOT, ROUTE } from './fixtures';

const code = fs.readFileSync(CORE_OUT, 'utf8');

/** GET /api/flights/:id/forms with the fields the panels read: the PIC signed, a passenger with no link. */
const FORMS = {
  form731: {
    content: { date: '2026-11-15' },
    signatures: [
      {
        key: 'PIC',
        role: 'PIC',
        name: 'PILOT',
        signed: true,
        signedAt: NOW,
        needsResign: false,
        email: '',
        link: null,
      },
      {
        key: 'pax-1',
        role: 'PAX',
        name: 'ANNA',
        signed: false,
        signedAt: null,
        needsResign: false,
        email: '',
        link: null,
      },
    ],
    allSigned: false,
    submission: null,
  },
  gendec: {
    content: { placeCount: 2 },
    submission: null,
    pilotSends: true,
    handling: { ends: [], autoPilotSends: true, override: null, pilotSends: true },
    picSignature: null,
  },
  emailEnabled: true,
  emailReason: null,
};

describe('core.js in a bare JavaScript context', () => {
  const ctx = vm.createContext({});
  beforeAll(() => {
    // V8 gives a context its own console; JavaScriptCore need not have one
    vm.runInContext('delete globalThis.console', ctx);
    vm.runInContext(code, ctx, { filename: 'core.js' });
  });
  /** Calls PGF[fn] with JSON text, as the app does, and parses its answer's JSON. */
  const call = (fn: string, input: unknown = {}) => {
    ctx.__input = JSON.stringify(input);
    return JSON.parse(vm.runInContext(`JSON.stringify(PGF.${fn}(__input))`, ctx) as string);
  };

  test('only the ECMAScript globals are there', () => {
    const missing = [
      'window',
      'document',
      'fetch',
      'setTimeout',
      'require',
      'process',
      'URL',
      'URLSearchParams',
      'atob',
      'console',
    ];
    for (const g of missing) expect(vm.runInContext(`typeof ${g}`, ctx), g).toBe('undefined');
    expect(vm.runInContext('typeof PGF', ctx)).toBe('object');
    expect(vm.runInContext('typeof globalThis.PGF.computeFlight', ctx)).toBe('function');
  });

  test('version', () => {
    expect(vm.runInContext('PGF.version', ctx)).toMatch(/^\d+\.\d+\.\d+\+[0-9a-f]{12}$/);
  });

  test('chartStyle, symbolNames, layerGroups, lineStyles', () => {
    const style = call('chartStyle', { base: 'light', vector: null });
    expect(style.version).toBe(8);
    expect(style.layers.length).toBeGreaterThan(40);
    expect(call('symbolNames').map((s: { name: string }) => s.name)).toContain('pgf-ad-major');
    expect(call('layerGroups').notams).toEqual(['notam-fill', 'notam-line']);
    expect(call('lineStyles').mtma).toMatchObject({ color: '#8a3b9c', dash: [4, 2] });
  });

  test('chartData', () => {
    const data = call('chartData', { ref: API_REF, flight: flight(ROUTE()), notams: briefing([notam()]), now: NOW });
    expect(data['route-line'].features).toHaveLength(1);
    expect(data['notam-areas'].features).toHaveLength(1);
    expect(data.zones.features.length).toBeGreaterThan(10);
  });

  test('weatherRequests, computeFlight (with the terrain), progress, paperwork', () => {
    const f = flight(ROUTE());
    const paths = call('weatherRequests', { flight: f, ref: API_REF, now: NOW });
    expect(paths.some((p: string) => p.startsWith('/api/weather/grid?kind=wind'))).toBe(true);
    const terrain = fs.readFileSync(new URL('../../../public/terrain/greece.bin', import.meta.url)).toString('base64');
    expect(call('setTerrain', { base64: terrain })).toEqual({ ok: true });
    const c = call('computeFlight', { flight: f, aircraft: AC, pilot: PILOT, ref: API_REF, weather: {}, now: NOW });
    expect(c.navlog.legs).toHaveLength(3);
    expect(c.legs[0].altSource).toBeTruthy();
    expect(c.readiness.length).toBeGreaterThan(5);
    const leg = c.legs[1];
    const p = call('progress', {
      computed: c,
      position: { lat: (leg.from.lat + leg.to.lat) / 2, lon: (leg.from.lon + leg.to.lon) / 2, time: NOW },
    });
    expect(p.legIndex).toBe(1);
    expect(p.toWaypoint.name).toBe('KORINTHOS');
    expect(call('paperwork', {})[0]).toMatchObject({ id: 'filing', state: 'todo' });
    expect(call('setTerrain', { base64: null })).toEqual({ ok: false });
  });

  test('aircraftTemplates, aircraftFromTemplate: the hangar template for a first aircraft', () => {
    expect(call('aircraftTemplates')).toEqual([
      { id: 'reims-f172m', label: 'Reims/Cessna F172M', description: 'AFM 1972' },
    ]);
    const a = call('aircraftFromTemplate', { id: 'reims-f172m', registration: ' sx-abc ' });
    expect(a).toEqual({ ...buildFromTemplate('reims-f172m'), registration: 'SX-ABC' });
    expect(call('aircraftFromTemplate', { id: 'nope', registration: 'SX-ABC' }).icaoType).toBe('');
  });

  // The parity of each with the website is in its domain's test file; here, that each runs with only
  // the ECMAScript globals (no Web Crypto for new uids, no URL, no atob).
  const route = ROUTE();
  const f = flight(route);
  const calls: Record<string, () => void> = {
    routeEdit: () => {
      const r = call('routeEdit', {
        route,
        op: 'add',
        point: { kind: 'custom', refId: null, name: 'WP1', lat: 38, lon: 24 },
      });
      expect(r.route).toHaveLength(5);
      expect(r.route[4].uid).toMatch(/^[a-z0-9]{8}$/);
      expect(call('routeEdit', { route, op: 'setEnd', end: 'to', aerodrome: 'LGSY', ref: API_REF }).route[3].name).toBe(
        'LGSY',
      );
    },
    routeInfo: () => expect(call('routeInfo', { route }).autoWaypointName).toBe('WP1'),
    snap: () => {
      const tt = route[0];
      expect(call('snap', { ref: API_REF, lat: tt.lat, lon: tt.lon, zoom: 10 }).point.name).toBe('LGTT');
    },
    localFlight: () => expect(call('localFlight', { route, options: {} }).local).toBe(false),
    setRequest: () => expect(call('setRequest', { pointUid: 'a', kind: 'stop' })).toHaveLength(1),
    requests: () => expect(call('requests', { route, options: f.options }).allowed).toHaveLength(4),
    fplOptions: () => expect(call('fplOptions', { fields: ['lgav'] }).alternates).toEqual(['LGAV']),
    fuelLoad: () => expect(call('fuelLoad', { fuel: AC.fuel, totalL: 100 }).load.totalL).toBe(100),
    setAircraft: () => expect(call('setAircraft', { doc: f, aircraft: AC }).aircraftId).toBe(AC.id),
    fuelEdit: () => expect(call('fuelEdit', { doc: f, op: 'total', litres: 90 }).fobL).toBe(90),
    readinessStages: () => expect(call('readinessStages', { items: call('paperwork', {}) })).toHaveLength(3),
    focusTarget: () => expect(call('focusTarget', { text: 'Block start time not set.' }).section).toBe('when'),
    focusSections: () => expect(call('focusSections').fields.blockOff).toBe('when'),
    regenerateAtc: () =>
      expect(call('regenerateAtc', { flight: f, altitudesFt: [2500, 2500, 2500] }).generated.length).toBeGreaterThan(0),
    manifest: () =>
      expect(call('manifest', { crew: f.crew, stations: AC.massBalance.stations, op: 'seats' }).errors).toEqual([]),
    wbChart: () => expect(call('wbChart', { massBalance: AC.massBalance }).envelopes.length).toBeGreaterThan(0),
    cgToMoment: () =>
      expect(call('cgToMoment', { polygon: AC.massBalance.envelopes.normal.polygon }).moment.length).toBeGreaterThan(2),
    shareSuggestions: () => expect(call('shareSuggestions', { crew: f.crew, passengers: [] }).contacts).toEqual([]),
    fplMessage: () =>
      expect(call('fplMessage', { flight: f, aircraft: AC, pilot: PILOT, weather: {}, now: NOW }).fpl.message).toMatch(
        /^\(FPL-SXASV/,
      ),
    filingView: () =>
      expect(
        call('filingView', { state: null, message: '(FPL-SXASV-VG -C172/L-S/C -LGTT0830 -N0100VFR DCT -LGSY0045 -0)' })
          .head.adep,
      ).toBe('LGTT'),
    filingDelay: () => expect(call('filingDelay', { state: null, eobt: NOW, now: NOW }).problem).toMatch(/No open/),
    filingError: () => expect(call('filingError', { offline: true }).text).toBe('Offline: nothing was sent.'),
    navlogContent: () =>
      expect(
        call('navlogContent', { flight: f, aircraft: AC, pilot: PILOT, weather: {}, now: NOW }).content.sheets,
      ).toHaveLength(1),
    wbPerfContent: () =>
      expect(call('wbPerfContent', { flight: f, aircraft: AC, pilot: PILOT, weather: {}, now: NOW }).text).toContain(
        'SX-ASV',
      ),
    formModel: () =>
      expect(call('formModel', { kind: '731', flight: f, aircraft: AC, pilot: PILOT }).registration).toBe('SX-ASV'),
    briefingModel: () =>
      expect(call('briefingModel', { flight: f, briefing: briefing([notam()]) }).relevant).toHaveLength(1),
    form731Panel: () => {
      const p = call('form731Panel', { forms: FORMS, links: { 'pax-1': 'tok' }, now: NOW });
      expect(p.summary).toBe('1 of 2 signed · ANNA: no link yet');
      expect(p.people[1].link.url).toBe('https://pigsgottafly.com/sign/tok');
      expect(p.people[0].status).toMatch(/^signed \d{4}-\d\d-\d\d \d\d:\d\d$/);
    },
    genDecPanel: () => expect(call('genDecPanel', { forms: FORMS, handled: true }).override).toBe(true),
    operatorPanel: () => expect(call('operatorPanel', { declarations: null })).toBeNull(),
    declarationText: () =>
      expect(JSON.parse(call('declarationText', { content: { wb: { rows: [] } } }).text)).toHaveProperty('wb'),
    validateAircraft: () => expect(call('validateAircraft', { aircraft: AC, now: NOW }).errors).toBe(0),
    aircraftHelpers: () =>
      expect(call('aircraftHelpers', { op: 'split10b', text: 'SB2' })).toEqual({ ssr: 'S', ads: ['B2'] }),
    historyText: () => expect(call('historyText', {}).entries).toEqual([]),
    sharing: () =>
      expect(call('sharing', { sharing: { role: 'owner', canManage: true, people: [] }, myId: 'p' }).error).toBe(
        'Enter an e-mail address.',
      ),
    sharedChip: () => expect(call('sharedChip', {}).chip).toBeNull(),
    unshareOffer: () => expect(call('unshareOffer', { sharing: null, myId: 'p' }).offer).toBeNull(),
    invite: () => expect(call('invite', { email: 'a@b.c' }).body.email).toBe('a@b.c'),
    newAircraft: () =>
      expect(call('newAircraft', { hangar: [], registration: ' sx-abc ' }).input.registration).toBe('SX-ABC'),
    personIssues: () => expect(call('personIssues', { person: null, now: NOW }).issues.length).toBeGreaterThan(0),
    parseCoords: () => expect(call('parseCoords', { text: '375430N 0234334E' }).latLon.lat).toBeCloseTo(37.908, 3),
    parseTyped: () => expect(call('parseTyped', { kind: 'time', text: '930' }).value).toBe('09:30'),
    brief: () => {
      const c = call('computeFlight', { flight: f, aircraft: AC, pilot: PILOT, ref: API_REF, weather: {}, now: NOW });
      const b = call('brief', { computed: c, flight: f, aircraft: AC, notams: briefing([notam()]), now: NOW });
      expect(b.performance.endpoints).toHaveLength(2);
      expect(b.aerodromes.items[0].hours.day).toBe('Sun 15 Nov');
      expect(b.notams.groups.length).toBeGreaterThan(0);
    },
    mapInfo: () =>
      expect(call('mapInfo', { ref: API_REF, lat: 38.10861, lon: 23.78333, zoom: 10 }).aerodrome.icao).toBe('LGTT'),
    pointMenu: () => expect(call('pointMenu', { ref: API_REF, route, uid: route[0].uid }).end).toBe('departure'),
    routeFeatures: () => expect(call('routeFeatures', { route })['route-points'].features).toHaveLength(route.length),
    drawBand: () => expect(call('drawBand', { route, target: { lat: 38, lon: 24 } }).readout).toMatch(/NM$/),
    waypointName: () => expect(call('waypointName', { name: 'wp 1' }).name).toBe('WP 1'),
    mapLayers: () => expect(call('mapLayers', { ref: API_REF, pilot: { tma: false } }).layers.tma).toBe(false),
  };
  test.each(Object.keys(calls))('%s', (name) => calls[name]());

  test('every PGF function is called in this file', () => {
    const fns = JSON.parse(
      vm.runInContext(
        `JSON.stringify(Object.keys(PGF).filter(function (k) { return typeof PGF[k] === 'function'; }))`,
        ctx,
      ),
    ) as string[];
    const before = [
      'chartStyle',
      'chartData',
      'symbolNames',
      'layerGroups',
      'lineStyles',
      'weatherRequests',
      'computeFlight',
      'setTerrain',
      'progress',
      'paperwork',
      'aircraftTemplates',
      'aircraftFromTemplate',
      'fromBase64',
    ];
    expect(fns.filter((k) => !before.includes(k) && !(k in calls))).toEqual([]);
  });
});

test('the committed core.js is what the sources build (else: npm run native:core)', async () => {
  expect((await buildCore()) === code).toBe(true);
}, 60000);
