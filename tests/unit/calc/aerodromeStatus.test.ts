// Effective aerodrome hours: the AIP overlaid with NOTAM fixtures (AD hours, closures, handling, ATS),
// the status over a time window, the day's hours for display, and who sends the General Declaration.
// Everything must also work with no NOTAMs at all (the NOTAM source may not be configured).
import { describe, expect, test } from 'vitest';
import type { Notam } from '../../../src/shared/briefing';
import { SUN_TABLES, aerodrome } from '../../../src/data/ref';
import {
  aerodromeDay, aerodromeNotamEffects, aerodromeStatus, aerodromeStatusAt, genDecHandling, type HandlingEndInput,
} from '../../../src/calc/aerodromeStatus';

const ms = (iso: string) => Date.parse(iso);
const ad = (id: string) => aerodrome(id)!;
let n = 0;
function notam(o: Partial<Notam> & Pick<Notam, 'itemA' | 'qcode' | 'text'>): Notam {
  n++;
  return {
    key: `A${String(1000 + n)}/26`, type: 'N', refers: null, fir: 'LGGG', subject: null, condition: null, traffic: 'IV', purpose: 'NBO', scope: 'A',
    lowerFt: 0, upperFt: 99900, center: null, radiusNm: null, from: ms('2026-10-25T00:00:00Z'), to: ms('2027-03-28T23:59:00Z'), estimated: false,
    schedule: null, lowerText: null, upperText: null, raw: '', relevant: true, reasons: [], legIndex: null, ...o,
  };
}
const opts = (notams: Notam[]) => ({ effects: aerodromeNotamEffects(notams), sunTables: SUN_TABLES });

describe('NOTAMs that change aerodrome hours', () => {
  const hours = notam({ itemA: ['LGKC'], qcode: 'QFAAH', text: 'AD HOURS OF SERVICE: MON-FRI 0600-1400, SAT SUN CLSD.' });
  const closed = notam({ itemA: ['LGKC'], qcode: 'QFALC', text: 'AD CLSD DUE TO WIP.', schedule: 'DAILY 1000-1100', from: ms('2026-11-16T00:00:00Z'), to: ms('2026-11-20T23:59:00Z') });
  const handling = notam({ itemA: ['LGAV'], qcode: 'QFAXX', text: 'HANDLING SERVICES NOT AVBL FOR GA FLIGHTS.' });
  const twr = notam({ itemA: ['LGKC'], qcode: 'QSFAH', text: 'AFIS HR OF SER: DAILY 0700-1300' });
  const limited = notam({ itemA: ['LGKC'], qcode: 'QFALT', condition: 'Limited to', text: 'AD LIMITED TO ACFT WITH WINGSPAN LESS THAN 36M.' });
  const unreadable = notam({ itemA: ['LGSR'], qcode: 'QFAAH', text: 'AD OPR HR WILL BE PUBLISHED LATER.' });
  const cancelled = notam({ itemA: ['LGAV'], qcode: 'QFALC', text: 'AD CLSD', type: 'C' });
  const all = [hours, closed, handling, twr, limited, unreadable, cancelled];

  test('classification: AD hours, closures, handling, ATS hours, limits; cancellations and other NOTAMs ignored', () => {
    const e = aerodromeNotamEffects([...all, notam({ itemA: ['LGKC'], qcode: 'QMRLC', text: 'RWY 02/20 CLSD' })]);
    expect(e.map((x) => [x.key, x.icao, x.target, x.effect, x.partial])).toEqual([
      [hours.key, 'LGKC', 'ad', 'hours', false],
      [closed.key, 'LGKC', 'ad', 'closed', false],
      [handling.key, 'LGAV', 'handling', 'closed', false],
      [twr.key, 'LGKC', 'ats', 'hours', false],
      [limited.key, 'LGKC', 'ad', 'limited', false],
      [unreadable.key, 'LGSR', 'ad', 'hours', true],
    ]);
    expect(e[0].summary).toBe('AD hours MON-FRI 0600-1400, SAT SUN CLSD');
  });

  test('QFAAH replaces the HO hours of the AIP (by NOTAM id); outside them the aerodrome is closed', () => {
    const o = opts(all);
    expect(aerodromeStatusAt(ad('LGKC'), 'ad', ms('2026-11-17T08:00:00Z'))).toMatchObject({ status: 'unknown', source: 'AIP LGKC AD 2.3' }); // no NOTAMs: HO
    expect(aerodromeStatusAt(ad('LGKC'), 'ad', ms('2026-11-17T08:00:00Z'), o)).toMatchObject({ status: 'open', notam: hours.key, source: `NOTAM ${hours.key}` });
    expect(aerodromeStatusAt(ad('LGKC'), 'ad', ms('2026-11-17T15:00:00Z'), o)).toMatchObject({ status: 'closed', notam: hours.key });
    expect(aerodromeStatusAt(ad('LGKC'), 'ad', ms('2026-11-15T08:00:00Z'), o)).toMatchObject({ status: 'closed', notam: hours.key }); // Sunday
    // outside the NOTAM's validity: back to the AIP
    expect(aerodromeStatusAt(ad('LGKC'), 'ad', ms('2027-04-10T08:00:00Z'), o)).toMatchObject({ status: 'unknown', notam: null });
  });

  test('QFALC with item D closes it during the schedule only; a closure wins over the hours', () => {
    const o = opts(all);
    expect(aerodromeStatusAt(ad('LGKC'), 'ad', ms('2026-11-17T10:30:00Z'), o)).toMatchObject({ status: 'closed', notam: closed.key, why: 'AD closed (DAILY 1000-1100)' });
    expect(aerodromeStatusAt(ad('LGKC'), 'ad', ms('2026-11-17T11:00:00Z'), o)).toMatchObject({ status: 'open', notam: hours.key });
    // without item D: closed for the whole validity, even at an H24 aerodrome
    const c = notam({ itemA: ['LGAV'], qcode: 'QFALC', text: 'AD CLSD', from: ms('2026-11-15T10:00:00Z'), to: ms('2026-11-15T12:00:00Z') });
    expect(aerodromeStatusAt(ad('LGAV'), 'ad', ms('2026-11-15T11:00:00Z'), opts([c]))).toMatchObject({ status: 'closed', notam: c.key });
    expect(aerodromeStatusAt(ad('LGAV'), 'ad', ms('2026-11-15T12:00:00Z'), opts([c]))).toMatchObject({ status: 'open', source: 'AIP LGAV AD 2.3' });
  });

  test('an unreadable NOTAM schedule makes the status unknown, citing the NOTAM', () => {
    expect(aerodromeStatusAt(ad('LGSR'), 'ad', ms('2026-11-17T08:00:00Z'), opts(all))).toMatchObject({ status: 'unknown', notam: unreadable.key });
    const d = notam({ itemA: ['LGAV'], qcode: 'QFALC', text: 'AD CLSD', schedule: 'NOV 17 19 21 0600-0800' });
    expect(aerodromeStatusAt(ad('LGAV'), 'ad', ms('2026-11-17T07:00:00Z'), opts([d]))).toMatchObject({ status: 'unknown', notam: d.key });
  });

  test('handling and ATS', () => {
    const o = opts(all);
    expect(aerodromeStatusAt(ad('LGAV'), 'handling', ms('2026-11-17T08:00:00Z'))).toMatchObject({ status: 'open' });
    expect(aerodromeStatusAt(ad('LGAV'), 'handling', ms('2026-11-17T08:00:00Z'), o)).toMatchObject({ status: 'closed', notam: handling.key, why: 'Handling not available' });
    expect(aerodromeStatusAt(ad('LGKC'), 'ats', ms('2026-11-17T12:30:00Z'), o)).toMatchObject({ status: 'open', notam: twr.key });
    expect(aerodromeStatusAt(ad('LGKC'), 'ats', ms('2026-11-17T13:30:00Z'), o)).toMatchObject({ status: 'closed', notam: twr.key });
    // handling HO follows the aerodrome: closed when the NOTAM hours close it
    expect(aerodromeStatusAt(ad('LGKC'), 'handling', ms('2026-11-17T15:00:00Z'), o)).toMatchObject({ status: 'closed' });
    expect(aerodromeStatusAt(ad('LGKC'), 'handling', ms('2026-11-17T08:00:00Z'), o)).toMatchObject({ status: 'open' });
  });

  test('a window is closed if any minute of it is; limits are listed', () => {
    const o = opts(all);
    const v = aerodromeStatus(ad('LGKC'), 'ad', ms('2026-11-17T13:50:00Z'), ms('2026-11-17T14:10:00Z'), o);
    expect(v).toMatchObject({ status: 'closed', at: ms('2026-11-17T14:00:00Z') });
    expect(v.limits.map((l) => l.key)).toEqual([limited.key]);
    expect(aerodromeStatus(ad('LGKC'), 'ad', ms('2026-11-17T12:00:00Z'), ms('2026-11-17T12:10:00Z'), o).status).toBe('open');
    expect(aerodromeStatus(ad('LGKC'), 'ad', NaN, NaN, o)).toMatchObject({ status: 'unknown', why: 'time not known' });
  });

  test("the day's hours for display, with the NOTAM ids", () => {
    const d = aerodromeDay(ad('LGKC'), 'ad', '2026-11-17', opts(all));
    expect(d.text).toBe('Open 06:00–10:00Z, 11:00–14:00Z');
    expect(d.notams.sort()).toEqual([hours.key, closed.key].sort());
    expect(aerodromeDay(ad('LGAV'), 'ad', '2026-11-17').text).toBe('H24');
    expect(aerodromeDay(ad('LGKC'), 'ad', '2026-11-17').text).toBe('HO: hours published by NOTAM');
    expect(aerodromeDay(ad('LGTT'), 'handling', '2026-11-17').text).toBe('Closed (NIL)');
    expect(aerodromeDay(ad('LGTT'), 'ad', '2026-11-17').text).toMatch(/^Open 0[45]:\d\d–1[45]:\d\dZ \(HJ\)$/);
  });
});

describe('General Declaration: who sends it', () => {
  const end = (role: 'departure' | 'destination', id: string, iso: string | null): HandlingEndInput => ({
    role, code: ad(id).icao ?? id, aerodrome: ad(id), fromMs: iso ? ms(iso) : NaN, toMs: iso ? ms(iso) : NaN, dayMs: ms('2026-11-17T00:00:00Z'),
  });
  test('handled at both ends: LGAV → LGIR (H24); the reason cites the AIP', () => {
    const g = genDecHandling([end('departure', 'LGAV', '2026-11-17T08:00:00Z'), end('destination', 'LGIR', '2026-11-17T09:30:00Z')], null);
    expect(g).toMatchObject({ pilotSends: false, autoPilotSends: false, override: null });
    expect(g.ends.map((e) => e.reason)).toEqual(['LGAV: handling H24 (AIP AD 2.3)', 'LGIR: handling H24 (AIP AD 2.3)']);
  });
  test('no handler at LGTT (AIP AD 1.6): the PIC sends it', () => {
    const g = genDecHandling([end('departure', 'LGTT', '2026-11-17T08:00:00Z'), end('destination', 'LGIR', '2026-11-17T09:30:00Z')], undefined);
    expect(g.pilotSends).toBe(true);
    expect(g.ends[0]).toMatchObject({ handled: false, reason: 'LGTT: no handling (AIP AD 1.6.5.4)' });
  });
  test('HO handling = during the aerodrome hours; seasonal handling by date', () => {
    const ho = genDecHandling([end('departure', 'LGAV', '2026-11-17T08:00:00Z'), end('destination', 'LGKC', '2026-11-17T09:30:00Z')], null);
    expect(ho.ends[1]).toMatchObject({ handled: true, reason: 'LGKC: handling HO (AIP AD 2.3)' });
    const closedThen = genDecHandling([end('departure', 'LGAV', '2026-11-17T08:00:00Z'), end('destination', 'LGKC', '2026-11-17T15:30:00Z')], null,
      opts([notam({ itemA: ['LGKC'], qcode: 'QFAAH', text: 'AD HOURS OF SERVICE: DAILY 0600-1400' })]));
    expect(closedThen.ends[1].handled).toBe(false);
    expect(closedThen.ends[1].reason).toMatch(/^LGKC: no handling at 15:30Z: aerodrome closed/);
    const lgad = (iso: string) => genDecHandling([end('departure', 'LGAV', iso), end('destination', 'LGAD', iso)], null).ends[1];
    expect(lgad('2026-11-17T09:30:00Z')).toMatchObject({ handled: false });
    expect(lgad('2026-11-17T09:30:00Z').reason).toContain('During summer only, on AD operating hours');
    expect(lgad('2026-07-17T09:30:00Z')).toMatchObject({ handled: true });
  });
  test('a NOTAM: handling not available', () => {
    const g = genDecHandling([end('departure', 'LGAV', '2026-11-17T08:00:00Z'), end('destination', 'LGIR', '2026-11-17T09:30:00Z')], null,
      opts([notam({ key: 'A1234/26', itemA: ['LGAV'], qcode: 'QFAXX', text: 'HANDLING NOT AVBL' })]));
    expect(g.pilotSends).toBe(true);
    expect(g.ends[0].reason).toBe('LGAV: NOTAM A1234/26: handling not available at 08:00Z');
  });
  test('HJ handling (LGEL) depends on the time; no time: the whole day must be handled', () => {
    expect(genDecHandling([end('departure', 'LGEL', '2026-11-17T10:00:00Z')], null).ends[0].handled).toBe(true);
    expect(genDecHandling([end('departure', 'LGEL', '2026-11-17T20:00:00Z')], null).ends[0].handled).toBe(false);
    const g = genDecHandling([end('departure', 'LGEL', null)], null).ends[0];
    expect(g.handled).toBe(false);
    expect(g.reason).toContain('all day (block-off time not set)');
  });
  test('a custom point is not handled; the override decides either way', () => {
    const custom: HandlingEndInput = { role: 'destination', code: 'KARYSTOS', aerodrome: null, fromMs: NaN, toMs: NaN, dayMs: 0 };
    const g = genDecHandling([end('departure', 'LGAV', '2026-11-17T08:00:00Z'), custom], null);
    expect(g.ends[1]).toMatchObject({ handled: false, reason: 'KARYSTOS: not an aerodrome (no handler)' });
    expect(genDecHandling([end('departure', 'LGAV', '2026-11-17T08:00:00Z'), custom], true)).toMatchObject({ pilotSends: false, autoPilotSends: true, override: true });
    expect(genDecHandling([end('departure', 'LGAV', '2026-11-17T08:00:00Z'), end('destination', 'LGIR', '2026-11-17T09:00:00Z')], false)).toMatchObject({ pilotSends: true, autoPilotSends: false });
  });
});
