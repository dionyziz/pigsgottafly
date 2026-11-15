// Exports, review round 2: performance verdict above MTOW / outside the AFM table and the
// hand-checkable TODR note; FPL item 18 remarks with
// indicators, touch-and-go / stop requests (remarks and timing); ELOT 743 transliteration.
import { describe, expect, test } from 'vitest';
import { fleetSeed } from '../../../tools/build_seed';
import { REF, SUN_TABLES, aerodrome, runwaysOf, vfrPoint } from '../../../src/data/ref';
import {
  activeRequests, emptyFlightDoc, legKey, requestRemarks, requestTiming, setRequest,
  type Aircraft, type AircraftInput, type FlightCrew, type FlightDoc, type PersonDetails, type Pilot, type RoutePoint,
} from '../../../src/shared';
import { buildLegs, computeNavlog, defaultAltitudes, navlogAircraft, takeoffDistances, landingDistances } from '../../../src/calc';
import { computeExportCalc } from '../../../src/features/exports/wb/exportCalc';
import { perfSheetModel } from '../../../src/features/exports/performance/model';
import { buildFpl, transliterate, type FplInput } from '../../../src/features/exports/fpl/fpl';

const [ASV_IN] = fleetSeed();
const ASV: Aircraft = { ...structuredClone(ASV_IN as AircraftInput), id: 'ac_asv', created: 0, updated: 0 };
const person = (fullName: string, weightKg: number | null): PersonDetails => ({
  fullName, phone: '', dateOfBirth: null, weightKg, idNumber: '', idType: '', nationality: '', relation: '',
});
const crew = (role: 'PIC' | 'PAX', seat: string, name: string, kg: number | null): FlightCrew => ({ role, passengerId: role === 'PIC' ? null : 'p_' + seat, seat, snapshot: person(name, kg) });
const pilot: Pilot = {
  ...person('Pat Pilot', 80), id: 'pilot1', email: '', name: '', picture: '', licenceNo: '', homeAerodrome: 'LGTT', defaultAircraftId: null,
  settings: { taxiOutMin: 15, taxiInMin: 15, reserveMin: 60, finalReserveMin: 0, windModel: 'ecmwf_ifs025', enrouteAerodromeRadiusNm: 2 },
  created: 0, lastLogin: 0,
};
let n = 0;
const adPoint = (icao: string): RoutePoint => { const a = aerodrome(icao)!; return { uid: `u${n++}`, kind: 'aerodrome', refId: a.id, name: a.icao!, lat: a.lat, lon: a.lon }; };
const vfr = (id: string): RoutePoint => { const p = vfrPoint(id)!; return { uid: `u${n++}`, kind: 'vfr', refId: id, name: p.name, lat: p.lat, lon: p.lon }; };
const baseRef = { aerodromes: REF.aerodromes, vfrPoints: REF.vfrPoints, vfrRoutes: REF.vfrRoutes, sunTables: SUN_TABLES, runwaysOf };

function flight(over: Partial<FlightDoc> = {}): FlightDoc {
  return {
    ...emptyFlightDoc('2026-11-21'),
    blockOff: '09:00', taxiOutMin: 15, taxiInMin: 15, aircraftId: ASV.id,
    route: [adPoint('LGTT'), adPoint('LGMG')],
    crew: [crew('PIC', 'front-left', 'Pat Pilot', 80), crew('PAX', 'rear-left', 'Robin Rider', 70)],
    baggageKg: {},
    fobL: 100,
    ...over,
  };
}
const calcOf = (doc: FlightDoc) =>
  computeExportCalc({ doc, aircraft: ASV, settings: pilot.settings, weather: null, metar: null, nowMs: Date.parse('2026-11-15T12:00:00Z'), ref: baseRef });

// ---------------------------------------------------------------------------------------------

describe('performance distances: raw table figures', () => {
  test.each(['da', 'afm'] as const)('%s: corrected = table × wind × temperature; required = corrected × condition × safety', (method) => {
    const c = { massKg: 1000, pressureAltFt: 800, oatC: 30, headwindKt: 10, surface: null, slopePct: 2, method };
    for (const d of [takeoffDistances(ASV.performance, c), landingDistances(ASV.performance, c)]) {
      expect(d.totalM).toBeCloseTo(d.tableTotalM * d.factors.temperature * (d.factors.wind ?? 1), 6);
      expect(d.groundM).toBeCloseTo(d.tableGroundM * d.factors.temperature * (d.factors.wind ?? 1), 6);
      expect(d.requiredTotalM).toBeCloseTo(d.totalM * d.factors.condition! * d.factors.safety, 6);
    }
  });
});

describe('performance log (MD 4.4) verdict', () => {
  test('take-off mass above MTOW is a FAIL, never a PASS, even though distances fit', () => {
    const doc = flight({
      crew: [crew('PIC', 'front-left', 'A', 100), crew('PAX', 'front-right', 'B', 100), crew('PAX', 'rear-left', 'C', 100), crew('PAX', 'rear-right', 'D', 100)],
      fobL: 140,
    });
    const calc = calcOf(doc);
    const mtow = ASV.massBalance.mtowKg;
    expect(calc.departure.massKg!).toBeGreaterThan(mtow);
    const m = perfSheetModel({ doc, aircraft: ASV, pilot, calc });
    expect(m.departure.verdict).toBe('fail');
    expect(m.departure.verdictText).toMatch(/above MTOW/);
    expect(m.verdict).toBe('fail');
    const mass = m.departure.rows.find((r) => r.key === 'mass')!;
    expect(mass.status).toBe('bad');
    expect(mass.note).toContain(`MTOW ${mtow} kg`);
    expect(m.departure.warnings[0]).toMatch(/above the MTOW/);
  });

  test('distances extrapolated beyond the AFM table are not a PASS', () => {
    // Below MTOW but heavier than the heaviest take-off table row: lower the aircraft's MTOW check
    // out of the way by raising it, so only the table limit applies.
    const heavy: Aircraft = structuredClone(ASV);
    heavy.massBalance.mtowKg = 2000;
    heavy.massBalance.mlwKg = 2000;
    const doc = flight({
      crew: [crew('PIC', 'front-left', 'A', 100), crew('PAX', 'front-right', 'B', 100), crew('PAX', 'rear-left', 'C', 100), crew('PAX', 'rear-right', 'D', 100)],
      fobL: 140,
    });
    const calc = computeExportCalc({ doc, aircraft: heavy, settings: pilot.settings, weather: null, metar: null, nowMs: Date.parse('2026-11-15T12:00:00Z'), ref: baseRef });
    expect(calc.departure.perf!.distances!.extrapolated).toBe(true);
    const m = perfSheetModel({ doc, aircraft: heavy, pilot, calc });
    expect(m.departure.verdict).toBe('fail');
    expect(m.departure.verdictText).toBe('Outside the AFM table');
    expect(m.verdict).not.toBe('pass');
    expect(m.departure.rows.find((r) => r.key === 'todr')!.status).not.toBe('ok');
  });

  test('a normal load still passes', () => {
    const doc = flight();
    const m = perfSheetModel({ doc, aircraft: ASV, pilot, calc: calcOf(doc) });
    expect(m.departure.verdict).toBe('pass');
    expect(m.verdict).toBe('pass');
  });

  test('the TODR note prints the table value and each factor once: table × wind × temp × condition × safety = TODR', () => {
    // A METAR-free run with a typed headwind is not possible here, so check the arithmetic on the
    // calc result directly: the printed AFM figure is the raw table figure.
    const doc = flight();
    const calc = calcOf(doc);
    const d = calc.departure.perf!.distances!;
    expect(d.totalM).toBeCloseTo(d.tableTotalM * d.factors.temperature * (d.factors.wind ?? 1), 6);
    const m = perfSheetModel({ doc, aircraft: ASV, pilot, calc });
    const todr = m.departure.rows.find((r) => r.key === 'todr')!;
    expect(todr.note).toMatch(new RegExp(`^AFM \\d+/${Math.round(d.tableTotalM)} m at (DA|PA) `));
    const cond = Number(m.departure.rows.find((r) => r.key === 'cond')!.value);
    const safety = Number(m.departure.rows.find((r) => r.key === 'safety')!.value);
    const handCheck = d.tableTotalM * (d.factors.wind ?? 1) * d.factors.temperature * cond * safety;
    expect(Math.abs(handCheck - Number(todr.value.replace(' m', '')))).toBeLessThan(2);
  });
});

// ---------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------

const ad4 = (icao: string) => { const a = aerodrome(icao)!; return { icao: a.icao, name: a.name, lat: a.lat, lon: a.lon }; };
function fplBase(over: Partial<FplInput> = {}): FplInput {
  const tt = ad4('LGTT');
  return {
    registration: 'SX-ASV', icaoType: 'C172', makeModel: 'Reims/Cessna F172M', wake: 'L',
    equipment: { item10a: 'S', item10b: 'C', pbn: '', item18Extras: '', emergencyRadio: { uhf: false, vhf: false, elt: true }, survival: { polar: false, desert: false, maritime: false, jungle: false }, jackets: { present: false, light: false, fluorescein: false, uhf: false, vhf: false }, dinghies: null, remarks: '' },
    operator: '', colours: 'WHITE', date: '2026-11-20', eobt: '08:05', departure: tt, destination: tt, alternates: [],
    route: [{ name: 'LGTT', lat: tt.lat, lon: tt.lon, kind: 'aerodrome' }, { name: 'LGTT', lat: tt.lat, lon: tt.lon, kind: 'aerodrome' }],
    cruiseTasKt: 92, totalEetMin: 75, enduranceMin: 240, personsOnBoard: 2, pic: { fullName: 'Pat Pilot', phone: '+30 694' }, remarks: '',
    ...over,
  };
}
const rmkOf = (r: ReturnType<typeof buildFpl>) => r.fields.item18Parts.find((p) => p.indicator === 'RMK')?.text ?? '';

describe('FPL item 18: flight remarks with indicators', () => {
  test('RMK/ typed in the remarks is not doubled', () => {
    const r = buildFpl(fplBase({ remarks: 'RMK/REQUEST TOUCH N GO AT LGMG' }));
    expect(r.fields.item18).not.toContain('RMK/RMK');
    expect(rmkOf(r)).toMatch(/^REQUEST TOUCH N GO AT LGMG PIC TEL/);
  });
  test('other indicators go to their own field in Doc 4444 order; plain text to RMK/', () => {
    const r = buildFpl(fplBase({ remarks: 'PHOTO FLIGHT STS/HOSP PER/A' }));
    expect(r.fields.item18).toMatch(/^STS\/HOSP DOF\/261120 PER\/A RMK\/PHOTO FLIGHT /);
  });
  test('generated indicators typed in the remarks are ignored with a warning', () => {
    const r = buildFpl(fplBase({ remarks: 'DOF/991231' }));
    expect(r.fields.item18).toContain('DOF/261120');
    expect(r.fields.item18).not.toContain('991231');
    expect(r.warnings.some((w) => /DOF\/ in the flight remarks is ignored/.test(w))).toBe(true);
  });
});

describe('ELOT 743 transliteration', () => {
  test.each([
    ['Γιώργος Παπαδόπουλος-Ευαγγέλου Μπάμπης Ντίνος', 'GIORGOS PAPADOPOULOS-EVANGELOU BAMPIS DINOS'],
    ['Λευκό/μπλε', 'LEFKO/BLE'],
    ['Αυγή Ευθύμιος Παύλος Ελευθερία', 'AVGI EFTHYMIOS PAVLOS ELEFTHERIA'],
    ['Αγχίαλος Σφίγξ Άγκυρα', 'ANCHIALOS SFINX AGKYRA'],
    ['Μαΐου άυλος Κωνσταντίνος Σπύρος', 'MAIOU AYLOS KONSTANTINOS SPYROS'],
    ['Ούλα Θεσσαλονίκη Ψαρά', 'OULA THESSALONIKI PSARA'],
    ['SX-ASV Αθήνα', 'SX-ASV ATHINA'],
  ])('%s → %s', (g, l) => expect(transliterate(g)).toBe(l));
  test('colours in item 19 A/', () => {
    expect(buildFpl(fplBase({ colours: 'Λευκό/μπλε', options: { includeItem19: true } })).message).toContain('A/LEFKO BLE');
  });
});

// ---------------------------------------------------------------------------------------------

describe('touch-and-go and intermediate-stop requests', () => {
  const tt = adPoint('LGTT'), mg = adPoint('LGMG'), kor = vfr('LGAV/KORINTHOS'), tt2 = { ...adPoint('LGTT') };
  const route = [tt, mg, kor, tt2];
  const icao = (p: RoutePoint) => aerodrome(p.refId!)?.icao ?? null;

  test('remarks in the club format, in route order; departure touch-and-go is "initially"', () => {
    let reqs = setRequest([], mg.uid, 'touch-and-go');
    reqs = setRequest(reqs, tt.uid, 'touch-and-go');
    expect(requestRemarks(route, { aerodromeRequests: reqs }, icao)).toEqual(['INITIALLY REQUEST TOUCH N GO AT LGTT', 'REQUEST TOUCH N GO AT LGMG']);
    reqs = setRequest(reqs, mg.uid, 'stop', 10);
    expect(requestRemarks(route, { aerodromeRequests: reqs }, icao)).toEqual(['INITIALLY REQUEST TOUCH N GO AT LGTT', 'REQUEST INTERMEDIATE STOP AT LGMG FOR 10 MIN']);
    expect(setRequest(reqs, mg.uid, null)).toHaveLength(1);
  });

  test('requests on removed points, VFR points, or stops at the route ends are dropped', () => {
    const reqs = [
      { pointUid: 'gone', kind: 'touch-and-go' as const },
      { pointUid: kor.uid, kind: 'touch-and-go' as const },
      { pointUid: tt.uid, kind: 'stop' as const, stopMin: 5 },
      { pointUid: tt2.uid, kind: 'stop' as const, stopMin: 5 },
    ];
    expect(activeRequests(route, { aerodromeRequests: reqs })).toEqual([]);
  });

  test('joined in one RMK/ field, first', () => {
    const r = buildFpl(fplBase({ requests: ['INITIALLY REQUEST TOUCH N GO AT LGTT', 'REQUEST TOUCH N GO AT LGMG'], remarks: 'PHOTO' }));
    expect(r.fields.item18.match(/RMK\//g)).toHaveLength(1);
    expect(rmkOf(r)).toMatch(/^INITIALLY REQUEST TOUCH N GO AT LGTT REQUEST TOUCH N GO AT LGMG PHOTO PIC TEL/);
  });

  test('timing: legs either side of the intermediate aerodrome at pattern TAS, stop minutes on the ground, pattern altitude there', () => {
    const r2 = [tt, adPoint('LGEL'), mg, tt2];
    const legs = buildLegs(r2, '2026-11-20');
    const ac = navlogAircraft({ ...ASV, cruiseTasKt: 92, patternTasKt: 80 });
    const wind = legs.map(() => ({ windDirDeg: 360, windKt: 0, tempC: 10 }));
    const ctx = { aerodromes: REF.aerodromes, vfrPoints: REF.vfrPoints, vfrRoutes: REF.vfrRoutes };
    const run = (reqs: ReturnType<typeof setRequest>) => {
      const t = requestTiming(r2, { aerodromeRequests: reqs });
      const alts = defaultAltitudes(r2, ctx, [], t.patternPoints).map((d) => (isFinite(d.altFt) ? d.altFt : 3000));
      return { t, alts, nav: computeNavlog({ date: '2026-11-20', blockOff: '09:00', taxiOutMin: 15, taxiInMin: 15, legs, altitudesFt: alts, overrides: wind, aircraft: ac, winds: null, patternLegs: t.patternLegs, groundAfterLegMin: t.groundAfterLegMin }) };
    };
    const none = run([]);
    expect(none.nav.legs.map((l) => l.tasKt)).toEqual([80, 92, 80]);
    const tng = run(setRequest([], r2[1].uid, 'touch-and-go'));
    expect(tng.nav.legs.map((l) => l.tasKt)).toEqual([80, 80, 80]);
    expect(tng.t.groundAfterLegMin).toEqual([0, 0, 0]);
    const elev = aerodrome('LGEL')!.elevFt ?? 0;
    const pattern = Math.round((elev + 1000) / 100) * 100;
    expect(tng.alts[0]).toBe(pattern);
    const stop = run(setRequest([], r2[1].uid, 'stop', 20));
    expect(stop.nav.legs[1].startMin - stop.nav.legs[0].endMin).toBeCloseTo(20, 9);
    expect(stop.nav.times.landingMin - tng.nav.times.landingMin).toBeCloseTo(20, 9);
    // ETE and fuel are flight time only
    expect(stop.nav.totals.ete).toBe(tng.nav.totals.ete);
    expect(stop.nav.totals.tripFuel).toBe(tng.nav.totals.tripFuel);
  });

  test('keyed by the point uid, so the leg-key overrides are unaffected', () => {
    expect(legKey(tt, mg)).toBe(`${tt.uid}>${mg.uid}`);
  });
});
