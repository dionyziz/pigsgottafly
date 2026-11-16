// Aerodrome operational hours (AIP AD 2.3 / AD 1.6.N.3–4): the extraction from the eAIP text, the parser
// over EVERY aerodrome's real text (tools/ad_hours.json, as printed), and the evaluation at an instant
// (H24, HJ by sunrise/sunset, seasons, weekdays, Greek public holidays, footnotes, closures in remarks).
import fs from 'node:fs';

import { describe, expect, test } from 'vitest';

import {
  adHoursFromAip,
  type AipHoursText,
  greekHolidays,
  hoursAt,
  isSummerTime,
  normalizeAipText,
  orthodoxEaster,
  parseHours,
  parseSchedule,
  sunTimes,
} from '../../../src/calc/adHours';
import { aerodrome, AERODROMES, SUN_TABLES } from '../../../src/data/ref';
import { extractAd2, extractAd16 } from '../../../tools/extract_ad_hours';

const RAW = JSON.parse(fs.readFileSync('tools/ad_hours.json', 'utf8')) as Record<
  string,
  AipHoursText & { amdt: string | null }
>;
const PAGES = JSON.parse(fs.readFileSync('tests/fixtures/aip-ad-hours-pages.json', 'utf8')) as Record<string, string>;
const ms = (iso: string) => Date.parse(iso);
const ad = (id: string) => aerodrome(id)!;
const at = (id: string, field: 'ad' | 'ats' | 'handling', iso: string) => {
  const a = ad(id);
  const ctx = {
    lat: a.lat,
    lon: a.lon,
    sunTables: SUN_TABLES,
    ad: (t: number) => hoursAt(a.hours!.ad.parsed, t, { lat: a.lat, lon: a.lon, sunTables: SUN_TABLES }),
  };
  const f = field === 'ad' ? a.hours!.ad : field === 'ats' ? a.hours!.ats! : a.hours!.handling;
  return hoursAt(f.parsed, ms(iso), ctx);
};

/**
 * Every aerodrome: [AD hours, ATS, handling, customs] as parsed ('!' = partial: shown as the AIP text and
 * evaluated as unknown). Reviewed against the AIP text of AIRAC 09/26 (tools/ad_hours.json).
 */
const EXPECTED: Record<string, [string, string | null, string, string | null]> = {
  'KALAMATA-TRIODHON': ['HX', 'NIL', 'NIL', null],
  LGTL: ['HJ', 'HJ', 'NIL', null],
  LGKM: ['HO', 'NIL', 'AD hours', 'NIL'],
  'KILKIS-NEA-KAVALA-POLYKASTRO': ['HX', 'NIL', 'NIL', null],
  LGLR: ['HJ', 'HJ', 'NIL', null],
  'LARISSA-TERPSITHEA': ['HX', 'NIL', 'NIL', null],
  LGKN: ['H24', 'HJ', 'NIL', null],
  LGMG: ['HO', null, 'NIL', null],
  MESSOLOGI: ['HX', 'NIL', 'NIL', null],
  LGSD: ['HX', 'HX', 'NIL', null],
  LGSV: ['HJ', 'HJ', 'NIL', null],
  'KOPAIDA-DIMITRA': ['HX', 'NIL', 'NIL', null],
  'KOPAIDA-IKAROS': ['HX', 'NIL', 'NIL', null],
  TIMBAKION: ['HX', 'HX', 'NIL', null],
  LGTP: ['DAILY SR-1200', 'DAILY SR-1200', 'NIL', null],
  'XANTHI-NEOS-ZYGOS': ['HX', 'NIL', 'NIL', null],
  LGRD: ['HJ', 'NIL', 'NIL', null],
  LGTG: ['HJ', 'HJ', 'NIL', 'NIL'],
  'AGRINION-AEROCLUB': ['HX', 'NIL', 'NIL', null],
  'PTOLEMAIDA-OLYMPIADA': ['HX', 'NIL', 'NIL', null],
  'THIVA-PERNERI': ['HX', 'NIL', 'NIL', null],
  'LARISSA-FLABOURO': ['SAT SUN HOL HX', 'NIL', 'NIL', null],
  'SERRES-HORTERO': ['HX', 'NIL', 'NIL', null],
  KOLCHIKO: ['MON-SAT 1000-1700', 'NIL', 'NIL', null],
  'KARDITSA-MYRINI': ['NIL (no published hours)', 'NIL', 'NIL', null],
  'MEGARA-DOUNIS': ['NIL (no published hours)', 'NIL', 'NIL', null],
  'IGOUMENITSA-MARGARITI': ['NIL (no published hours)', 'NIL', 'NIL', null],
  'CHALKIDIKI-NEA-SYLLATA': ['NIL (no published hours)', 'NIL', 'NIL', null],
  'SERRES-EMMANOUIL-PAPPAS': ['NIL (no published hours)', 'NIL', 'NIL', null],
  LGAX: ['HS', 'HS', 'NIL', null],
  'PIERIA-KONTARIOTISA': ['SAT SUN HOL HX', 'NIL', 'NIL', null],
  'ZALOGO-PREVEZA': ['NIL (no published hours)', 'NIL', 'NIL', null],
  'KERKIRA-KERKIRA-PORT': ['NIL (no published hours)', 'NIL', 'NIL', null],
  'PAXOI-GAIOS-PORT': ['NIL (no published hours)', 'NIL', 'NIL', null],
  'CHALKIDIKI-NEA-KALLIKRATEIA': ['HX', 'NIL', 'NIL', null],
  LGTT: ['31 DEC: CLSD, 1 JAN: CLSD, HJ', 'HJ', 'NIL', null],
  'EDESSA-ARNISSA': ['HX', 'NIL', 'NIL', null],
  EPITALIO: ['NIL (no published hours)', 'NIL', 'NIL', null],
  FLORINA: ['HX', 'NIL', 'NIL', null],
  LGAD: ['HO', 'HJ', 'Summer: AD hours', 'AD hours'],
  LGAL: ['HO', 'AD hours', 'AD hours', 'O/R'],
  LGAV: ['H24', 'H24', 'H24', 'H24'],
  LGBL: ['HO', 'HJ', 'AD hours', 'AD hours'],
  LGEL: ['HJ', 'HJ', 'HJ', 'HJ'],
  LGHI: ['HO', 'AD hours', 'AD hours', 'AD hours'],
  LGIK: ['HO', 'AD hours', 'NIL', 'NIL'],
  LGIO: ['HO', 'AD hours', 'AD hours', 'AD hours'],
  LGIR: ['H24', 'H24', 'H24', 'H24'],
  LGKA: ['HO', 'AD hours', 'AD hours', 'NIL'],
  LGKC: ['HO', 'AD hours', 'AD hours', 'AD hours'],
  LGKF: ['HO', 'AD hours', 'AD hours', 'AD hours'],
  LGKJ: ['HO', 'AD hours', 'NIL', 'NIL'],
  LGKL: ['HO', 'HJ', 'AD hours', 'AD hours'],
  LGKO: ['H24', 'H24', 'H24', 'H24'],
  LGKP: ['HO', 'AD hours', 'AD hours', 'AD hours'],
  LGKR: ['H24', 'H24', 'H24', 'H24'],
  LGKS: ['HO', 'AD hours', 'NIL', 'NIL'],
  LGKV: ['HO', 'AD hours', 'AD hours', 'AD hours'],
  LGKY: ['HO', 'AD hours', 'AD hours', 'NIL'],
  LGKZ: ['HO', 'AD hours', 'AD hours', 'NIL'],
  LGLE: ['HO', 'AD hours', 'AD hours', 'NIL'],
  LGLM: ['HO', 'AD hours', 'AD hours', 'AD hours'],
  LGMK: ['HO', 'AD hours', 'AD hours', '!See AIP text'],
  LGML: ['HO', 'AD hours', 'AD hours', 'NIL'],
  LGMT: ['HO', 'AD hours', 'AD hours', 'AD hours'],
  LGNX: ['HO', 'AD hours', 'AD hours', 'NIL'],
  LGPA: ['HO', 'AD hours', 'AD hours', 'NIL'],
  LGPL: ['HO', 'AD hours', 'AD hours', 'NIL'],
  LGPZ: ['HO', 'Winter: HJ, Summer: AD hours', 'AD hours', 'AD hours'],
  LGRP: ['H24', 'H24', 'H24', 'H24'],
  LGRX: ['HO', 'HJ', 'AD hours', 'AD hours'],
  LGSA: ['H24', 'H24', 'H24', 'H24'],
  LGSK: ['HO', 'AD hours', 'AD hours', 'AD hours'],
  LGSM: ['HO', 'AD hours', 'AD hours', 'AD hours'],
  LGSO: ['HO', 'AD hours', 'AD hours', 'AD hours'],
  LGSR: ['HO', 'AD hours', 'AD hours', 'AD hours'],
  LGST: ['HO', 'AD hours', 'AD hours', 'AD hours'],
  LGSY: ['HO', 'HJ', 'NIL', 'NIL'],
  LGTS: ['H24', 'H24', 'H24', 'H24'],
  LGZA: ['HO', 'AD hours', 'AD hours', 'AD hours'],
};

describe('extraction from the eAIP text (pdftotext -layout)', () => {
  test('AD 2.3: items by label, continuation lines, page furniture dropped across a page break', () => {
    const r = extractAd2('LGEL', PAGES.LGEL)!;
    expect(r.source).toBe('LGEL AD 2.3');
    expect(r.ad).toBe('HJ (HAF)');
    expect(r.ats).toBe('HJ (HAF)');
    expect(r.handling).toBe('HJ');
    expect(r.customs).toBe('HJ');
    expect(r.amdt).toBe('AIRAC AMDT 01/25');
    expect(r.remarks!.split('\n')[0]).toBe('During night 10 min PN');
    // the remarks continue on the next page: the footer/header lines between are not part of them
    expect(r.remarks).toContain('2. All requests should be submitted during working hours from');
    expect(r.remarks).not.toMatch(/HELLENIC AVIATION|GREECE|AD 2 LGEL-2/);
  });
  test('AD 1.6: the hours table and, without a handling item, the handling section', () => {
    const r = extractAd16(29, PAGES.LGTG)!;
    expect(r).toMatchObject({
      source: 'AD 1.6.29.3',
      ad: 'HJ (HAF)',
      ats: 'HJ (HAF)',
      customs: 'NIL',
      remarks: 'During night O/R RWY 28C only.',
      handlingSource: 'AD 1.6.29.4',
      handlingFromSection: true,
    });
    expect(r.handling).toMatch(/^1 {2}Cargo-handling facilities {2}NIL\./);
    expect(r.handling).toContain('For military use only.');
  });
  test('the extracted texts are verbatim (Greek letters kept) and cover every aerodrome', () => {
    expect(Object.keys(RAW).sort()).toEqual(AERODROMES.map((a) => a.id).sort());
    expect(RAW.LGIR.handling).toBe('Η24'); // Greek capital Eta, as printed
    expect(RAW.LGAD.handling).toBe('During summer only, on AD operating hours.');
  });
});

describe('the parser over every aerodrome', () => {
  test('the reference data carries the AIP text verbatim and its parse', () => {
    for (const a of AERODROMES) {
      expect(a.hours, a.id).toBeTruthy();
      expect(a.hours, a.id).toEqual(adHoursFromAip(RAW[a.id]));
      expect(a.hours!.ad.text).toBe(RAW[a.id].ad);
    }
  });
  test('each aerodrome parses to the reviewed schedule', () => {
    const got: Record<string, unknown> = {};
    const l = (f: { parsed: { partial: boolean; label: string } } | null) =>
      f ? (f.parsed.partial ? '!' : '') + f.parsed.label : null;
    for (const a of AERODROMES)
      got[a.id] = [l(a.hours!.ad), l(a.hours!.ats), l(a.hours!.handling), l(a.hours!.customs)];
    expect(got).toEqual(EXPECTED);
  });
  test('only the texts the parser cannot represent are partial (customs of LGMK); no AD, ATS or handling text is', () => {
    const partial = AERODROMES.flatMap((a) =>
      (['ad', 'ats', 'handling', 'customs'] as const)
        .filter((k) => a.hours![k]?.parsed.partial)
        .map((k) => `${a.id} ${k}`),
    );
    expect(partial).toEqual(['LGMK customs']);
  });
  test('alternatives by provider: the civil one is used, the others kept as notes', () => {
    expect(ad('LGAD').hours!.ad.parsed).toMatchObject({ label: 'HO', notes: ['HAF: HJ'] });
    expect(ad('LGKL').hours!.ad.parsed.notes).toEqual(['HASP', 'HAF: HJ']);
    expect(ad('LGSA').hours!.handling.parsed).toMatchObject({ label: 'H24', notes: ['HASP'] });
    expect(ad('LGMG').hours!.ad.parsed.notes).toContain('Hellenic Army: HJ, HO');
  });
  test('footnotes in the remarks: HR* (LGPZ), HX: (LGTP), *= (LGKL); closures (LGTT 31 DEC / 01 JAN)', () => {
    expect(ad('LGPZ').hours!.ats!.parsed.rules).toEqual([
      { season: 'winter', times: [{ t: 'HJ' }] },
      { season: 'summer', times: [{ t: 'AD' }] },
    ]);
    expect(ad('LGPZ').hours!.ats!.parsed.notes).toContain('Rest Hours 30 min prior notice');
    expect(ad('LGTP').hours!.ad.parsed.rules).toEqual([
      { days: [1, 2, 3, 4, 5, 6, 7], times: [{ t: 'window', from: { sun: 'SR', offsetMin: 0 }, to: { utc: 720 } }] },
    ]);
    expect(ad('LGKL').hours!.customs!.parsed.rules).toEqual([{ times: [{ t: 'AD' }] }]);
    expect(ad('LGTT').hours!.ad.parsed.rules.slice(0, 2)).toEqual([
      { season: { from: '12-31', to: '12-31' }, times: [{ t: 'CLSD' }] },
      { season: { from: '01-01', to: '01-01' }, times: [{ t: 'CLSD' }] },
    ]);
  });
  test('Greek capitals are normalised (Η24, ΗΧ, ΜΕΤ)', () => {
    expect(normalizeAipText('Η24')).toBe('H24');
    expect(ad('LGIR').hours!.handling.parsed.label).toBe('H24');
    expect(ad('CHALKIDIKI-NEA-KALLIKRATEIA').hours!.ad.parsed.label).toBe('HX');
  });
});

describe('schedules (AIP and NOTAM item D / E)', () => {
  test('weekday ranges, several windows, closed days', () => {
    expect(parseSchedule('MON-FRI 0500-1700, SAT SUN 0600-1400')).toEqual([
      { days: [1, 2, 3, 4, 5], times: [{ t: 'window', from: { utc: 300 }, to: { utc: 1020 } }] },
      { days: [6, 7], times: [{ t: 'window', from: { utc: 360 }, to: { utc: 840 } }] },
    ]);
    expect(parseSchedule('AD HOURS OF SERVICE: DAILY 0400-1000 1400-2000')).toEqual([
      {
        days: [1, 2, 3, 4, 5, 6, 7],
        times: [
          { t: 'window', from: { utc: 240 }, to: { utc: 600 } },
          { t: 'window', from: { utc: 840 }, to: { utc: 1200 } },
        ],
      },
    ]);
    expect(parseSchedule('MON-FRI EXC HOL 0500-1500 SAT SUN HOL CLSD')).toEqual([
      { days: [1, 2, 3, 4, 5], exceptHolidays: true, times: [{ t: 'window', from: { utc: 300 }, to: { utc: 900 } }] },
      { days: [6, 7], holidays: true, times: [{ t: 'CLSD' }] },
    ]);
    expect(parseSchedule('Monday to Saturday 1000 - 1700')).toEqual([
      { days: [1, 2, 3, 4, 5, 6], times: [{ t: 'window', from: { utc: 600 }, to: { utc: 1020 } }] },
    ]);
  });
  test('summer and winter: bracketed summer times, "summer period -1 HR", season prefixes, date ranges', () => {
    expect(parseSchedule('0600-2200 (0500-2100)')).toEqual([
      { season: 'winter', times: [{ t: 'window', from: { utc: 360 }, to: { utc: 1320 } }] },
      { season: 'summer', times: [{ t: 'window', from: { utc: 300 }, to: { utc: 1260 } }] },
    ]);
    expect(parseSchedule('MON-FRI 0600-1400 (SUMMER PERIOD -1 HR)')).toEqual([
      { season: 'summer', days: [1, 2, 3, 4, 5], times: [{ t: 'window', from: { utc: 300 }, to: { utc: 780 } }] },
      { season: 'winter', days: [1, 2, 3, 4, 5], times: [{ t: 'window', from: { utc: 360 }, to: { utc: 840 } }] },
    ]);
    expect(parseSchedule('SUMMER: H24 WINTER: 0500-1900')).toEqual([
      { season: 'summer', times: [{ t: 'H24' }] },
      { season: 'winter', times: [{ t: 'window', from: { utc: 300 }, to: { utc: 1140 } }] },
    ]);
    expect(parseSchedule('01 MAY - 31 OCT: DAILY 0400-1900')).toEqual([
      {
        season: { from: '05-01', to: '10-31' },
        days: [1, 2, 3, 4, 5, 6, 7],
        times: [{ t: 'window', from: { utc: 240 }, to: { utc: 1140 } }],
      },
    ]);
    expect(parseHours('HO from April to October', 'handling').rules).toEqual([
      { season: { from: '04-01', to: '10-31' }, times: [{ t: 'AD' }] },
    ]);
  });
  test('anything else is not a schedule (never guessed)', () => {
    for (const s of ['AD CLSD DUE TO WIP', 'MAR 01 02 03 0600-1400', 'For scheduled flights: HO', '2500-0100', 'MON-'])
      expect(parseSchedule(s), s).toBeNull();
    expect(parseHours('Available after coordination with the operator', 'ad').partial).toBe(true);
  });
});

describe('evaluation', () => {
  test('H24, HO (hours by NOTAM: unknown), HX, NIL', () => {
    expect(at('LGAV', 'ad', '2026-11-15T03:00:00Z').status).toBe('open');
    expect(at('LGKC', 'ad', '2026-11-15T10:00:00Z')).toEqual({
      status: 'unknown',
      why: 'HO: hours published by NOTAM',
    });
    expect(at('FLORINA', 'ad', '2026-11-15T10:00:00Z').status).toBe('unknown');
    expect(at('MEGARA-DOUNIS', 'ad', '2026-11-15T10:00:00Z').status).toBe('unknown'); // NIL hours: not "closed"
    expect(at('LGTT', 'handling', '2026-11-15T10:00:00Z')).toEqual({ status: 'closed', why: 'NIL' });
  });
  test('HJ: sunrise (NOAA) to sunset (AIP GEN 2.7) at the aerodrome', () => {
    const a = ad('LGTT');
    const s = sunTimes('2026-11-15', { lat: a.lat, lon: a.lon, sunTables: SUN_TABLES });
    expect(s.sr!).toBeGreaterThan(4 * 60 + 30);
    expect(s.sr!).toBeLessThan(5 * 60 + 15);
    expect(s.ss!).toBeGreaterThan(14 * 60 + 40);
    expect(s.ss!).toBeLessThan(15 * 60 + 15);
    const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    expect(at('LGTT', 'ad', `2026-11-15T${hm(s.sr!)}:00Z`).status).toBe('open');
    expect(at('LGTT', 'ad', `2026-11-15T${hm(s.sr! - 1)}:00Z`).status).toBe('closed');
    expect(at('LGTT', 'ad', `2026-11-15T${hm(s.ss! - 1)}:00Z`).status).toBe('open');
    expect(at('LGTT', 'ad', `2026-11-15T${hm(s.ss!)}:00Z`).status).toBe('closed');
    // 31 DEC and 01 JAN: state aircraft only
    expect(at('LGTT', 'ad', '2026-12-31T10:00:00Z').status).toBe('closed');
    expect(at('LGTT', 'ad', '2027-01-01T10:00:00Z').status).toBe('closed');
    expect(at('LGTT', 'ad', '2027-01-02T10:00:00Z').status).toBe('open');
  });
  test('weekdays and public holidays', () => {
    expect(at('KOLCHIKO', 'ad', '2026-11-14T12:00:00Z').status).toBe('open'); // Saturday
    expect(at('KOLCHIKO', 'ad', '2026-11-15T12:00:00Z').status).toBe('closed'); // Sunday
    expect(at('KOLCHIKO', 'ad', '2026-11-16T09:59:00Z').status).toBe('closed');
    expect(at('LARISSA-FLABOURO', 'ad', '2026-11-16T12:00:00Z').status).toBe('closed'); // Monday
    expect(at('LARISSA-FLABOURO', 'ad', '2026-11-15T12:00:00Z').status).toBe('unknown'); // Sunday: open, hours not given
    expect(at('LARISSA-FLABOURO', 'ad', '2026-10-28T12:00:00Z').status).toBe('unknown'); // Wednesday, OXI day (holiday)
  });
  test('seasons: LGAD handling in summer only; LGPZ ATS HJ in winter', () => {
    expect(isSummerTime(ms('2026-07-01T12:00:00Z'))).toBe(true);
    expect(isSummerTime(ms('2026-10-25T00:59:00Z'))).toBe(true);
    expect(isSummerTime(ms('2026-10-25T01:00:00Z'))).toBe(false);
    expect(isSummerTime(ms('2026-03-29T01:00:00Z'))).toBe(true);
    expect(at('LGAD', 'handling', '2026-11-15T10:00:00Z').status).toBe('closed');
    // a service during the AD hours is available while the aerodrome is not known to be closed (HO: by NOTAM)
    expect(at('LGAD', 'handling', '2026-07-15T10:00:00Z')).toEqual({
      status: 'open',
      why: 'during the aerodrome hours',
    });
    expect(at('LGPZ', 'ats', '2026-11-15T10:00:00Z').status).toBe('open');
    expect(at('LGPZ', 'ats', '2026-11-15T20:00:00Z').status).toBe('closed');
  });
  test('a partial spec is unknown, never guessed', () => {
    const a = ad('LGMK');
    expect(hoursAt(a.hours!.customs!.parsed, ms('2026-11-15T10:00:00Z'), { lat: a.lat, lon: a.lon })).toEqual({
      status: 'unknown',
      why: 'see the AIP text',
    });
  });
  test('windows past midnight', () => {
    const r = parseHours('DAILY 2100-0400', 'ad');
    const ctx = { lat: 38, lon: 23.7 };
    expect(hoursAt(r, ms('2026-11-15T22:00:00Z'), ctx).status).toBe('open');
    expect(hoursAt(r, ms('2026-11-16T03:59:00Z'), ctx).status).toBe('open');
    expect(hoursAt(r, ms('2026-11-16T04:00:00Z'), ctx).status).toBe('closed');
  });
  test('Greek public holidays (Orthodox Easter)', () => {
    expect(new Date(orthodoxEaster(2025)).toISOString().slice(0, 10)).toBe('2025-04-20');
    expect(new Date(orthodoxEaster(2026)).toISOString().slice(0, 10)).toBe('2026-04-12');
    expect(new Date(orthodoxEaster(2027)).toISOString().slice(0, 10)).toBe('2027-05-02');
    const h = greekHolidays(2026);
    for (const d of [
      '2026-01-01',
      '2026-01-06',
      '2026-02-23',
      '2026-03-25',
      '2026-04-10',
      '2026-04-13',
      '2026-05-01',
      '2026-06-01',
      '2026-08-15',
      '2026-10-28',
      '2026-12-25',
      '2026-12-26',
    ])
      expect(h.has(d), d).toBe(true);
    expect(h.has('2026-11-15')).toBe(false);
  });
});
