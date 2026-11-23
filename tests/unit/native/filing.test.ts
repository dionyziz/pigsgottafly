// PGF.filingView, filingDelay and filingError against the website's Filing panel model
// (src/features/exports/fpl/filing.ts, which FilingPanel.tsx renders).
import { describe, expect, test } from 'vitest';

import {
  DELAY_STEPS_MIN,
  delayCheck,
  filingView as webView,
  fromUtcInput,
  utcInput,
} from '../../../src/features/exports/fpl/filing';
import { filingDelay, filingError, filingView } from '../../../src/native/core';
import type { FilerInfo, FilingRecord, FilingState } from '../../../src/shared/briefing';

const FPL = '(FPL-SXASV-VG\n-C172/L-S/C\n-LGTT0745\n-N0100VFR DCT KALAMO DCT\n-LGSK0030 LGTG\n-DOF/261128 REG/SXASV)';
const NOW = Date.UTC(2026, 10, 28, 6, 0);
const EOBT = Date.UTC(2026, 10, 28, 7, 45);

const autorouter: FilerInfo = {
  id: 'autorouter',
  label: 'autorouter',
  capabilities: { file: true, delay: true, cancel: true, status: true, ackRej: true },
  available: true,
  reason: null,
};
const fax: FilerInfo = {
  id: 'fax',
  label: 'Fax to Athens Central AIS',
  capabilities: { file: true, delay: true, cancel: true, status: true, ackRej: false },
  available: true,
  reason: null,
};
const record = (o: Partial<FilingRecord> = {}): FilingRecord => ({
  provider: 'autorouter',
  providerLabel: 'autorouter',
  capabilities: autorouter.capabilities,
  providerId: 'fp-1',
  faxTo: null,
  status: 'filed',
  eobt: EOBT,
  fpl: FPL,
  addresses: ['LGGGZFZX'],
  message: '',
  filed: NOW,
  updated: NOW,
  polled: null,
  ...o,
});
const state = (o: Partial<FilingState> = {}): FilingState => ({
  enabled: true,
  reason: null,
  filers: [autorouter, fax],
  addressees: [
    { address: 'LGGGZFZX', reasons: ['ATHINAI ACC (VFR)'] },
    { address: 'LGTTZTZX', reasons: ['departure LGTT'] },
  ],
  copyTo: [{ email: 'ops@club.gr', for: 'Aeroclub' }],
  filing: null,
  log: [],
  ...o,
});

describe('filingView', () => {
  test("is the website's panel model, with the request and the plan's head", () => {
    const choices = { excluded: ['LGTTZTZX'], extra: ['LGSKZTZX'], noCopy: [], via: 'fax' as const };
    const v = filingView(JSON.stringify({ state: state(), choices, message: FPL, complete: true }));
    expect(v).toMatchObject(JSON.parse(JSON.stringify(webView(state(), choices, true))));
    expect(v.request).toEqual({
      fpl: FPL,
      addresses: ['LGGGZFZX', 'LGSKZTZX'],
      copyTo: ['ops@club.gr'],
      via: 'fax',
    });
    expect(v.sendsVia).toBe('Fax to Athens Central AIS');
    expect(v.head).toEqual({
      ident: 'SXASV',
      adep: 'LGTT',
      eobt: '0745',
      ades: 'LGSK',
      dof: '261128',
      route: 'DCT KALAMO DCT',
    });
    expect(v.addressees.map((a) => [a.address, a.on, a.reasons])).toEqual([
      ['LGGGZFZX', true, 'ATHINAI ACC (VFR)'],
      ['LGTTZTZX', false, 'departure LGTT'],
      ['LGSKZTZX', true, 'added by hand'],
    ]);
  });

  test('not filed: File; the backends in order by default', () => {
    const v = filingView({ state: state(), message: FPL });
    expect(v.status).toEqual({ label: 'Not filed', tone: null });
    expect(v.file).toEqual({ shown: true, label: 'File', enabled: true, hint: null });
    expect(v.sendsVia).toBe('autorouter, then Fax to Athens Central AIS');
    expect(v.viaChoice?.[0]).toEqual({ id: '', label: 'autorouter, then Fax to Athens Central AIS' });
    expect(v.delay.shown || v.cancel.shown).toBe(false);
    expect(v.refresh.enabled).toBe(false);
  });

  test('an incomplete message, or no addressee, cannot be filed', () => {
    expect(filingView({ state: state(), message: FPL, complete: false }).file).toMatchObject({
      enabled: false,
      hint: 'The message has missing fields',
    });
    const none = filingView({ state: state(), choices: { excluded: ['LGGGZFZX', 'LGTTZTZX'] }, message: FPL });
    expect(none.file).toMatchObject({ enabled: false, hint: 'No AFTN addressee' });
  });

  test('filed: Delay, Cancel and Refresh, not File', () => {
    const v = filingView({ state: state({ filing: record() }), message: FPL });
    expect(v.status).toEqual({ label: 'Filed', tone: 'ok' });
    expect(v.open).toBe(true);
    expect(v.file.enabled).toBe(false);
    expect([v.delay, v.cancel, v.refresh]).toEqual([
      { shown: true, enabled: true },
      { shown: true, enabled: true },
      { enabled: true },
    ]);
    expect(v.record?.via).toBe('Filed via autorouter');
    expect(v.viaChoice).toBeNull();
    expect(v.cancelMessage).toBeNull();
  });

  test('a fax on its way, then failed: File again', () => {
    const sending = record({
      provider: 'fax',
      capabilities: fax.capabilities,
      status: 'sending',
      faxTo: { number: '+302103532635', unit: 'Athens Central AIS' },
    });
    const v = filingView({ state: state({ filing: sending }) });
    expect(v.sending).toBe(true);
    expect(v.record?.via).toBe('Sending by fax to Athens Central AIS (+30 210 3532635) — no acknowledgement');
    expect(v.cancelMessage).toBe('(CNL-SXASV-LGTT0745-LGSK-DOF/261128)');
    const failed = filingView({ state: state({ filing: { ...sending, status: 'failed' } }), message: FPL });
    expect(failed.status).toEqual({ label: 'Fax failed', tone: 'danger' });
    expect(failed.file).toMatchObject({ label: 'File again', enabled: true });
  });

  test('disabled, or autorouter to connect first', () => {
    const off = filingView({ state: state({ enabled: false, reason: 'Filing is not available on this server.' }) });
    expect(off.disabledReason).toBe('Filing is not available on this server.');
    expect(off.file.enabled).toBe(false);
    const why = 'Connect your autorouter account to file.';
    const connect = filingView({
      state: state({
        enabled: false,
        reason: why,
        filers: [{ ...autorouter, available: false, reason: why, connect: 'connect' }],
      }),
    });
    expect(connect).toMatchObject({
      connectOnly: true,
      connectLabel: 'Connect autorouter to file',
      disabledReason: null,
    });
    expect(connect.file.shown).toBe(false);
  });

  test('a typed AFTN address', () => {
    expect(filingView({ state: null, typed: ' lgmgztzx ' }).typedAddress).toBe('LGMGZTZX');
    expect(filingView({ state: null, typed: 'LGMG' }).typedAddress).toBeNull();
  });
});

describe('filingDelay', () => {
  const filed = state({ filing: record() });
  test('from 30 minutes ago to 5 days ahead, and not the EOBT filed', () => {
    expect(filingDelay({ state: filed, eobt: EOBT + 30 * 60e3, now: NOW })).toEqual({
      problem: null,
      message: null,
      via: 'Through autorouter, which delays the plan with ATC.',
      start: EOBT,
    });
    // past its EOBT the delay starts from now, to the minute
    expect(filingDelay({ state: filed, now: EOBT + 90e3 }).start).toBe(EOBT + 60e3);
    expect(filingDelay({ state: filed, eobt: NOW - 31 * 60e3, now: NOW }).problem).toBe(
      'The new EOBT must be between now and 5 days ahead.',
    );
    expect(filingDelay({ state: filed, eobt: NOW + 121 * 3600e3, now: NOW }).problem).toBe(
      'The new EOBT must be between now and 5 days ahead.',
    );
    expect(filingDelay({ state: filed, eobt: EOBT, now: NOW }).problem).toBe('That is the EOBT already filed.');
    expect(filingDelay({ state: state(), eobt: EOBT, now: NOW }).problem).toBe('No open filed plan to delay.');
  });

  test('a faxed plan: the DLA the fax carries', () => {
    const faxed = state({ filing: record({ provider: 'fax', capabilities: fax.capabilities }) });
    const later = Date.UTC(2026, 10, 28, 9, 15);
    expect(filingDelay({ state: faxed, eobt: later, now: NOW })).toEqual({
      problem: null,
      message: '(DLA-SXASV-LGTT0915-LGSK-DOF/261128)',
      via: 'Faxed to the office the plan went to:',
      start: EOBT,
    });
    expect(filingDelay({ state: faxed, eobt: later, now: NOW })).toMatchObject(delayCheck(faxed.filing, later, NOW));
  });
});

test('filingError: as the panel words it', () => {
  expect(filingError({ offline: true }).text).toBe('Offline: nothing was sent.');
  expect(filingError({ message: 'this flight already has a filed plan: delay or cancel it' }).text).toBe(
    'this flight already has a filed plan: delay or cancel it',
  );
  expect(filingError({}).text).toBe('The request failed.');
});

test('filingError: a failed load', () => {
  expect(filingError({ load: true, offline: true }).text).toBe(
    'Offline: addressees and filing status are not available.',
  );
  expect(filingError({ load: true }).text).toBe('Could not load the filing state.');
});

test('the delay form reads and writes UTC', () => {
  expect(utcInput(EOBT)).toBe('2026-11-28T07:45');
  expect(fromUtcInput('2026-11-28T09:15')).toBe(Date.UTC(2026, 10, 28, 9, 15));
  expect(fromUtcInput('2026-11-28T')).toBeNaN();
  expect(delayCheck(record(), NaN, NOW)).toMatchObject({
    problem: 'The new EOBT must be between now and 5 days ahead.',
  });
  expect(DELAY_STEPS_MIN).toEqual([15, 30, 60]);
});
