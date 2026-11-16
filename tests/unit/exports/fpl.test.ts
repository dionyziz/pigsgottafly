// FPL message builder (ICAO Doc 4444 Appendix 2/3): field formats, item 18/19 composition, line
// wrapping, and the full message for a realistic flight built from the app's records.
import { describe, expect, test } from 'vitest';

import { buildLegs, computeNavlog, defaultAltitudes, navlogAircraft, planFuel } from '../../../src/calc';
import { aerodrome, REF, vfrPoint } from '../../../src/data/ref';
import {
  AFTN_LINE,
  aircraftId,
  buildFpl,
  cleanPhone,
  cleanText,
  coordField,
  dofField,
  eobtField,
  type FplInput,
  hhmm,
  intlPhone,
  locationField,
  MISSING,
  oneLine,
  parseItem18,
  picName,
  routeElement,
  routeField,
  speedField,
  transliterate,
  wrapLine,
} from '../../../src/features/exports/fpl/fpl';
import { alternateOf, fplInputFrom, totalEetMin } from '../../../src/features/exports/fpl/input';
import { type Aircraft, emptyFlightDoc, type Equipment, type Flight, type RoutePoint } from '../../../src/shared';

const EQ: Equipment = {
  item10a: 'S',
  item10b: 'C',
  pbn: '',
  item18Extras: '',
  emergencyRadio: { uhf: false, vhf: false, elt: true },
  survival: { polar: false, desert: false, maritime: false, jungle: false },
  jackets: { present: false, light: false, fluorescein: false, uhf: false, vhf: false },
  dinghies: null,
  remarks: '',
};

const ad = (icao: string) => {
  const a = aerodrome(icao)!;
  return { icao: a.icao, name: a.name, lat: a.lat, lon: a.lon };
};

function base(over: Partial<FplInput> = {}): FplInput {
  const tt = ad('LGTT');
  return {
    registration: 'SX-ASV',
    icaoType: 'C172',
    makeModel: 'Reims/Cessna F172M',
    wake: 'L',
    equipment: EQ,
    operator: '',
    colours: 'WHITE BLUE STRIPES',
    date: '2026-11-20',
    eobt: '08:05',
    departure: tt,
    destination: tt,
    alternates: [],
    route: [
      { name: 'LGTT', lat: tt.lat, lon: tt.lon, kind: 'aerodrome' },
      { name: 'OROPOS', lat: 38.3167, lon: 23.7667, kind: 'vfr' },
      { name: 'ZOFRI', lat: 38.0333, lon: 23.7833, kind: 'custom' },
      { name: 'LGTT', lat: tt.lat, lon: tt.lon, kind: 'aerodrome' },
    ],
    cruiseTasKt: 92,
    totalEetMin: 75,
    enduranceMin: 240,
    personsOnBoard: 2,
    pic: { fullName: 'Dionysis Zindros', phone: '+30 694 000 0000' },
    remarks: '',
    ...over,
  };
}

describe('field formats', () => {
  test('item 7: registration without hyphen, upper case', () => {
    expect(aircraftId('SX-ASV')).toBe('SXASV');
    expect(aircraftId('sx-asg')).toBe('SXASG');
    expect(aircraftId(' D-EABC ')).toBe('DEABC');
    expect(aircraftId('N 123 AB')).toBe('N123AB');
  });

  test('coordinates: degrees + minutes, 11 characters, rounded to the minute with carry', () => {
    expect(coordField(38.0333, 23.7833)).toBe('3802N02347E');
    expect(coordField(38.1089, 23.7838)).toBe('3807N02347E');
    expect(coordField(37.99999, 23.99999)).toBe('3800N02400E');
    expect(coordField(-33.95, -118.4)).toBe('3357S11824W');
    expect(coordField(0, 0)).toBe('0000N00000E');
    expect(coordField(5.5, 7.25)).toBe('0530N00715E');
    for (const [la, lo] of [
      [35.1, 19.9],
      [41.7, 28.3],
      [36.4, 22.05],
    ])
      expect(coordField(la, lo)).toMatch(/^\d{4}[NS]\d{5}[EW]$/);
  });

  test('times: HHMM', () => {
    expect(hhmm(0)).toBe('0000');
    expect(hhmm(75)).toBe('0115');
    expect(hhmm(240)).toBe('0400');
    expect(hhmm(59.6)).toBe('0100');
    expect(hhmm(null)).toBe(MISSING);
    expect(hhmm(NaN)).toBe(MISSING);
    expect(hhmm(-5)).toBe(MISSING);
    expect(eobtField('08:05')).toBe('0805');
    expect(eobtField('8:05')).toBe('0805');
    expect(eobtField('0805')).toBe('0805');
    expect(eobtField('')).toBe(MISSING);
    expect(eobtField('24:00')).toBe(MISSING);
  });

  test('DOF/ YYMMDD', () => {
    expect(dofField('2026-11-20')).toBe('261120');
    expect(dofField('2030-01-05')).toBe('300105');
    expect(dofField('2026-02-30')).toBe('');
    expect(dofField('')).toBe('');
  });

  test('item 15 speed: N + 4 digits', () => {
    expect(speedField(92)).toBe('N0092');
    expect(speedField(105.4)).toBe('N0105');
    expect(speedField(0)).toBe('N' + MISSING);
    expect(speedField(NaN)).toBe('N' + MISSING);
  });

  test('location indicators: ICAO or ZZZZ', () => {
    expect(locationField(ad('LGAV'))).toBe('LGAV');
    expect(locationField({ icao: null, name: 'KALAMATA-TRIODHON', lat: 37, lon: 22 })).toBe('ZZZZ');
    expect(locationField({ icao: 'lgmg', name: '', lat: 0, lon: 0 })).toBe('LGMG');
    expect(locationField(null)).toBe(MISSING);
  });

  test('route: point names as EuroFPL takes them, endpoints left out, duplicates merged', () => {
    const r = base().route;
    expect(routeField(r)).toBe('OROPOS ZOFRI');
    expect(routeField([r[0], r[3]])).toBe('DCT');
    expect(routeField([r[0], r[1], { ...r[1] }, r[3]])).toBe('OROPOS');
    // unnamed (auto-named) points as coordinates; aerodromes en route by ICAO; names made one word
    expect(routeElement({ name: 'WP3', lat: 38.0333, lon: 23.7833, kind: 'custom' })).toBe('3802N02347E');
    expect(routeElement({ name: '', lat: 38.0333, lon: 23.7833, kind: 'custom' })).toBe('3802N02347E');
    expect(routeElement({ name: 'Megara', lat: 37.98, lon: 23.37, kind: 'aerodrome', icao: 'LGMG' })).toBe('LGMG');
    expect(routeElement({ name: 'Farm strip', lat: 37.98, lon: 23.37, kind: 'aerodrome', icao: null })).toBe(
      '3759N02322E',
    );
    expect(routeElement({ name: 'AGIOS GEORGIOS', lat: 37.49, lon: 23.9, kind: 'vfr' })).toBe('AGIOSGEORGIOS');
    expect(routeElement({ name: 'ELEFSINA (LGEL)', lat: 38.06, lon: 23.55, kind: 'vfr' })).toBe('ELEFSINA');
    expect(routeElement({ name: 'Χολαργός', lat: 38, lon: 23.8, kind: 'waypoint' })).toBe('CHOLARGOS');
    expect(routeElement({ name: '123', lat: 38.0333, lon: 23.7833, kind: 'custom' })).toBe('3802N02347E');
  });

  test('C/: surname, initial, phone with the country code apart', () => {
    expect(picName('Dionysis Zindros')).toBe('ZINDROS D');
    expect(picName('Διονύσης Ζήνδρος')).toBe('ZINDROS D');
    expect(picName('Cher')).toBe('CHER');
    expect(picName('')).toBe('');
    expect(intlPhone('+30 694 246 2092')).toBe('+30 6942462092');
    expect(intlPhone('0030 6942462092')).toBe('+30 6942462092');
    expect(intlPhone('6942462092')).toBe('+30 6942462092');
    expect(intlPhone('210 816 9910')).toBe('+30 2108169910');
    expect(intlPhone('+44 20 7946 0000')).toBe('+44 2079460000');
    expect(intlPhone('+1 212 555 0100')).toBe('+1 2125550100');
    expect(intlPhone('+357 99 123456')).toBe('+357 99123456');
    expect(intlPhone('12345')).toBe('12345');
    expect(intlPhone('')).toBe('');
  });

  test('free text: Greek transliterated, separators removed', () => {
    expect(transliterate('Διονύσης Ζήνδρος')).toBe('DIONYSIS ZINDROS');
    expect(transliterate('Θεσσαλονίκη')).toBe('THESSALONIKI');
    expect(transliterate('Πούλιος')).toBe('POULIOS');
    expect(cleanText('white/blue - stripes (red)')).toBe('WHITE BLUE STRIPES RED');
    expect(cleanText('  a\tb\nc  ')).toBe('A B C');
    expect(cleanText('Ünïcode')).toBe('UNICODE');
    expect(cleanPhone('+30 694 000-0000')).toBe('00306940000000');
    expect(cleanPhone('210 123 4567')).toBe('2101234567');
    expect(cleanPhone('')).toBe('');
  });

  test('item 18 parsing of hangar extras', () => {
    expect(parseItem18('NAV/GNSS COM/8.33 RMK/HELLO')).toEqual([
      { indicator: 'NAV', text: 'GNSS' },
      { indicator: 'COM', text: '8.33' },
      { indicator: 'RMK', text: 'HELLO' },
    ]);
    expect(parseItem18('just a note')).toEqual([{ indicator: 'RMK', text: 'JUST A NOTE' }]);
    expect(parseItem18('0')).toEqual([]);
    expect(parseItem18('')).toEqual([]);
  });

  test('wrapping at 69 characters at spaces', () => {
    const words = Array.from({ length: 40 }, (_, i) => `W${i}XYZ`).join(' ');
    const lines = wrapLine(words);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(AFTN_LINE);
    expect(lines.join(' ')).toBe(words);
  });
});

describe('the message', () => {
  test('a local VFR flight, every field', () => {
    const r = buildFpl(base());
    expect(r.lines).toEqual([
      '(FPL-SXASV-VG',
      '-C172/L-S/C',
      '-LGTT0805',
      '-N0092VFR OROPOS ZOFRI',
      '-LGTT0115',
      '-DOF/261120',
      '-E/0400 P/002 R/E A/WHITE BLUE STRIPES C/ZINDROS D +30 6940000000)',
    ]);
    expect(r.complete).toBe(true);
    expect(r.fields.item19.text).toBe('E/0400 P/002 R/E A/WHITE BLUE STRIPES C/ZINDROS D +30 6940000000');
    expect(r.warnings).toEqual([]);
    expect(r.fields.item19.radio).toEqual({ uhf: false, vhf: false, elt: true });
  });

  test('every line fits AFTN, each field starts with a hyphen, parentheses balanced', () => {
    const long = buildFpl(
      base({
        remarks: 'A '.repeat(80),
        route: [
          ...base().route.slice(0, 1),
          ...Array.from({ length: 12 }, (_, i) => ({
            name: `P${i}`,
            lat: 38 + i / 10,
            lon: 23 + i / 10,
            kind: 'custom' as const,
          })),
          base().route[3],
        ],
      }),
    );
    for (const l of long.lines) expect(l.length).toBeLessThanOrEqual(AFTN_LINE);
    expect(long.message.startsWith('(FPL-')).toBe(true);
    expect(long.message.endsWith(')')).toBe(true);
    expect(long.message.split('(').length - 1).toBe(1);
    expect(long.message.split(')').length - 1).toBe(1);
    // one line form: fields joined by hyphens with no space before them
    const one = oneLine(long);
    expect(one).toMatch(/^\(FPL-SXASV-VG-C172\/L-S\/C-LGTT0805-N0092VFR P0 P1 /);
    expect(one).not.toMatch(/\n/);
  });

  test('alternates, ZZZZ endpoints and ALTN/', () => {
    const r = buildFpl(
      base({
        destination: ad('LGSR'),
        alternates: [ad('LGAV'), { icao: null, name: 'Megara', lat: 37.98, lon: 23.37 }],
      }),
    );
    expect(r.lines[4]).toBe('-LGSR0115 LGAV ZZZZ');
    expect(r.fields.item18).toContain('ALTN/MEGARA 3759N02322E');
    const z = buildFpl(base({ departure: { icao: null, name: 'Kalamata-Triodhon', lat: 37.0667, lon: 22.0167 } }));
    expect(z.fields.item13.adep).toBe('ZZZZ');
    expect(z.fields.item18).toMatch(/^DEP\/KALAMATA TRIODHON 3704N02201E DOF\/261120/);
    const three = buildFpl(base({ alternates: [ad('LGAV'), ad('LGMG'), ad('LGEL')] }));
    expect(three.fields.item16.altn2).toBe('LGMG');
    expect(three.warnings.some((w) => /two alternates/.test(w))).toBe(true);
  });

  test('item 18 order and hangar extras merge (Doc 4444 order, DOF/ last as EuroFPL)', () => {
    const r = buildFpl(
      base({
        operator: 'Aeroclub Mesogeion',
        remarks: 'Training flight',
        equipment: {
          ...EQ,
          item10a: 'SDFGRY',
          pbn: 'B2',
          item18Extras: 'COM/8.33 RMK/CLUB AIRCRAFT NAV/GNSS DOF/991231 STS/SAR',
        },
      }),
    );
    const inds = r.fields.item18Parts.map((p) => p.indicator);
    expect(inds).toEqual(['STS', 'PBN', 'NAV', 'COM', 'OPR', 'RMK', 'DOF']);
    expect(r.fields.item18).toContain('DOF/261120');
    expect(r.fields.item18).not.toContain('991231');
    expect(r.fields.item18).toContain('RMK/TRAINING FLIGHT CLUB AIRCRAFT DOF/');
    expect(r.fields.item18).not.toMatch(/VFR VIA|PIC TEL/);
    expect(r.warnings.some((w) => /DOF\/ from the hangar/.test(w))).toBe(true);
    expect(r.fixes[r.warnings.find((w) => /DOF\/ from the hangar/.test(w))!]).toEqual({
      kind: 'aircraft',
      focus: 'item18Extras',
    });
  });

  test("the pilot's EuroFPL reference plan for SX-ASG", () => {
    const tt = ad('LGTT');
    const r = buildFpl(
      base({
        registration: 'SX-ASG',
        operator: 'Aeroclub Mesogeion',
        colours: 'White with black/red stripes',
        date: '2026-11-16',
        eobt: '07:00',
        alternates: [ad('LGMG')],
        route: [
          { name: 'LGTT', lat: tt.lat, lon: tt.lon, kind: 'aerodrome', icao: 'LGTT' },
          { name: 'HOLARGOS', lat: 38.0, lon: 23.8, kind: 'vfr' },
          { name: 'HELLINIKON', lat: 37.9, lon: 23.73, kind: 'vfr' },
          { name: 'LGTT', lat: tt.lat, lon: tt.lon, kind: 'aerodrome', icao: 'LGTT' },
        ],
        cruiseTasKt: 100,
        totalEetMin: 60,
        enduranceMin: 120,
        pic: { fullName: 'Dionysis Zindros', phone: '+30 694 246 2092' },
        equipment: {
          ...EQ,
          item10a: 'SBDFGRY',
          item10b: 'EB1',
          pbn: 'B2C2D2O2S1',
          item18Extras: 'NAV/SBAS RMK/GARMIN GNS430W',
          jackets: { present: true, light: true, fluorescein: true, uhf: false, vhf: false },
          remarks: 'OPR TEL +302108169910 +306974776230',
        },
      }),
    );
    expect(oneLine(r)).toBe(
      '(FPL-SXASG-VG-C172/L-SBDFGRY/EB1-LGTT0700-N0100VFR HOLARGOS HELLINIKON-LGTT0100 LGMG' +
        '-PBN/B2C2D2O2S1 NAV/SBAS OPR/AEROCLUB MESOGEION RMK/GARMIN GNS430W DOF/261116' +
        '-E/0200 P/002 R/E J/LF A/WHITE WITH BLACK RED STRIPES N/OPR TEL +302108169910 +306974776230 C/ZINDROS D +30 6942462092)',
    );
    for (const l of r.lines) expect(l.length).toBeLessThanOrEqual(AFTN_LINE);
  });

  test('every warning says where it is fixed', () => {
    const r = buildFpl(
      base({
        eobt: '',
        icaoType: '',
        colours: '',
        pic: { fullName: '', phone: '' },
        enduranceMin: null,
        personsOnBoard: null,
        date: '',
      }),
    );
    for (const w of r.warnings) expect(r.fixes[w], w).toBeTruthy();
    expect(r.fixes['Block-off time (EOBT) not set (item 13).']).toEqual({ kind: 'flight', focus: 'blockOff' });
  });

  test('equipment rules: R needs PBN/, Z needs NAV/COM/DAT, N alone', () => {
    expect(buildFpl(base({ equipment: { ...EQ, item10a: 'SR' } })).warnings.some((w) => /PBN/.test(w))).toBe(true);
    expect(buildFpl(base({ equipment: { ...EQ, item10a: 'SZ' } })).warnings.some((w) => /Z: NAV/.test(w))).toBe(true);
    expect(
      buildFpl(base({ equipment: { ...EQ, item10a: 'SZ', item18Extras: 'COM/8.33' } })).warnings.some((w) =>
        /Z: NAV/.test(w),
      ),
    ).toBe(false);
    expect(
      buildFpl(base({ equipment: { ...EQ, item10a: 'NS' } })).warnings.some((w) => /N \(no equipment\)/.test(w)),
    ).toBe(true);
    const none = buildFpl(base({ equipment: { ...EQ, item10a: '', item10b: '' } }));
    expect(none.fields.item10).toEqual({ a: 'N', b: 'N' });
  });

  test('missing type designator: ZZZZ + TYP/', () => {
    const r = buildFpl(base({ icaoType: '', makeModel: 'Homebuilt Pou-du-Ciel' }));
    expect(r.fields.item9.type).toBe('ZZZZ');
    expect(r.fields.item18).toContain('TYP/HOMEBUILT POU DU CIEL');
  });

  test('item 19: survival, jackets, dinghies, remarks', () => {
    const r = buildFpl(
      base({
        personsOnBoard: 4,
        enduranceMin: 293,
        equipment: {
          ...EQ,
          emergencyRadio: { uhf: false, vhf: true, elt: true },
          survival: { polar: false, desert: false, maritime: true, jungle: false },
          jackets: { present: true, light: true, fluorescein: false, uhf: false, vhf: false },
          dinghies: { number: 1, capacity: 4, covered: true, colour: 'orange' },
          remarks: 'fire extinguisher',
        },
      }),
    );
    expect(r.fields.item19.text).toBe(
      'E/0453 P/004 R/VE S/M J/L D/01 004 C ORANGE A/WHITE BLUE STRIPES N/FIRE EXTINGUISHER C/ZINDROS D +30 6940000000',
    );
    expect(r.fields.item18).not.toContain('TEL');
    const jk = buildFpl(
      base({
        equipment: { ...EQ, jackets: { present: true, light: false, fluorescein: false, uhf: false, vhf: false } },
      }),
    );
    expect(jk.fields.item19.text).not.toContain('J/');
    expect(jk.fields.item19.text).toContain('N/LIFE JACKETS');
  });

  test('item 19 is in the message by default; without it the PIC phone goes to RMK/', () => {
    const r = buildFpl(base());
    expect(r.lines[r.lines.length - 1]).toBe('-E/0400 P/002 R/E A/WHITE BLUE STRIPES C/ZINDROS D +30 6940000000)');
    const no19 = buildFpl(base({ options: { includeItem19: false } }));
    expect(no19.message).not.toContain('E/');
    expect(no19.lines[no19.lines.length - 1]).toBe('-RMK/PIC TEL 00306940000000 DOF/261120)');
  });

  test('REG/ only on request: it would repeat the item 7 registration', () => {
    expect(buildFpl(base()).fields.item18).not.toContain('REG/');
    expect(buildFpl(base({ options: { regInItem18: true } })).fields.item18).toBe('REG/SXASV DOF/261120');
  });

  test('missing data is visible as ???? and warned', () => {
    const r = buildFpl(
      base({
        eobt: '',
        totalEetMin: null,
        enduranceMin: null,
        personsOnBoard: null,
        colours: '',
        pic: { fullName: '', phone: '' },
        date: '',
      }),
    );
    expect(r.complete).toBe(false);
    expect(r.fields.item13.eobt).toBe(MISSING);
    expect(r.fields.item16.eet).toBe(MISSING);
    expect(r.fields.item19.text).toBe('E/???? P/TBN R/E C/????');
    expect(r.fixes['Pilot phone number not set in the profile (item 19 C/).']).toEqual({
      kind: 'profile',
      focus: 'phone',
    });
    expect(r.fields.item18).not.toContain('DOF/');
    expect(r.warnings.length).toBeGreaterThanOrEqual(6);
  });
});

// ------------------------------------------------------------------------------------------------
// From the app's records

const rp = (kind: 'aerodrome' | 'vfr', id: string): RoutePoint => {
  if (kind === 'aerodrome') {
    const a = aerodrome(id)!;
    return { uid: 'u' + id, kind, refId: a.id, name: a.icao ?? a.id, lat: a.lat, lon: a.lon };
  }
  const p = vfrPoint(id)!;
  return { uid: 'u' + id, kind, refId: id, name: p.name, lat: p.lat, lon: p.lon };
};

describe('fplInputFrom (flight + hangar + profile + navlog + fuel)', () => {
  const route = [
    rp('aerodrome', 'LGTT'),
    rp('vfr', 'LGAV/DAPORI'),
    rp('vfr', 'LGAV/KORINTHOS'),
    rp('aerodrome', 'LGMG'),
  ];
  const doc = emptyFlightDoc('2026-11-20');
  const flight: Flight = {
    ...doc,
    id: 'f1',
    version: 1,
    created: 0,
    updated: 0,
    opened: 0,
    deleted: false,
    blockOff: '09:00',
    taxiOutMin: 15,
    taxiInMin: 15,
    route,
    crew: [
      {
        role: 'PIC',
        passengerId: null,
        seat: 'front-left',
        snapshot: {
          fullName: 'Snap Name',
          phone: '210',
          dateOfBirth: null,
          weightKg: 80,
          idNumber: '',
          idType: '',
          nationality: '',
          relation: '',
        },
      },
      {
        role: 'PAX',
        passengerId: 'p1',
        seat: 'front-right',
        snapshot: {
          fullName: 'Pax',
          phone: '',
          dateOfBirth: null,
          weightKg: 70,
          idNumber: '',
          idType: '',
          nationality: '',
          relation: '',
        },
      },
    ],
    options: { ...doc.options, alternates: ['LGAV'] },
  };
  const aircraft = {
    registration: 'SX-ASV',
    makeModel: 'Reims/Cessna F172M',
    icaoType: 'C172',
    wake: 'L',
    operator: 'Aeroclub Mesogeion',
    colours: 'WHITE',
    cruiseTasKt: 92,
    patternTasKt: 80,
    equipment: EQ,
    compassCards: [],
    fuel: { burnLph: 30, taxiAllowanceL: 4, usableL: 144 },
  } as unknown as Aircraft;
  const legs = buildLegs(route, flight.date);
  const alts = defaultAltitudes(route, {
    aerodromes: REF.aerodromes,
    vfrPoints: REF.vfrPoints,
    vfrRoutes: REF.vfrRoutes,
  }).map((d) => d.altFt);
  const navlog = computeNavlog({
    date: flight.date,
    blockOff: flight.blockOff,
    taxiOutMin: 15,
    taxiInMin: 15,
    legs,
    altitudesFt: alts,
    overrides: [],
    aircraft: navlogAircraft(aircraft),
    winds: () => ({ dirDeg: 360, speedKt: 10, tempC: 10 }),
  });
  const fuel = planFuel({
    tripFuelL: navlog.totals.tripFuel,
    taxiAllowanceL: 4,
    burnLph: 30,
    finalReserveMin: 0,
    reserveMin: 60,
    fobL: null,
    usableL: 144,
    tripMin: navlog.flightMin,
  });

  test('items from the records', () => {
    const input = fplInputFrom({ flight, aircraft, pilot: { fullName: 'Dionysis Zindros', phone: '' }, navlog, fuel });
    const r = buildFpl(input);
    expect(r.fields.item7).toBe('SXASV');
    expect(r.fields.item13).toEqual({ adep: 'LGTT', eobt: '0900' });
    expect(r.fields.item16.ades).toBe('LGMG');
    expect(r.fields.item16.altn1).toBe('LGAV');
    expect(r.fields.item16.eet).toBe(hhmm(navlog.totals.ete));
    expect(totalEetMin(navlog)).toBe(navlog.totals.ete);
    expect(r.fields.item15.route).toBe('DAPORI KORINTHOS');
    expect(r.fields.item19.persons).toBe('002');
    // endurance = FOB (required + 60 min reserve) at 30 L/h, whole minutes down
    expect(fuel.fobL).toBe(4 + navlog.totals.tripFuel + 30);
    expect(r.fields.item19.endurance).toBe(hhmm(Math.floor((fuel.fobL / 30) * 60 + 1e-9)));
    // the profile name wins, the phone falls back to the PIC snapshot
    expect(r.fields.item19.pic).toBe('ZINDROS D 210');
    expect(r.fields.item18).not.toContain('RMK/');
    expect(r.fields.item18).toContain('OPR/AEROCLUB MESOGEION');
    expect(r.complete).toBe(true);
  });

  test('no aircraft: visibly incomplete', () => {
    const r = buildFpl(
      fplInputFrom({
        flight: { ...flight, aircraftId: null },
        aircraft: null,
        pilot: { fullName: 'X', phone: '1' },
        navlog: null,
        fuel: null,
      }),
    );
    expect(r.complete).toBe(false);
    expect(r.fields.item7).toBe(MISSING);
    expect(r.fields.item16.eet).toBe(MISSING);
  });

  test('alternates by ICAO; unknown text kept', () => {
    expect(alternateOf('lgav')?.icao).toBe('LGAV');
    expect(alternateOf('ABCD')).toMatchObject({ icao: 'ABCD' });
    expect(alternateOf('')).toBeNull();
  });
});
