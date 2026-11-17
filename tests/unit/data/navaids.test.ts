// Radio navaids: the ENR 4.1 / AD 2.19 / AD 1.6.N.19 parser (tools/parse_navaids.ts) on station rows as
// pdftotext -layout prints them, and the shipped src/data/ref/navaids.json.
import { describe, expect, test } from 'vitest';

import { FIR, NAVAIDS } from '../../../src/data/ref';
import { pointInRing } from '../../../src/features/editor/map/airspace';
import { aerodromeSection, mergeNavaids, parseStations } from '../../../tools/parse_navaids';

// ENR 4.1 rows; the degree sign is sometimes the Symbol font's U+F0B0 and the E a Greek Ε
const ENR41 = `
         Name of station                                                          ELEV
        (VOR: Declination)                                                       (MSL)
                1             2        3             4            5                  6                       7
ATHINAI VOR/DME              ATV   114.40 MHz      H24      375319.24N       2378 FT / 724.9 M Coverage FL 500 / 120 NM
                                    (CH 91X)                0234816.19E
(5°E/2025)                                                                                      FRA(I)
(5°E)
FISKA L                      FIS    314 kHz        H24      410553.33N               -          Coverage 40 NM
                                                            0225930.34E
(5°E/2024)
IRAKLION VOR/DME             IRA   108.80 MHz      H24      352026.68N       116 FT / 35.38 M   Coverage FL 250 / 40 NM
                                    (CH 25X)                0251106.52E

(5Ε/2025)                                                                                      FRA(I)
(5E)




HELLENIC AVIATION SERVICE PROVIDER                                                                       AIRAC AMDT 10/25
KORINTHOS NDB                KOR    392 kHz       H24       375549.48N            -          Coverage 50NM
                                                            0225609.24E
(5°E/2025)                                                                                   FRA(I)
`;

// an aerodrome's AD 2: the type wrapped under the name, and an ILS that is not a navaid of the map
const AD2 = `
LGBL AD 2.18 ATS COMMUNICATION FACILITIES
 TWR        ANCHIALOS TOWER     118.300 MHz
                                   LGBL AD 2.19 RADIO NAVIGATION AND LANDING AIDS
      Type of aid           ID      Frequency       Hours of         Position of     Elevation of              Remarks
              1             2            3               4               5                 6                       7
 ANCHIALOS                AGH      110.40 MHZ           H24         391259.36N       68 FT / 20.61 M Coverage FL 250 / 40 NM
 VOR/DME                            (CH 41X)                        0224741.72E
 (5°E/2024)
 (5°E)
 ANCHIALOS ILS/DME        IANC                          HJ
 CAT I, RWY 26
 ILS/LLZ                           110.90 MHz                       391301.43N                         Coverage FL 062.5 / 25 NM
 (5°E)                                                              0224625.31E
 DME                                 (CH 46X)                       391319.61N       41 FT / 12.55 M   Coverage FL 100 / 25 NM
                                                                    0224825.66E
Radio Navigation and Landing Aids under responsibility of HASP: AGH VOR/DME.
                                   LGBL AD 2.20 LOCAL AERODROME REGULATIONS
 ANCHIALOS L              ANL      300 kHz         H24       391300.00N
`;

const AD16 = `
                                      AD 1.6.3.19 RADIO NAVIGATION AND LANDING AIDS
 ALEXANDRIA VOR             AXE        110.600 MHz        HS            403841.20N             -         Coverage FL 250/40 NM
 (5°E/2024)                                                             0222952.40E
 (5°E)
 SOMEWHERE TACAN            SWT        CH 85X             H24           400000.00N        120 FT / 36.6 M
                                                                        0230000.00E
                                      AD 1.6.3.20 LOCAL AERODROME REGULATIONS
`;

describe('parse_navaids', () => {
  test('ENR 4.1 stations: frequency, channel, position, DME elevation, variation and declination', () => {
    const warn: string[] = [];
    const s = parseStations(ENR41, 'ENR 4.1', (m) => warn.push(m));
    expect(warn).toEqual([]);
    expect(s.map((n) => n.id)).toEqual(['ATV VOR/DME', 'FIS L', 'IRA VOR/DME', 'KOR NDB']);
    expect(s[0]).toEqual({
      id: 'ATV VOR/DME',
      ident: 'ATV',
      name: 'ATHINAI',
      type: 'VOR/DME',
      freq: 114.4,
      unit: 'MHz',
      channel: '91X',
      lat: 37.888678,
      lon: 23.804497,
      elevFt: 2378,
      variation: 5,
      variationYear: 2025,
      declination: 5,
      hours: 'H24',
      coverage: 'FL 500 / 120 NM',
      sources: ['ENR 4.1'],
    });
    expect(s[1]).toMatchObject({ type: 'L', freq: 314, unit: 'kHz', channel: null, elevFt: null, declination: null });
    expect(s[2]).toMatchObject({ variation: 5, variationYear: 2025, declination: 5, lat: 35.340744, lon: 25.185144 });
    expect(s[3]).toMatchObject({ type: 'NDB', freq: 392, coverage: '50 NM', variation: 5 });
  });

  test('AD 2.19: only its own section, the type under the name, no ILS components', () => {
    const sec = aerodromeSection(AD2)!;
    expect(sec.source).toBe('LGBL AD 2.19');
    const s = parseStations(sec.text, sec.source);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ id: 'AGH VOR/DME', name: 'ANCHIALOS', freq: 110.4, unit: 'MHz', channel: '41X' });
    expect(aerodromeSection('LGAD AD 2.18 ATS\nno navaids')).toBeNull();
  });

  test('AD 1.6.N.19: a VOR without DME and a TACAN with a channel only', () => {
    const sec = aerodromeSection(AD16)!;
    expect(sec.source).toBe('AD 1.6.3.19');
    const s = parseStations(sec.text, sec.source);
    expect(s.map((n) => n.id)).toEqual(['AXE VOR', 'SWT TACAN']);
    expect(s[0]).toMatchObject({ freq: 110.6, channel: null, elevFt: null, hours: 'HS', coverage: 'FL 250 / 40 NM' });
    expect(s[1]).toMatchObject({ freq: null, channel: '85X', elevFt: 120, lat: 40, lon: 23 });
  });

  test('a station in ENR 4.1 and an AD 2.19 is one navaid with both sources; one ident can name two aids', () => {
    const enr = parseStations(ENR41, 'ENR 4.1');
    const ad = parseStations(ENR41.replace(/2378 FT/, '2380 FT'), 'LGAV AD 2.19');
    const loc = {
      ...ad[0],
      id: 'ATV L',
      type: 'L' as const,
      freq: 300,
      unit: 'kHz' as const,
      sources: ['LGAV AD 2.19'],
    };
    const m = mergeNavaids([enr, [...ad, loc]]);
    expect(m.map((n) => n.id)).toEqual(['ATV L', 'ATV VOR/DME', 'FIS L', 'IRA VOR/DME', 'KOR NDB']);
    const atv = m.find((n) => n.id === 'ATV VOR/DME')!;
    expect(atv.sources).toEqual(['ENR 4.1', 'LGAV AD 2.19']);
    expect(atv.elevFt).toBe(2378); // ENR 4.1 wins
  });
});

describe('src/data/ref/navaids.json', () => {
  const byId = new Map(NAVAIDS.map((n) => [n.id, n]));
  test('the en-route VOR/DMEs and NDBs of ENR 4.1 and the aerodrome aids', () => {
    expect(NAVAIDS.length).toBeGreaterThanOrEqual(80);
    expect(byId.size).toBe(NAVAIDS.length);
    expect(byId.get('ATV VOR/DME')).toMatchObject({ name: 'ATHINAI', freq: 114.4, channel: '91X' });
    expect(byId.get('SPA VOR/DME')).toMatchObject({ name: 'ATHINAI', freq: 117.5, sources: ['LGAV AD 2.19'] });
    expect(byId.get('KOR NDB')?.sources).toEqual(['ENR 4.1', 'LGAV AD 2.19']);
    expect(byId.get('TGG VOR/DME')?.sources).toEqual(['AD 1.6.29.19']);
    expect(NAVAIDS.filter((n) => n.sources.includes('ENR 4.1')).length).toBeGreaterThanOrEqual(34);
    for (const t of ['VOR/DME', 'VOR', 'NDB', 'L'])
      expect(
        NAVAIDS.some((n) => n.type === t),
        t,
      ).toBe(true);
  });
  test('every navaid is inside the FIR, with a frequency in its band', () => {
    for (const n of NAVAIDS) {
      expect(
        pointInRing(
          n.lon,
          n.lat,
          FIR.boundary.map(([la, lo]) => [lo, la]),
        ),
        n.id,
      ).toBe(true);
      if (n.unit === 'MHz') expect(n.freq! >= 108 && n.freq! <= 118, n.id).toBe(true);
      else expect(n.freq! >= 190 && n.freq! <= 1750, n.id).toBe(true);
      expect(n.sources.length, n.id).toBeGreaterThan(0);
      if (n.type.startsWith('VOR')) expect(n.declination, n.id).not.toBeNull();
    }
  });
});
