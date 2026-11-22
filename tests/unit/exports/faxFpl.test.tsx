// @vitest-environment jsdom
// A filed plan drawn again from its message (parseFpl.ts: the faxed ICAO form is exactly what was
// filed), the fax's pages (FaxSheets.tsx), and the filing panel's honest account of the backend that
// filed the plan (FilingPanel.tsx: autorouter acknowledges, a fax is only delivered).
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { aerodrome } from '../../../src/data/ref';
import { FaxSheets } from '../../../src/features/exports/fpl/FaxSheets';
import { buildFpl, type FplInput } from '../../../src/features/exports/fpl/fpl';
import { parseFplMessage } from '../../../src/features/exports/fpl/parseFpl';
import { emptyFlightDoc, type Flight } from '../../../src/shared';
import type { FilingRecord, FilingState } from '../../../src/shared/briefing';
import type { FplFaxContent } from '../../../src/shared/fax';

const state: { s: FilingState | null } = { s: null };
vi.mock('../../../src/data/api', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  return {
    ...real,
    peekGet: () => undefined,
    api: { filing: { get: async () => state.s } },
  };
});
const { FilingPanel, filedVia } = await import('../../../src/features/exports/fpl/FilingPanel');

afterEach(cleanup);

const ad = (icao: string) => {
  const a = aerodrome(icao)!;
  return { icao: a.icao, name: a.name, lat: a.lat, lon: a.lon };
};
function input(): FplInput {
  const tt = ad('LGTT'),
    mg = ad('LGMG');
  return {
    registration: 'SX-ASV',
    icaoType: 'C172',
    makeModel: 'Cessna 172',
    wake: 'L',
    equipment: {
      item10a: 'SDFGY',
      item10b: 'C',
      pbn: '',
      item18Extras: '',
      emergencyRadio: { uhf: false, vhf: true, elt: true },
      survival: { polar: false, desert: false, maritime: true, jungle: false },
      jackets: { present: true, light: true, fluorescein: false, uhf: false, vhf: false },
      dinghies: { number: 1, capacity: 4, covered: true, colour: 'ORANGE' },
      remarks: '',
    },
    operator: '',
    colours: 'WHITE BLUE',
    date: '2026-11-20',
    eobt: '08:05',
    departure: tt,
    destination: mg,
    alternates: [ad('LGAV')],
    route: [
      { name: 'LGTT', lat: tt.lat, lon: tt.lon, kind: 'aerodrome' },
      { name: 'LGMG', lat: mg.lat, lon: mg.lon, kind: 'aerodrome' },
    ],
    cruiseTasKt: 92,
    totalEetMin: 45,
    enduranceMin: 240,
    personsOnBoard: 2,
    pic: { fullName: 'Pat Pilot', phone: '+30 690 000 0000' },
    remarks: '',
  };
}

describe('parseFplMessage', () => {
  test('the fields of a message as buildFpl wrote them', () => {
    const fpl = buildFpl(input());
    expect(parseFplMessage(fpl.message)).toEqual(fpl.fields);
  });
  test('a plan on one line reads the same', () => {
    const fpl = buildFpl(input());
    expect(parseFplMessage(fpl.lines.join(' '))).toEqual(fpl.fields);
  });
});

describe('the fax pages', () => {
  const fpl = buildFpl(input()).message;
  const content = (o: Partial<FplFaxContent> = {}): FplFaxContent => ({
    kind: 'file',
    to: { number: '+302103532635', unit: 'Athens Central AIS' },
    from: { name: 'Pat Pilot', phone: '+30 6900000000', email: 'pat@example.com' },
    fpl,
    addresses: ['LGGGZFZX', 'LGTTZTZX'],
    message: fpl,
    sentAt: Date.UTC(2026, 10, 20, 7, 0),
    signature: { name: 'Pat Pilot', signedAt: Date.UTC(2026, 10, 20, 7, 0) },
    ...o,
  });
  test('a plan: the cover (to, from, flight, acknowledge to) and the filled ICAO form', () => {
    render(<FaxSheets c={content()} />);
    const cover = screen.getByTestId('fax-cover').textContent;
    expect(cover).toContain('FAX');
    expect(cover).toContain('Athens Central AIS, fax +30 210 3532635');
    expect(cover).toContain('Pat Pilot, pilot in command');
    expect(cover).toMatch(/SXASV\s+LGTT → LGMG\s+EOBT 0805Z\s+DOF 261120/);
    expect(cover).toContain('2 (this cover and the ICAO flight plan form)');
    expect(cover).toContain('Please acknowledge receipt to +30 6900000000 or pat@example.com.');
    expect(screen.getByTestId('fax-message').textContent).toBe(fpl);
    const form = screen.getByTestId('fpl-form');
    expect(form.textContent).toContain('FLIGHT PLAN');
    expect(screen.getByLabelText('Item 7').textContent).toBe('SXASV' + '');
    expect(screen.getByTestId('fpl-form-addressees').textContent).toContain('LGGGZFZX');
    expect(screen.getByTestId('fpl-form-pic').textContent).toBe('PILOT P +30 6900000000');
    expect(screen.getByTestId('fpl-form-colours').textContent).toBe('WHITE BLUE');
  });
  test('a cancellation: the cover with the CNL and the plan it refers to, no form', () => {
    render(<FaxSheets c={content({ kind: 'cancel', message: '(CNL-SXASV-LGTT0805-LGMG-DOF/261120)' })} />);
    expect(screen.getByTestId('fax-cover').textContent).toContain('CANCELLATION (CNL)');
    expect(screen.getByTestId('fax-message').textContent).toBe('(CNL-SXASV-LGTT0805-LGMG-DOF/261120)');
    expect(screen.queryByTestId('fpl-form')).toBeNull();
  });
});

describe('the filing panel: which service filed it, and what it can tell', () => {
  const rec = (o: Partial<FilingRecord>): FilingRecord => ({
    provider: 'autorouter',
    providerLabel: 'autorouter',
    capabilities: { file: true, delay: true, cancel: true, status: true, ackRej: true },
    providerId: '1',
    faxTo: null,
    status: 'filed',
    eobt: null,
    fpl: '',
    addresses: [],
    message: '',
    filed: 1,
    updated: 1,
    polled: null,
    ...o,
  });
  const fax = (status: FilingRecord['status']) =>
    rec({
      provider: 'fax',
      providerLabel: 'Fax to Athens Central AIS',
      capabilities: { file: true, delay: true, cancel: true, status: true, ackRej: false },
      faxTo: { number: '+302103532635', unit: 'Athens Central AIS' },
      status,
    });
  test('filedVia', () => {
    expect(filedVia(rec({}))).toBe('Filed via autorouter');
    expect(filedVia(fax('delivered'))).toBe(
      'Delivered by fax to Athens Central AIS (+30 210 3532635) — no acknowledgement',
    );
    expect(filedVia(fax('sending'))).toMatch(/^Sending by fax to Athens Central AIS/);
    expect(filedVia(fax('failed'))).toMatch(/^Fax failed to/);
  });

  const flight = { ...emptyFlightDoc('2026-11-20'), id: 'f1', route: [], legOverrides: {} } as unknown as Flight;
  const infos = (fax: boolean) => [
    {
      id: 'autorouter' as const,
      label: 'autorouter',
      capabilities: { file: true, delay: true, cancel: true, status: true, ackRej: true },
      available: true,
      reason: null,
    },
    ...(fax
      ? [
          {
            id: 'fax' as const,
            label: 'Fax to Athens Central AIS',
            capabilities: { file: true, delay: true, cancel: true, status: true, ackRej: false },
            available: true,
            reason: null,
          },
        ]
      : []),
  ];
  const show = async (s: Partial<FilingState>) => {
    state.s = {
      enabled: true,
      reason: null,
      filers: infos(true),
      addressees: [],
      copyTo: [],
      filing: null,
      log: [],
      ...s,
    };
    render(
      <MemoryRouter>
        <FilingPanel flight={flight} message="(FPL-X)" complete />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('fpl-filing-status').textContent).toBeTruthy());
  };

  test('two backends: the pilot may pick one; the default tries them in order', async () => {
    await show({});
    const choice = screen.getByTestId('fpl-filing-via-choice');
    expect(choice.textContent).toContain('autorouter, then Fax to Athens Central AIS');
    expect(choice.textContent).toContain('Fax to Athens Central AIS only');
  });
  test('one backend that does not acknowledge: said once, before filing', async () => {
    await show({ filers: infos(true).slice(1) });
    expect(screen.getByTestId('fpl-filing-via-choice').textContent).toBe(
      'Files via Fax to Athens Central AIS — no acknowledgement',
    );
  });
  test('a faxed plan, delivered: the chip and the record say so; it can be cancelled and refreshed', async () => {
    await show({ filing: fax('delivered') });
    expect(screen.getByTestId('fpl-filing-status').textContent).toBe('Delivered by fax');
    expect(screen.getByTestId('fpl-filing-via').textContent).toContain('Delivered by fax to Athens Central AIS');
    expect(screen.getByTestId('fpl-cancel')).toBeTruthy();
    expect(screen.getByTestId<HTMLButtonElement>('fpl-refresh').disabled).toBe(false);
    expect(screen.getByTestId<HTMLButtonElement>('fpl-file').disabled).toBe(true);
  });
  test('a failed fax can be filed again; a plan through autorouter reads as such', async () => {
    await show({ filing: fax('failed') });
    expect(screen.getByTestId('fpl-file').textContent).toBe('File again');
    expect(screen.queryByTestId('fpl-cancel')).toBeNull();
    cleanup();
    await show({ filing: rec({ status: 'filed' }), filers: infos(false) });
    expect(screen.getByTestId('fpl-filing-via').textContent).toBe('Filed via autorouter');
  });
});
