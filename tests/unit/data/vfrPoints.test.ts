// VFR reporting points: the text-table parser (tools/parse_vfr.ts) on rows as pdftotext -layout prints them,
// and the shipped src/data/ref/vfr-points.json (tools/build_vfr.py: every VFR chart, its coordinate table, the
// heliports' reporting points, one point per place).
import { describe, expect, test } from 'vitest';

import { distanceNm } from '../../../src/calc/nav';
import { hasAipPdf } from '../../../src/data/aipLinks';
import { VFR_POINTS, VFR_ROUTES } from '../../../src/data/ref';
import { cleanName, heliportTable, parseTable, sourceOf } from '../../../tools/parse_vfr';

// AD 1.6.29-LGTG-VFR: one point per line, compact coordinates (the table KALAMO was dropped from)
const LGTG = `
8    It is reminded that flying under VFR, the responsibility to avoid collision with other aircraft, provide terrain and obstacle clearance and avoid Restricted Airspace rests with the pilot.

                                                                         COORDINATES (WGS-84) OF REPOTING POINTS
                                                                                  ALIVERI                        382427N 0240231E
                                                                                   ILIKIS                        382439N 0231606E
                                                                                 KALAMO                          381731N 0235149E
                                                                                    KIMI                         383844N 0240917E
`;

// AD 2-LGAV-VFR: two points per line, degree / minute / second marks, a navaid ident and an ICAO in brackets
const LGAV = `
            AGIOS GEORGIOS    37° 29’ 31” N    023° 53’ 55” E                       PIKAD              38° 03’ 41” N         022° 41’ 52” E
               ABLONAS        38° 10' 10" N    023° 44' 08" E                   SOUTH KITHNOS          37° 17’ 51” N         024° 22’ 38” E
            ELEFSINA (LGEL)   38° 03’ 49” N    023° 33’ 21” E                       YDRA               37° 22’ 12” N         023° 35’ 16” E
              EAST POROS      37° 31’ 37” N    023° 31’ 57” E
               EGN (EGN)      37° 45’ 58” N    023° 25’ 35” E                        23°50E                      24°00E                       24°10E
            KORINTHOS (KOR)   37° 55’ 49”N     022° 56’ 09” E
`;

// AD 2-LGIR-VFR: the table to the right of the text, ’’ as the second mark, a space inside a value
const LGIR = `
    aircraft and facilitate the aerodrome traffic, four visual holding patterns are established                  ABEAM AGIOS                    35°21’48’’ N            25°47’21’’ E
2.3 Aircraft destined to Iraklion N. Kazantzakis Airport should hold over visual holding patterns                AGIOS MYRON                    35°13’51’’N             25°01’51’’ E
2.4 Departing traffic proceeding east to point ABEAM AGIOS, should proceed only via route                        HOSPITAL                       35°18’ 32’’ N           25° 05’37’’ E
`;

// AD 2-LGKL-VFR: the ordinal indicator º as the degree sign (the table the old parser read as empty)
const LGKL = `
      altitudes as depicted in this chart unless VFR criteria require otherwise or a special authorization is obtained         AREO      36º39'47''N      022º22'48''E
                                     to deviate from            BERAP      37º24'52''N      021º37'56''E
`;

// AD 3.19.21: a heliport's compulsory reporting points, with an altitude column between name and position
const HELIPORT = `
3.19.21.1.2         Helicopters shall only use the following compulsory reporting points:

        REPORTING POINTS                                       ALTITUDE (AMSL)                      COORDINATES
        DAMARI                                                 1000FT                               375323N 0235027E
        STAVROS                                                Outbound 2500FT – Inbound 2000FT     380039N 0235039E
        VILIZA (West Test Flight area)                         1000FT                               375506N 0234946E

3.19.21.1.3         Outbound traffic
3.19.21.1.3.1      Prior communication with Start-up-Delivery Tower Controller (frequency 118.675 MHz) is required.
        HELIPORT ARP                                                                                375400N 0235000E
`;

describe('parseTable', () => {
  test('compact coordinates, one point per line (KALAMO)', () => {
    const pts = parseTable(LGTG, 'AD 1.6.29-LGTG-VFR');
    expect(pts.map((p) => p.name)).toEqual(['ALIVERI', 'ILIKIS', 'KALAMO', 'KIMI']);
    const kalamo = pts.find((p) => p.name === 'KALAMO')!;
    expect(kalamo.lat).toBeCloseTo(38 + 17 / 60 + 31 / 3600, 5);
    expect(kalamo.lon).toBeCloseTo(23 + 51 / 60 + 49 / 3600, 5);
  });

  test('two columns of degree-minute-second points', () => {
    const warn: string[] = [];
    const pts = parseTable(LGAV, 'AD 2-LGAV-VFR', (m) => warn.push(m));
    expect(pts.map((p) => p.name)).toEqual([
      'AGIOS GEORGIOS',
      'PIKAD',
      'ABLONAS',
      'SOUTH KITHNOS',
      'ELEFSINA',
      'YDRA',
      'EAST POROS',
      'EGN',
      'KORINTHOS',
    ]);
    expect(pts[0]).toEqual({ name: 'AGIOS GEORGIOS', lat: 37.49194, lon: 23.89861 });
    expect(warn).toEqual([]);
  });

  test('a table beside the text, ’’ seconds and º degrees', () => {
    expect(parseTable(LGIR, 'AD 2-LGIR-VFR').map((p) => p.name)).toEqual(['ABEAM AGIOS', 'AGIOS MYRON', 'HOSPITAL']);
    expect(parseTable(LGIR, 'AD 2-LGIR-VFR')[2]).toEqual({ name: 'HOSPITAL', lat: 35.30889, lon: 25.09361 });
    expect(parseTable(LGKL, 'AD 2-LGKL-VFR')).toEqual([
      { name: 'AREO', lat: 36.66306, lon: 22.38 },
      { name: 'BERAP', lat: 37.41444, lon: 21.63222 },
    ]);
  });

  test('a heliport table: the name column, not the altitude', () => {
    const pts = parseTable(heliportTable(HELIPORT), 'AD 3.19');
    expect(pts.map((p) => p.name)).toEqual(['DAMARI', 'STAVROS', 'VILIZA']);
    expect(pts[1]).toEqual({ name: 'STAVROS', lat: 38.01083, lon: 23.84417 });
  });

  test('warns about rows it cannot read and positions outside the FIR', () => {
    const warn: string[] = [];
    // a position with no name before it, a latitude with an unreadable longitude, a point in Italy
    const pts = parseTable(
      `   381731N 0235149E\n   KAPPA      38° 10' 10" N    0X3° 44' 08" E\n   ROMA       415400N 0122900E\n   LAMDA      381000N 0225600E\n`,
      'AD 9-TEST',
      (m) => warn.push(m),
    );
    expect(pts.map((p) => p.name)).toEqual(['LAMDA']);
    expect(warn).toEqual([
      'AD 9-TEST: coordinates without a name: 381731N 0235149E',
      'AD 9-TEST ROMA: 41.9, 12.48333 is outside the FIR',
      'AD 9-TEST: the table lists 4 positions, 3 read as points',
    ]);
  });

  test('names and AIP references', () => {
    expect(cleanName('KINETIZA MONASTERY (East Test Flight area)')).toBe('KINETIZA MONASTERY');
    expect(cleanName('MEGARA (LGMG) *')).toBe('MEGARA');
    expect(sourceOf('LG_AD_1_6_29_LGTG_VFR_en.txt')).toEqual(['LGTG', 'AD 1.6.29-LGTG-VFR']);
    expect(sourceOf('LG_AD_2_LGKV_VFR_en.txt')).toEqual(['LGKV', 'AD 2-LGKV-VFR']);
    expect(sourceOf('LG_AD_3_19_ATTIKI-KOROPI-PROFARTA_en.txt')).toEqual(['AD 3.19', 'AD 3.19']);
    expect(sourceOf('LG_AD_2_LGKV_en.txt')).toBeNull();
  });
});

describe('shipped VFR points', () => {
  const find = (name: string, chart?: string) =>
    VFR_POINTS.filter((p) => p.name === name && (!chart || (p.charts ?? [p.chart]).includes(chart)));
  const near = (name: string, chart: string, lat: number, lon: number) => {
    const pts = find(name, chart);
    expect(pts.length, `${chart} ${name}`).toBeGreaterThan(0);
    for (const p of pts) expect(distanceNm(p, { lat, lon }), `${chart} ${name}`).toBeLessThan(0.05);
    return pts[0];
  };

  test('KALAMO (Tanagra MTMA, AD 1.6.29-LGTG-VFR) at its table position', () => {
    const p = near('KALAMO', 'LGTG', 38 + 17 / 60 + 31 / 3600, 23 + 51 / 60 + 49 / 3600);
    expect(p.chart).toBe('LGTG');
    expect(p.src).toBe('table');
    expect(p.sources).toEqual(['AD 1.6.29-LGTG-VFR']);
  });

  test('points that were missing before', () => {
    near('LAMIAS', 'LGTG', 38.90167, 22.4325);
    near('OREI', 'LGTG', 38.94944, 23.09);
    near('DAMARI', 'AD 3.19', 37.88972, 23.84083); // heliport reporting points
    near('KINETIZA MONASTERY', 'AD 3.70', 37.84028, 23.95361);
    near('EPALO', 'LGIR', 35.71556, 25.01028); // IFR fixes printed on the VFR charts
    near('OTREX', 'LGIR', 35.15444, 24.93889);
    near('DELAV', 'LGKP', 35.85472, 26.61167);
    near('RODIP', 'LGKV', 41.42083, 24.70111);
    near('GENDO', 'LGPA', 36.92139, 24.79472); // position from ENR 4.4
    near('OXIA', 'LGAD', 38.25444, 21.12667); // the LGAD table, printed as an image
    near('ASTOV', 'LGKL', 37.42083, 22.53444); // the LGKL table (º degree signs)
    expect(find('GENDO')[0].sources).toEqual(['AD 2-LGPA-VFR', 'ENR 4.4']);
    // the renamed Larissa points under their AIP names
    for (const n of ['GONNOI', 'NIKEAS', 'PLATAS', 'SARANTAPORO', 'FLABOURO'])
      expect(find(n, 'LGLR').length, n).toBe(1);
  });

  test('a point published in several places is one point with all its sources', () => {
    // ABLONAS ends routes on both charts, so each chart keeps its copy (routes look their ends up by
    // chart); both copies are the same merged point
    const ablonas = find('ABLONAS');
    expect(ablonas.map((p) => p.chart).sort()).toEqual(['LGAV', 'LGTG']);
    for (const p of ablonas) {
      expect([p.lat, p.lon]).toEqual([ablonas[0].lat, ablonas[0].lon]);
      expect(p.charts).toEqual(['LGAV', 'LGTG']);
      expect(p.sources).toEqual(['AD 2-LGAV-VFR', 'AD 1.6.29-LGTG-VFR']);
    }
    const kea = find('KEA');
    expect(kea).toHaveLength(1);
    expect(kea[0].sources).toEqual(['AD 2-LGAV-VFR', 'AD 3.19', 'AD 3.70']);
    // the same name far apart: two points (Chalki island off Rodos, Chalki in Thessaly)
    // (the Thessaly one ends routes on LGBL and LGLR, so it has a copy on each)
    const chalki = [...new Map(find('CHALKI').map((p) => [`${p.lat},${p.lon}`, p])).values()];
    expect(chalki.length).toBe(2);
    expect(distanceNm(chalki[0], chalki[1])).toBeGreaterThan(100);
    // no open-flightmaps copy of a published point in another spelling (OSCAR for OSCARA, GONNI for GONNOI)
    for (const n of ['OSCAR', 'GONNI', 'TIMPAKI', 'STRYMON', 'A/F FLABOURO']) expect(find(n), n).toEqual([]);
  });

  test('the same place twice only as the route end of two charts', () => {
    const key = (n: string) => n.replace(/[^A-Z0-9]/g, '');
    for (const [i, a] of VFR_POINTS.entries())
      for (const b of VFR_POINTS.slice(i + 1)) {
        if (key(a.name) !== key(b.name) || distanceNm(a, b) > 1) continue;
        expect(a.chart, a.name).not.toBe(b.chart);
        expect([a.lat, a.lon, a.charts]).toEqual([b.lat, b.lon, b.charts]);
        for (const p of [a, b])
          expect(
            VFR_ROUTES.some((r) => r.chart === p.chart && (r.a === p.name || r.b === p.name)),
            p.id,
          ).toBe(true);
      }
  });

  test('AIP points: positions in the FIR, with their sources', () => {
    for (const p of VFR_POINTS) {
      if (p.charts?.length === 0) continue; // open flightmaps only (some lie outside the FIR)
      expect(p.lat > 34 && p.lat < 42 && p.lon >= 19 && p.lon < 30, p.id).toBe(true);
      expect(p.sources!.length, p.id).toBeGreaterThan(0);
      for (const s of p.sources!) expect(hasAipPdf(s), `${p.id} ${s}`).toBe(true);
    }
    expect(VFR_POINTS.filter((p) => p.src !== 'ofm').length).toBeGreaterThanOrEqual(300);
  });
});
