// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { aipFiles } from '../../../../../tools/aip_files';
import { aipLinksOn } from '../../../../data/aipLinks';
import {
  AD_AIRSPACES,
  AERODROMES,
  AIRAC,
  AIRSPACES,
  AREAS,
  NAVAIDS,
  VFR_POINTS,
  VFR_ROUTES,
} from '../../../../data/ref';
import type { RefAerodrome, RefVfrPoint, RefVfrRoute } from '../../../../shared/ref';
import { adDayInfo } from '../../adDay';
import { AerodromeDetails } from '../AerodromePopover';
import { airspaceInfos } from '../airspace';
import { AirspaceDetails } from '../AirspacePopover';
import { VFR_ARROW_AT, VFR_ARROW_STEP, vfrRouteArrowFeatures } from '../features';
import { labelAlong, legLabelSlots } from '../labels';
import { NavaidDetails } from '../NavaidPopover';
import { aerodromeVfrCharts, airspaceVfrCharts, vfrChartIndex, vfrChartsAt, vfrPointCharts } from '../vfrCharts';

afterEach(cleanup);

const A = { lat: 38, lon: 23 },
  B = { lat: 38.2, lon: 23.4 },
  C = { lat: 38.5, lon: 23.1 };
const leg = (from: typeof A, to: typeof A) => ({ from, to });

describe('leg labels on a shared line', () => {
  it('a leg alone on its line has its label in the middle', () => {
    expect(legLabelSlots([leg(A, B), leg(B, C)])).toEqual([
      { t: 0.5, room: 1 },
      { t: 0.5, room: 1 },
    ]);
  });
  it('out and back: each label in the half nearer its own origin', () => {
    const [out, back, other] = legLabelSlots([leg(A, B), leg(B, A), leg(A, C)]);
    expect(out).toEqual({ t: 0.25, room: 0.5 });
    expect(back).toEqual({ t: 0.25, room: 0.5 });
    expect(other).toEqual({ t: 0.5, room: 1 });
  });
  it('the same leg flown twice: the labels share the line evenly, in route order', () => {
    const s = legLabelSlots([leg(A, B), leg(B, C), leg(C, A), leg(A, B)]);
    expect(s[0].t).toBeCloseTo(1 / 3);
    expect(s[3].t).toBeCloseTo(2 / 3);
    expect(s[0].room).toBeCloseTo(1 / 3);
  });
  it('twice out, once back: the two outbound labels share the origin half', () => {
    const s = legLabelSlots([leg(A, B), leg(B, A), leg(A, B)]);
    expect(s[0].t).toBeCloseTo(1 / 6);
    expect(s[2].t).toBeCloseTo(1 / 3);
    expect(s[1]).toEqual({ t: 0.25, room: 0.5 });
    for (const x of s) expect(x.t).toBeLessThan(0.5);
  });
});

describe('a shared-line label keeps clear of the arrows on the line', () => {
  const half = { t: 0.25, room: 0.5 };
  it('a long leg: between the origin and the arrow at 0.3, as near the slot as fits', () => {
    // 1000 px: the arrow at 300 px, the label 120 px wide ends 10 px before it
    expect(labelAlong(half, 1000, 120) * 1000).toBeCloseTo(230);
    // a narrow label stays at its slot
    expect(labelAlong(half, 1000, 60)).toBeCloseTo(0.25);
  });
  it('else between the arrow and the middle, else at its slot', () => {
    // 400 px: 14–110 too short for 110 px, 130–186 too short: the slot
    expect(labelAlong(half, 400, 110)).toBe(0.25);
    // 700 px: 14–200 fits 150 px (centre 125 → 0.179)
    expect(labelAlong(half, 700, 150) * 700).toBeCloseTo(125);
    // a lone leg's label stays in the middle
    expect(labelAlong({ t: 0.5, room: 1 }, 700, 150)).toBe(0.5);
  });
});

describe('VFR route arrows', () => {
  const pt = (chart: string, name: string, lat: number, lon: number): RefVfrPoint => ({
    id: `${chart}/${name}`,
    name,
    lat,
    lon,
    chart,
    src: 'chart',
  });
  const rt = (chart: string, a: string, b: string, oneway = true): RefVfrRoute => ({
    id: `${chart}:${a}>${b}`,
    chart,
    a,
    b,
    minFt: 2000,
    maxFt: 2000,
    oneway,
  });
  const pts = [pt('LGAV', 'X', 38, 23), pt('LGAV', 'Y', 38, 24), pt('LGMG', 'X', 38, 23), pt('LGMG', 'Y', 38, 24)];
  it('one arrow per direction, each toward its own end, so the two never sit on each other', () => {
    const fc = vfrRouteArrowFeatures([rt('LGAV', 'X', 'Y'), rt('LGAV', 'Y', 'X')], pts);
    expect(fc.features).toHaveLength(2);
    const [fwd, back] = fc.features;
    expect(fwd.properties.rot).toBe(90);
    expect(back.properties.rot).toBe(270);
    expect(fwd.geometry.coordinates[0]).toBeCloseTo(23 + VFR_ARROW_AT, 6);
    expect(back.geometry.coordinates[0]).toBeCloseTo(24 - VFR_ARROW_AT, 6);
  });
  it('the same direction published twice (two charts) is one arrow; two-way segments have none', () => {
    const fc = vfrRouteArrowFeatures([rt('LGAV', 'X', 'Y'), rt('LGMG', 'X', 'Y'), rt('LGAV', 'Y', 'X', false)], pts);
    expect(fc.features).toHaveLength(1);
  });
  it('an ordinary and a MIL / JET ONLY route on the same leg and direction: one arrow each, apart', () => {
    const jet = { ...rt('LGAV', 'X', 'Y'), id: 'LGAV:X>Y#2', kind: 'jet' as const };
    const mil = { ...rt('LGMG', 'X', 'Y'), kind: 'mil' as const };
    const fc = vfrRouteArrowFeatures([jet, mil, rt('LGAV', 'X', 'Y')], pts);
    expect(fc.features.map((f) => [f.properties.kind, f.geometry.coordinates[0]])).toEqual([
      ['vfr', 23 + VFR_ARROW_AT],
      ['jet', 23 + VFR_ARROW_AT - VFR_ARROW_STEP],
    ]);
  });
  it('the published routes: no two arrows on the same spot', () => {
    const fc = vfrRouteArrowFeatures(VFR_ROUTES, VFR_POINTS);
    expect(fc.features.length).toBeGreaterThan(20);
    const at = fc.features.map((f) => f.geometry.coordinates);
    for (let i = 0; i < at.length; i++)
      for (let j = i + 1; j < at.length; j++)
        expect(Math.hypot(at[i][0] - at[j][0], at[i][1] - at[j][1])).toBeGreaterThan(1e-4);
  });
});

describe('AIP VFR charts', () => {
  const aip = aipLinksOn(AIRAC.effective);
  const vfrChartUrl = aip.vfrChartUrl;
  const idx = vfrChartIndex(AERODROMES, VFR_POINTS, aip);
  const ad = (id: string) => AERODROMES.find((a) => a.id === id) as RefAerodrome;
  it('the table of contents gives each aerodrome VFR chart (AD 2.24 and AD 1.6.N.24)', () => {
    const html = `<A HREF="eaip/pdf/AD 2/AD2-LGAV/LG_AD_2_LGAV_VFR_en.pdf">x</A>
      <A HREF="eaip/pdf/AD 2/AD2-LGAV/LG_AD_2_LGAV_ADC_en.pdf">x</A>
      <A HREF="eaip/pdf/ad 1/AD 1.6 CAT B AERODROMES/catb/LG_AD_1_6_29_LGTG_VFR_en.pdf">x</A>`;
    expect(aipFiles(html)).toEqual({
      'VFR LGAV': 'eaip/pdf/AD 2/AD2-LGAV/LG_AD_2_LGAV_VFR_en.pdf',
      'VFR LGTG': 'eaip/pdf/ad 1/AD 1.6 CAT B AERODROMES/catb/LG_AD_1_6_29_LGTG_VFR_en.pdf',
    });
    expect(vfrChartUrl('LGAV')).toBe(aip.base + 'eaip/pdf/AD%202/AD2-LGAV/LG_AD_2_LGAV_VFR_en.pdf');
    expect(vfrChartUrl('LGTG')).toMatch(/LG_AD_1_6_29_LGTG_VFR_en\.pdf$/);
    expect(vfrChartUrl('LGZZ')).toBeNull();
  });
  it('every chart the VFR points and routes are printed on has its PDF', () => {
    const charts = new Set([...VFR_POINTS.map((p) => p.chart), ...VFR_ROUTES.map((r) => r.chart)]);
    charts.delete('LGGG'); // open flightmaps, not an AIP chart
    // heliport reporting points come from their AD 3.N.21 tables: no VFR chart
    expect([...charts].filter((c) => !c.startsWith('AD 3.') && !vfrChartUrl(c))).toEqual([]);
  });
  it('an aerodrome: its own chart, else the smallest chart that shows it', () => {
    expect(aerodromeVfrCharts(idx, ad('LGAV')).map((c) => c.icao)).toEqual(['LGAV']);
    expect(aerodromeVfrCharts(idx, ad('LGLR')).map((c) => c.icao)).toEqual(['LGLR']);
    // Megara has no VFR chart of its own; it is on the Athinai one
    expect(aerodromeVfrCharts(idx, ad('LGMG')).map((c) => c.icao)).toEqual(['LGAV']);
    // far out at sea: none
    expect(vfrChartsAt(idx, 20, 34.7)).toEqual([]);
  });
  it('a VFR point: the chart it is printed on', () => {
    const p = VFR_POINTS.find((v) => v.chart === 'LGKR')!;
    expect(vfrPointCharts(idx, p).map((c) => c.icao)).toEqual(['LGKR']);
  });
  it('airspace: CTR / ATZ → its aerodrome, TMA → the aerodromes inside it, an area → the chart around it', () => {
    const infos = airspaceInfos(AIRSPACES, AD_AIRSPACES, AREAS);
    const by = (id: string) => infos.find((a) => a.id === id)!;
    expect(airspaceVfrCharts(idx, by('LGKR-CTR')).map((c) => c.icao)).toEqual(['LGKR']);
    expect(airspaceVfrCharts(idx, by('LGKR-ATZ')).map((c) => c.icao)).toEqual(['LGKR']);
    expect(airspaceVfrCharts(idx, by('ATHINAI-TMA-1')).map((c) => c.icao)).toContain('LGAV');
    // an ENR 5 area: the one chart that shows its middle
    const areas = infos.filter((i) => ['P', 'R', 'D'].includes(i.type));
    const near = areas.find((i) => vfrChartsAt(idx, (i.bbox[0] + i.bbox[2]) / 2, (i.bbox[1] + i.bbox[3]) / 2).length);
    expect(near).toBeTruthy();
    expect(airspaceVfrCharts(idx, near!)).toHaveLength(1);
  });
  it('the info boxes link the charts', () => {
    const r = render(
      <AerodromeDetails
        a={ad('LGAV')}
        info={adDayInfo(ad('LGAV'), '2026-11-17', [])}
        airac="2611"
        charts={aerodromeVfrCharts(idx, ad('LGAV'))}
      />,
    );
    const link = r.getByTestId('vfr-chart-link');
    expect(link.textContent).toBe('VFR chart LGAV');
    expect(link.getAttribute('href')).toBe(vfrChartUrl('LGAV'));
    expect(link.getAttribute('target')).toBe('_blank');
    cleanup();
    const atv = NAVAIDS.find((n) => n.id === 'ATV VOR/DME')!;
    const n = render(<NavaidDetails n={atv} airac="2611" charts={vfrChartsAt(idx, atv.lon, atv.lat)} />);
    expect(n.getByTestId('vfr-chart-link').textContent).toBe('VFR chart LGAV');
    cleanup();
    const ctr = airspaceInfos(AIRSPACES, AD_AIRSPACES).find((a) => a.id === 'LGKR-CTR')!;
    const s = render(<AirspaceDetails items={[ctr]} airac="2611" chartsFor={(a) => airspaceVfrCharts(idx, a)} />);
    expect(s.getByTestId('vfr-chart-link').getAttribute('href')).toMatch(/LG_AD_2_LGKR_VFR_en\.pdf$/);
  });
});
