// PGF.brief against the website's Brief sections: the METAR box's stations (metarStations), the
// take-off and landing verdicts (endpointVerdict, as PerformanceSection), the aerodrome hours of the
// day (adDayInfo, as AerodromeSection) and the NOTAM groups (groupNotams, as NotamSection).
import { describe, expect, test } from 'vitest';

import { groupNotams, onlyFromAutorouter, visibleNotams } from '../../../src/data/notams';
import { REF } from '../../../src/data/ref';
import { adDayInfo } from '../../../src/features/editor/AerodromeHours';
import { calcAdEffects } from '../../../src/features/editor/panels/flightCalc';
import { metarStations } from '../../../src/features/editor/panels/metarStations';
import { endpointVerdict, reasonText, weatherText } from '../../../src/features/editor/panels/performance';
import { brief, computeFlight, weatherRequests } from '../../../src/native/core';
import type { Flight } from '../../../src/shared';
import { AC, API_REF, briefing, crew, flight, METAR_ANSWER, notam, NOW, PILOT, ROUTE } from './fixtures';

/** computeFlight with METAR/TAF only (no winds), as JSON (what the app hands back to PGF.brief). */
function computed(f: Flight, notams: ReturnType<typeof briefing> | null = null) {
  const weather: Record<string, unknown> = {};
  for (const p of weatherRequests({ flight: f, ref: API_REF, now: NOW }))
    if (p.startsWith('/api/weather/metar')) weather[p] = METAR_ANSWER;
  const raw = computeFlight({ flight: f, aircraft: AC, pilot: PILOT, ref: API_REF, weather, notams, now: NOW });
  return { raw, json: JSON.parse(JSON.stringify(raw)) as typeof raw };
}

describe('brief', () => {
  test('METAR box: the route’s stations with a report, as the website lists them', () => {
    const f = flight(ROUTE());
    const { raw, json } = computed(f);
    const b = brief({ computed: json, flight: f, aircraft: AC, ref: API_REF, now: NOW });
    expect(b.metar.shown).toBe(true);
    const web = metarStations(
      [raw.departure.aerodrome, ...raw.stops.map((s) => s.aerodrome), raw.arrival.aerodrome],
      f.route,
      REF.aerodromes,
    ).filter((s) => s.role !== 'area' || raw.weather.metar?.stations[s.icao]);
    expect(b.metar.rows.map((r) => r.icao)).toEqual(web.map((s) => s.icao));
    const lgtt = b.metar.rows.find((r) => r.icao === 'LGTT')!;
    expect(lgtt.metar).toBe(METAR_ANSWER.stations.LGTT.metar);
    expect(lgtt.taf).toBe(METAR_ANSWER.stations.LGTT.taf);
    expect(lgtt.where).toBe('Departure');
    expect(lgtt.observedMs).toBe(METAR_ANSWER.stations.LGTT.observed);
  });

  test('METAR box: hidden a day before the flight', () => {
    const f = flight(ROUTE());
    const { json } = computed(f);
    const b = brief({ computed: json, flight: f, aircraft: AC, ref: API_REF, now: NOW - 30 * 3600e3 });
    expect(b.metar).toEqual({ shown: false, rows: [] });
  });

  test('take-off and landing: the website’s verdicts, weather line and runway choices', () => {
    const f = flight(ROUTE(), {
      options: { ...flight([]).options, departureRunway: '21', arrivalSurface: 'wet grass' },
    });
    const { raw, json } = computed(f);
    const b = brief({ computed: json, flight: f, aircraft: AC, ref: API_REF, now: NOW });
    expect(b.performance.endpoints.map((e) => e.tid)).toEqual(['takeoff', 'landing']);
    const [dep, arr] = b.performance.endpoints;
    const v = endpointVerdict(raw.departure, AC);
    expect(dep.verdict).toBe(v.verdict);
    expect(dep.title).toBe('Departure');
    expect(dep.icao).toBe('LGTT');
    expect(dep.weather).toBe(weatherText(raw.departure));
    expect(dep.runway).toBe('21');
    expect(dep.runwayAuto).toBeNull();
    expect(dep.runways.map((r) => r.value)).toEqual(['03', '21']);
    expect(dep.surfaces).toEqual(Object.keys(AC.performance.factors.runwayCondition ?? {}));
    expect(arr.title).toBe('Destination');
    expect(arr.surface).toBe('wet grass');
    expect(arr.verdict).toBe(endpointVerdict(raw.arrival, AC).verdict);
    expect(b.performance.noGo).toBe(
      [raw.departure, raw.arrival].some((e) => endpointVerdict(e, AC).verdict === 'fail'),
    );
  });

  test('take-off and landing: above the MTOW is a No-go with the website’s reason', () => {
    const heavy = [crew('PIC', 'front-left', 'Test Pilot', 500), crew('PAX', 'front-right', 'Heavy', 500)];
    const f = flight(ROUTE(), { crew: heavy, fobL: 144 });
    const { raw, json } = computed(f);
    const b = brief({ computed: json, flight: f, aircraft: AC, ref: API_REF, now: NOW });
    const v = endpointVerdict(raw.departure, AC);
    expect(v.verdict).toBe('fail');
    expect(b.performance.noGo).toBe(true);
    expect(b.performance.endpoints[0].verdictLabel).toBe('No-go');
    expect(b.performance.endpoints[0].reason).toBe(reasonText(v));
    expect(b.performance.endpoints[0].mass?.tone).toBe('danger');
  });

  test('aerodrome hours: the day’s hours as the website shows them', () => {
    const f = flight(ROUTE());
    const { raw, json } = computed(f);
    const b = brief({ computed: json, flight: f, aircraft: AC, ref: API_REF, now: NOW });
    expect(b.aerodromes.items.map((x) => x.id)).toEqual(raw.aerodromeChecks.map((c) => `${c.role}-${c.pointIndex}`));
    raw.aerodromeChecks.forEach((c, k) => {
      const web = adDayInfo(c.aerodrome, f.date, calcAdEffects(null));
      const mine = b.aerodromes.items[k];
      expect(mine.hours?.ad?.text ?? null).toBe(web.ad?.text ?? null);
      expect(mine.hours?.handling?.text ?? null).toBe(web.handling?.text ?? null);
      expect(mine.when).toBe(c.when);
    });
  });

  test('NOTAMs: the website’s groups, the autorouter-only tag and Show all', () => {
    const f = flight(ROUTE());
    const b0 = briefing([
      notam(),
      notam({ key: 'A2000/26', itemA: ['LGMG'], relevant: true, sources: ['autorouter'] }),
      notam({ key: 'A3000/26', relevant: false, reasons: ['above the flight'] }),
    ]);
    const { json } = computed(f, b0);
    const b = brief({ computed: json, flight: f, notams: b0, ref: API_REF, now: NOW });
    const web = groupNotams(visibleNotams(b0, false), ['LGTT', 'LGMG']);
    expect(b.notams?.groups.map((g) => [g.icao, g.notams.map((n) => n.key)])).toEqual(
      web.map((g) => [g.icao, g.notams.map((n) => n.key)]),
    );
    const tagged = b.notams!.groups.flatMap((g) => g.notams).filter((n) => n.autorouter);
    expect(tagged.map((n) => n.key)).toEqual(b0.notams.filter(onlyFromAutorouter).map((n) => n.key));
    expect(b.notams?.hiddenCount).toBe(1);
    expect(b.notams?.meta).toContain('3 NOTAMs from autorouter');
    const all = brief({ computed: json, flight: f, notams: b0, ref: API_REF, now: NOW, showAll: true });
    expect(all.notams!.groups.flatMap((g) => g.notams).map((n) => n.key)).toContain('A3000/26');
  });
});
