// METAR/TAF decoding (src/data/weatherMetar.ts). Reports from tests/fixtures/weather/awc-*.json
// (aviationweather.gov, 2026-11-15) plus hand-written ones for the edge cases.
import { afterEach, describe, expect, test, vi } from 'vitest';
import metars from '../../fixtures/weather/awc-metar-2026-11-15.json';
import tafs from '../../fixtures/weather/awc-taf-2026-11-15.json';
import {
  clearMetarCache, decodeMetarTafResponse, fetchMetarTaf, fmtMetarWind, parseMetar, parseTaf, resolveDayTime, tafCovers,
} from '../../../src/data/weatherMetar';

const T = (s: string) => Date.parse(s);
const REF = T('2026-11-15T13:25:00Z');

describe('parseMetar', () => {
  test('every recorded METAR decodes to the provider’s own decoded fields', () => {
    for (const r of metars) {
      const m = parseMetar(r.rawOb, REF);
      expect(m.station).toBe(r.icaoId);
      expect(m.timeMs).toBe(r.obsTime * 1000);
      expect(m.tempC).toBe(r.temp);
      expect(m.dewC).toBe(r.dewp);
      expect(m.qnhHpa).toBe(r.altim);
      expect(m.wind!.dirDeg).toBe(r.wdir);
      expect(m.wind!.speedKt).toBe(r.wspd);
      expect(m.clouds.map((c) => [c.cover, c.baseFt])).toEqual(r.clouds.map((c) => [c.cover, c.base]));
    }
  });

  test('LGAV: variable sector, trend not decoded', () => {
    const m = parseMetar('METAR LGAV 151320Z 05009KT 010V070 9999 FEW025 SCT050 17/12 Q1024 NOSIG', REF);
    expect(m).toMatchObject({
      type: 'METAR', station: 'LGAV', timeMs: T('2026-11-15T13:20Z'), visibilityM: 9999, cavok: false, tempC: 17, dewC: 12, qnhHpa: 1024,
      wind: { dirDeg: 50, speedKt: 9, gustKt: null, varFrom: 10, varTo: 70, variable: false, calm: false },
    });
    expect(fmtMetarWind(m.wind)).toBe('05009KT');
  });

  test('gusts, weather, CB, and a TEMPO wind that must not replace the observed one', () => {
    const m = parseMetar('METAR LGKR 151320Z 27015G27KT 4000 -RA BKN012 OVC030CB 14/13 Q1009 TEMPO 33025G40KT TSRA', REF);
    expect(m.wind).toMatchObject({ dirDeg: 270, speedKt: 15, gustKt: 27 });
    expect(m.weather).toEqual(['-RA']);
    expect(m.visibilityM).toBe(4000);
    expect(m.clouds).toEqual([{ cover: 'BKN', baseFt: 1200, type: null }, { cover: 'OVC', baseFt: 3000, type: 'CB' }]);
    expect(fmtMetarWind(m.wind)).toBe('27015G27KT');
  });

  test('VRB, CAVOK, negative temperatures, month boundary', () => {
    const m = parseMetar('METAR LGKO 302350Z VRB03KT CAVOK M02/M05 Q1031=', T('2026-12-01T00:05Z'));
    expect(m).toMatchObject({ timeMs: T('2026-11-30T23:50Z'), cavok: true, visibilityM: 9999, skyClear: 'CAVOK', tempC: -2, dewC: -5, qnhHpa: 1031 });
    expect(m.wind).toMatchObject({ dirDeg: null, speedKt: 3, variable: true, calm: false });
    expect(fmtMetarWind(m.wind)).toBe('VRB03KT');
  });

  test('calm, statute miles, inHg, AUTO, remarks ignored', () => {
    const m = parseMetar('KJFK 151351Z AUTO 00000KT 10SM CLR 08/M01 A3012 RMK AO2 SLP199 T00831011', REF);
    expect(m).toMatchObject({ station: 'KJFK', auto: true, visibilityM: 9999, skyClear: 'CLR', tempC: 8, dewC: -1, qnhHpa: 1020 });
    expect(m.wind).toMatchObject({ calm: true, speedKt: 0, dirDeg: null });
    expect(fmtMetarWind(m.wind)).toBe('00000KT');
  });

  test('MPS and KMH converted to kt; missing wind and temperature groups', () => {
    expect(parseMetar('METAR UUEE 151330Z 18005MPS 9999 BKN020 03/01 Q1012', REF).wind).toMatchObject({ dirDeg: 180, speedKt: 10 });
    expect(parseMetar('METAR XXXX 151330Z 18036KMH 9999 03/01 Q1012', REF).wind).toMatchObject({ speedKt: 19 });
    const m = parseMetar('METAR LGXX 151320Z AUTO /////KT 9999 NCD 17/// Q1024', REF);
    expect(m.wind).toBeNull(); expect(m.skyClear).toBe('NCD'); expect(m.qnhHpa).toBe(1024);
  });

  test('NIL report; garbage never throws', () => {
    expect(parseMetar('METAR LGSO 151320Z NIL=', REF)).toMatchObject({ nil: true, station: 'LGSO', wind: null });
    expect(parseMetar('', REF)).toMatchObject({ station: '', timeMs: null, wind: null });
    expect(parseMetar('hello world 99/99/99', REF).wind).toBeNull();
  });
});

describe('parseTaf', () => {
  test('recorded TAFs: issue time and validity match the provider', () => {
    for (const r of tafs) {
      const t = parseTaf(r.rawTAF, REF);
      expect(t.station).toBe(r.icaoId);
      expect(t.issuedMs).toBe(T(r.issueTime));
      expect(t.validFromMs).toBe(r.validTimeFrom * 1000);
      expect(t.validToMs).toBe(r.validTimeTo * 1000);
    }
  });

  test('AMD, month boundary, hour 24, coverage', () => {
    const t = parseTaf('TAF AMD LGAV 302310Z 0100/0124 03014KT 9999 FEW015', T('2026-11-30T23:15Z'));
    expect(t).toMatchObject({ amended: true, station: 'LGAV', issuedMs: T('2026-11-30T23:10Z'), validFromMs: T('2026-12-01T00:00Z'), validToMs: T('2026-12-02T00:00Z') });
    expect(tafCovers(t, T('2026-12-01T12:00Z'))).toBe(true);
    expect(tafCovers(t, T('2026-12-02T01:00Z'))).toBe(false);
    expect(tafCovers(null, T('2026-12-01T12:00Z'))).toBe(false);
    // validity crossing the month end
    const u = parseTaf('TAF LGIR 301100Z 3012/0112 32010KT 9999 FEW020', T('2026-11-30T11:05Z'));
    expect([u.validFromMs, u.validToMs]).toEqual([T('2026-11-30T12:00Z'), T('2026-12-01T12:00Z')]);
  });

  test('resolveDayTime picks the latest instant not after ref + 2 days', () => {
    expect(resolveDayTime(31, 12, 0, T('2026-12-01T00:00Z'))).toBe(T('2026-10-31T12:00Z')); // November has no 31st
    expect(resolveDayTime(1, 0, 0, T('2026-12-31T23:00Z'))).toBe(T('2027-01-01T00:00Z'));
    expect(resolveDayTime(32, 0, 0, REF)).toBeNull();
  });
});

describe('client', () => {
  afterEach(() => { vi.unstubAllGlobals(); clearMetarCache(); });

  test('decodeMetarTafResponse uses the provider observation time', () => {
    const r = decodeMetarTafResponse({
      fetched: T('2026-11-15T13:36Z'),
      stations: { LGAV: { metar: metars[0].rawOb, taf: tafs[0].rawTAF, observed: metars[0].obsTime * 1000 } },
    });
    expect(r.status).toBe('ok');
    expect(r.message).toBe('aviationweather.gov, fetched 13:36Z');
    expect(r.stations.LGAV.observedMs).toBe(T('2026-11-15T13:20Z'));
    expect(r.stations.LGAV.metar!.qnhHpa).toBe(1024);
    expect(r.stations.LGAV.taf!.validToMs).toBe(T('2026-11-16T12:00Z'));
  });

  test('fetchMetarTaf: normalises ids, caches, never rejects', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify({ fetched: REF, stations: { LGAV: { metar: metars[0].rawOb, taf: null, observed: null } } }), { status: 200 });
    });
    const a = await fetchMetarTaf(['lgav', 'LGTT', 'LGAV', '', 'X1']);
    expect(calls).toEqual(['/api/weather/metar?ids=LGAV,LGTT']);
    expect(a.stations.LGAV.metar!.station).toBe('LGAV');
    expect(a.stations.LGAV.observedMs).toBe(T('2026-11-15T13:20Z')); // decoded, the proxy gave none
    expect(a.stations.LGTT).toBeUndefined();
    await fetchMetarTaf(['LGTT', 'LGAV']);
    expect(calls).toHaveLength(1);
    await fetchMetarTaf(['LGTT', 'LGAV'], { force: true });
    expect(calls).toHaveLength(2);
    expect(await fetchMetarTaf([])).toMatchObject({ status: 'ok', stations: {} });

    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'weather service unavailable' }), { status: 502 }));
    const e = await fetchMetarTaf(['LGIR']);
    expect(e).toMatchObject({ status: 'error', stations: {}, message: 'METAR/TAF unavailable (weather service unavailable)' });
    vi.stubGlobal('fetch', async () => { throw new TypeError('Failed to fetch'); });
    expect((await fetchMetarTaf(['LGIR'])).message).toBe('METAR/TAF unavailable (offline)'); // the failure was not cached
  });
});
