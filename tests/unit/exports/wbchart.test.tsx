// MD 4.3 envelope chart labels and the printed notes of the loading sheet: the take-off, landing
// and zero-fuel labels and the envelope captions never cover each other, the markers or the
// fuel-burn line (review finding: 'T/O …' drawn on 'NORMAL CATEGORY'); the sheet prints no file
// paths and no seat arm that contradicts its own table; a moment envelope topping out below the
// category maximum is explained.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';

import { REF, runwaysOf, SUN_TABLES } from '../../../src/data/ref';
import {
  type Box,
  layoutChartLabels,
  overlapArea,
  segmentInBox,
  spanAt,
  textWidth,
} from '../../../src/features/exports/wb/chartLayout';
import { type ChartPoint, envelopeChartGeometry } from '../../../src/features/exports/wb/EnvelopeChart';
import { computeExportCalc } from '../../../src/features/exports/wb/exportCalc';
import {
  envelopeNote,
  momentTopNote,
  printableSource,
  type WbSheetModel,
  wbSheetModel,
} from '../../../src/features/exports/wb/model';
import { WbSheet } from '../../../src/features/exports/wb/WbExport';
import { wbPerfContent } from '../../../src/features/exports/wbperf/declaration';
import {
  type Aircraft,
  emptyFlightDoc,
  type FlightCrew,
  type FlightDoc,
  type PersonDetails,
  type Pilot,
  type RoutePoint,
} from '../../../src/shared';
import { fleetSeed } from '../../../tools/build_seed';

const ASV: Aircraft = { ...structuredClone(fleetSeed()[0]), id: 'ac_asv', created: 0, updated: 0 };
const person = (fullName: string, weightKg: number | null): PersonDetails => ({
  fullName,
  phone: '',
  dateOfBirth: null,
  weightKg,
  idNumber: '',
  idType: '',
  nationality: '',
  relation: '',
});
const crew = (role: 'PIC' | 'PAX', seat: string, name: string, kg: number): FlightCrew => ({
  role,
  passengerId: role === 'PIC' ? null : 'p_' + seat,
  seat,
  snapshot: person(name, kg),
});
const pilot: Pilot = {
  ...person('Pat Pilot', 80),
  id: 'pilot1',
  email: '',
  name: '',
  picture: '',
  licenceNo: '',
  homeAerodrome: 'LGTT',
  defaultAircraftId: null,
  settings: {
    taxiOutMin: 15,
    taxiInMin: 15,
    reserveMin: 60,
    finalReserveMin: 0,
    windModel: 'ecmwf_ifs025',
    enrouteAerodromeRadiusNm: 2,
  },
  created: 0,
  lastLogin: 0,
};
function adPoint(icao: string, uid: string): RoutePoint {
  const a = REF.aerodromes.find((x) => x.icao === icao)!;
  return { uid, kind: 'aerodrome', refId: a.id, name: a.icao!, lat: a.lat, lon: a.lon };
}
const ref = {
  aerodromes: REF.aerodromes,
  vfrPoints: REF.vfrPoints,
  vfrRoutes: REF.vfrRoutes,
  sunTables: SUN_TABLES,
  runwaysOf,
};

function sheet(over: Partial<FlightDoc>, aircraft: Aircraft = ASV): WbSheetModel {
  const doc: FlightDoc = {
    ...emptyFlightDoc('2026-11-16'),
    blockOff: '09:00',
    taxiOutMin: 15,
    taxiInMin: 15,
    aircraftId: aircraft.id,
    route: [adPoint('LGTT', 'a'), adPoint('LGSY', 'b'), adPoint('LGTT', 'c')],
    crew: [crew('PIC', 'front-left', 'Pat Pilot', 80)],
    baggageKg: {},
    fobL: 75,
    ...over,
  };
  const calc = computeExportCalc({
    doc,
    aircraft,
    settings: pilot.settings,
    weather: null,
    metar: null,
    nowMs: Date.parse('2026-11-15T12:00:00Z'),
    ref,
  });
  return wbSheetModel({ doc, aircraft, pilot, calc, route: '' });
}

function chartPoints(m: WbSheetModel): ChartPoint[] {
  const to = m.checks.find((c) => c.phase === 'takeoff');
  const ldg = m.checks.find((c) => c.phase === 'landing');
  const pts: ChartPoint[] = [];
  if (m.zeroFuel && to) pts.push({ key: 'zerofuel', label: 'ZFW', point: m.zeroFuel, ok: null });
  if (ldg) pts.push({ key: 'landing', label: 'LDG', point: ldg.point, ok: ldg.ok });
  if (to) pts.push({ key: 'takeoff', label: 'T/O', point: to.point, ok: to.ok });
  return pts;
}

/** Every clash between labels, markers, the burn line and the plot frame (px², px). */
function clashes(m: WbSheetModel): string[] {
  const g = envelopeChartGeometry(m.envelopes, chartPoints(m));
  const labels: { key: string; box: Box }[] = [...g.layout.envelopes, ...g.layout.points];
  const out: string[] = [];
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const a = overlapArea(labels[i].box, labels[j].box);
      if (a > 0) out.push(`${labels[i].key}/${labels[j].key} overlap ${a.toFixed(0)}`);
    }
    for (const mk of g.markers) {
      const b: Box = { x0: mk.x - mk.r, y0: mk.y - mk.r, x1: mk.x + mk.r, y1: mk.y + mk.r };
      if (overlapArea(labels[i].box, b) > 0) out.push(`${labels[i].key} covers marker ${mk.key}`);
    }
    for (const s of g.burn) {
      const l = segmentInBox(s, labels[i].box);
      if (l > 0.5) out.push(`${labels[i].key} on the burn line (${l.toFixed(1)} px)`);
    }
    const inB = overlapArea(labels[i].box, g.bounds);
    const area = (labels[i].box.x1 - labels[i].box.x0) * (labels[i].box.y1 - labels[i].box.y0);
    if (inB < area - 1) out.push(`${labels[i].key} outside the plot`);
  }
  return out;
}

describe('envelope chart labels', () => {
  test('the reported loading: SX-ASV, 3 on board, 20 kg in baggage area 1, 75 L', () => {
    const m = sheet({
      crew: [
        crew('PIC', 'front-left', 'Pat Pilot', 80),
        crew('PAX', 'front-right', 'Maria', 62),
        crew('PAX', 'rear-left', 'Nikos', 95),
      ],
      baggageKg: { bag1: 20 },
      fobL: 75,
    });
    expect(m.checks.find((c) => c.phase === 'takeoff')!.point.massKg).toBeCloseTo(1002.2, 1);
    expect(clashes(m)).toEqual([]);
    const g = envelopeChartGeometry(m.envelopes, chartPoints(m));
    expect(g.layout.envelopes.map((l) => l.key)).toEqual(['normal', 'utility']);
    expect(g.layout.points.map((l) => l.key).sort()).toEqual(['landing', 'takeoff', 'zerofuel']);
    const html = renderToStaticMarkup(<WbSheet c={wbPerfContent(m, null)} />);
    expect(html).toContain('T/O 1002.2 kg');
    expect(html).toMatch(/114[12]\.\d kg·m/);
  });

  test('no clashes across a sweep of loadings (solo to full, near-empty to full tanks)', () => {
    const bad: string[] = [];
    const loads: [number, number, number, number, number][] = []; // front-right, rear-left, rear-right, bag1, fob
    for (const fr of [0, 62, 95])
      for (const rl of [0, 80])
        for (const rr of [0, 95])
          for (const bag of [0, 30]) for (const fob of [40, 75, 110, 144]) loads.push([fr, rl, rr, bag, fob]);
    for (const [fr, rl, rr, bag, fob] of loads) {
      const c = [crew('PIC', 'front-left', 'P', 80)];
      if (fr) c.push(crew('PAX', 'front-right', 'A', fr));
      if (rl) c.push(crew('PAX', 'rear-left', 'B', rl));
      if (rr) c.push(crew('PAX', 'rear-right', 'C', rr));
      const m = sheet({ crew: c, baggageKg: bag ? { bag1: bag } : {}, fobL: fob });
      for (const x of clashes(m)) bad.push(`${fr}/${rl}/${rr}/${bag}/${fob} L: ${x}`);
    }
    expect(bad).toEqual([]);
  });

  test('geometry helpers', () => {
    expect(
      spanAt(
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
        5,
      ),
    ).toEqual([0, 10]);
    expect(
      spanAt(
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
        11,
      ),
    ).toBeNull();
    expect(segmentInBox([0, 5, 20, 5], { x0: 5, y0: 0, x1: 10, y1: 10 })).toBeCloseTo(5, 9);
    expect(segmentInBox([0, 20, 20, 20], { x0: 5, y0: 0, x1: 10, y1: 10 })).toBe(0);
    expect(textWidth('1000', 10)).toBeCloseTo(22.24, 2);
    // a lone label next to a marker goes to its right (first preference)
    const l = layoutChartLabels({
      bounds: { x0: 0, y0: 0, x1: 1000, y1: 500 },
      envelopes: [],
      points: [{ key: 'p', x: 300, y: 250, r: 8, lines: ['T/O 900.0 kg', '900.0 kg·m'], fontPx: 16 }],
      burn: [],
    });
    expect(l.points[0].anchor).toBe('start');
    expect(l.points[0].box.x0).toBeGreaterThan(308);
  });
});

describe('printed notes', () => {
  test('no file paths, no seat arm contradicting the table', () => {
    const asv: Aircraft = structuredClone(ASV);
    asv.massBalance.weighingSource =
      'DAS (EL.145.0078) weight and balance report, 14-11-2024 (trn-docs/SXASV_WB_FORM_2024.pdf)';
    asv.massBalance.envelopes.utility!.notes =
      'Utility: no rear passengers, no baggage; front seats set forward to 0.90 m (club W&B calculator).';
    const m = sheet({}, asv);
    expect(m.weighing).toBe('DAS (EL.145.0078) weight and balance report, 14-11-2024');
    const html = renderToStaticMarkup(<WbSheet c={wbPerfContent(m, null)} />);
    expect(html).not.toMatch(/trn-docs|\.pdf/);
    expect(html).not.toContain('0.90 m');
    expect(m.limits.join(' · ')).toMatch(
      /Utility max \d+ kg \(no rear passengers, no baggage; seats at the station arms in the table\)/,
    );
    // the table shows the front seat arm the calculation used
    expect(m.lines.find((l) => l.key === 'front')!.armM).toBeCloseTo(0.94, 9);
  });

  test('helpers', () => {
    expect(printableSource('Weight and balance report signed 28 FEB 2024 (trn-docs/SXASG_WB_FORM_2024.pdf)')).toBe(
      'Weight and balance report signed 28 FEB 2024',
    );
    expect(printableSource('Report scan.pdf, signed')).toBe('Report, signed');
    expect(printableSource('Report (EL.145.0078)')).toBe('Report (EL.145.0078)');
    expect(envelopeNote('Utility: no rear passengers, no baggage.')).toBe('no rear passengers, no baggage');
    expect(envelopeNote('')).toBe('');
  });

  test('a moment envelope below the category maximum is explained; an aligned one is not', () => {
    const env = {
      category: 'utility' as const,
      maxKg: 910,
      polygon: [
        [0.89, 600],
        [0.9, 910],
        [1.03, 910],
        [1.03, 600],
      ] as [number, number][],
      momentPolygon: [
        [600, 675],
        [780, 890],
        [807, 905],
        [927, 905],
        [700, 675],
      ] as [number, number][],
    };
    expect(momentTopNote(env, 'Utility')).toMatch(
      /tops out at 905 kg, below the 910 kg maximum.*between 905 and 910 kg is reported outside/,
    );
    expect(momentTopNote({ ...env, maxKg: 905 }, 'Utility')).toBe('');
    expect(momentTopNote({ ...env, momentPolygon: null }, 'Utility')).toBe('');
    const asv: Aircraft = structuredClone(ASV);
    asv.massBalance.envelopes.utility = env;
    expect(sheet({}, asv).limits.join(' · ')).toMatch(/Utility moment envelope \(solid outline\) tops out at 905 kg/);
  });
});
