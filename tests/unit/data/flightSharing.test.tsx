// @vitest-environment jsdom
// The client side of shared flights: a flight shared with the pilot is computed with its owner's
// details, settings and aircraft (flightPilot, withFlightAircraft, useFlightAircraft); this device's
// copy keeps how it is shared (flightStore) and drops an edit the server refuses with 403 (a viewer);
// a viewer's editor sections disable their controls, read-only sections stay usable; the map
// toolbar offers only "zoom to the route".
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api, ApiRequestError } from '../../../src/data/api';
import { putEntity } from '../../../src/data/entities';
import { __resetEntityStoreForTests } from '../../../src/data/entityStore';
import { docOf, flightStore } from '../../../src/data/flightStore';
import { MapToolbar } from '../../../src/features/editor/map/MapToolbar';
import { Section } from '../../../src/features/editor/panels/ui';
import { EditorContext, type EditorValue } from '../../../src/features/editor/state';
import { useFlightAircraft } from '../../../src/features/exports/useExportData';
import { emptyFlightDoc } from '../../../src/shared/constants';
import { type FlightAccess, flightPilot, type HangarAircraft, withFlightAircraft } from '../../../src/shared/sharing';
import { blankAircraft } from '../../../src/shared/templates';
import type { Flight, Pilot } from '../../../src/shared/types';

const person = (fullName: string, weightKg: number) => ({
  fullName,
  phone: '',
  dateOfBirth: null,
  weightKg,
  idNumber: '',
  idType: '' as const,
  nationality: '',
  relation: '',
});
const settings = {
  taxiOutMin: 10,
  taxiInMin: 5,
  reserveMin: 30,
  finalReserveMin: 0,
  windModel: 'ecmwf_ifs025',
  enrouteAerodromeRadiusNm: 2,
} as Pilot['settings'];
const me: Pilot = {
  ...person('Vera Viewer', 60),
  id: 'pl_me',
  email: 'vera@example.com',
  name: 'Vera',
  picture: '',
  licenceNo: 'V-1',
  homeAerodrome: 'LGAV',
  defaultAircraftId: null,
  settings,
  created: 0,
  lastLogin: 0,
};
const aircraft = (id: string, registration: string): HangarAircraft => ({
  ...blankAircraft(),
  id,
  registration,
  created: 0,
  updated: 0,
  access: { role: 'owner', owner: { pilotId: 'pl_me', name: 'Vera', email: 'vera@example.com' } },
});
const access = (role: 'view' | 'edit', ac: HangarAircraft | null = aircraft('ac_olga', 'SX-OLG')): FlightAccess => ({
  role,
  owner: { pilotId: 'pl_olga', name: 'Olga Owner', email: 'olga@example.com' },
  aircraft: ac && { ...ac, access: { role: 'view', owner: { pilotId: 'pl_olga', name: 'Olga', email: '' } } },
  pilot: { ...person('Olga Owner', 82), licenceNo: 'O-9', settings: { ...settings, reserveMin: 45 } },
});
const flight = (a?: FlightAccess, aircraftId: string | null = 'ac_olga'): Flight => ({
  ...emptyFlightDoc('2026-12-01'),
  aircraftId,
  id: 'fl_shared',
  version: 3,
  created: 1,
  updated: 2,
  opened: 2,
  deleted: false,
  ...(a ? { access: a } : {}),
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('a shared flight is computed as its owner does', () => {
  it('flightPilot: the owner’s details, licence and settings; the session pilot’s identity', () => {
    expect(flightPilot(me, flight())).toBe(me);
    const p = flightPilot(me, flight(access('view')));
    expect(p).toMatchObject({ id: 'pl_me', email: 'vera@example.com', homeAerodrome: 'LGAV' });
    expect(p).toMatchObject({ fullName: 'Olga Owner', weightKg: 82, licenceNo: 'O-9' });
    expect(p.settings.reserveMin).toBe(45);
  });

  it('withFlightAircraft adds the flight’s aircraft once', () => {
    const own = [aircraft('ac_mine', 'SX-MIN')];
    expect(withFlightAircraft(own, flight())).toBe(own);
    expect(withFlightAircraft(own, flight(access('edit'))).map((a) => a.registration)).toEqual(['SX-MIN', 'SX-OLG']);
    // already in the pilot's own list (shared with them too): theirs, not twice
    const both = [aircraft('ac_olga', 'SX-OLG')];
    expect(withFlightAircraft(both, flight(access('edit')))).toBe(both);
    expect(withFlightAircraft(own, flight(access('view', null)))).toBe(own);
  });

  it('useFlightAircraft finds the shared flight’s aircraft without the hangar', () => {
    __resetEntityStoreForTests();
    putEntity('aircraft', [aircraft('ac_mine', 'SX-MIN')]);
    const seen: (string | null)[] = [];
    function Probe({ f }: { f: Flight }) {
      seen.push(useFlightAircraft(f).aircraft?.registration ?? null);
      return null;
    }
    render(<Probe f={flight(access('view'))} />);
    render(<Probe f={flight(undefined, 'ac_mine')} />);
    render(<Probe f={flight(undefined, 'ac_olga')} />);
    expect(seen.slice(-3)).toEqual(['SX-OLG', 'SX-MIN', null]);
  });
});

describe('this device’s copy of a shared flight', () => {
  beforeEach(() => localStorage.clear());

  it('keeps how the flight is shared, for the next quick open; docOf leaves it out', async () => {
    const f = flight(access('view'));
    vi.spyOn(api.flights, 'get').mockResolvedValue(f);
    vi.spyOn(api.flights, 'opened').mockResolvedValue(null);
    const r = await flightStore.load(f.id);
    expect(r?.flight.access?.role).toBe('view');
    expect('access' in r!.doc).toBe(false);
    expect('access' in docOf(f)).toBe(false);
    expect(flightStore.peek(f.id)?.flight.access?.owner.name).toBe('Olga Owner');
  });

  it('an edit refused with 403 is dropped, not retried', async () => {
    const f = flight(access('edit'));
    vi.spyOn(api.flights, 'get').mockResolvedValue(f);
    vi.spyOn(api.flights, 'opened').mockResolvedValue(null);
    await flightStore.load(f.id);
    const update = vi
      .spyOn(api.flights, 'update')
      .mockRejectedValue(new ApiRequestError(403, 'you can view this flight but not change it', null));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    flightStore.save(f.id, { ...docOf(f), title: 'Changed' });
    await flightStore.flushNow();
    expect(update).toHaveBeenCalledTimes(1);
    expect(flightStore.status).toBe('error');
    expect(flightStore.hasUnsent(f.id)).toBe(false);
    expect(JSON.parse(localStorage.getItem('pgf.pending') || '[]')).toEqual([]);
  });
});

describe('a viewer’s editor', () => {
  const editor = (readOnly: boolean) => ({ readOnly }) as EditorValue;

  it('disables the controls of a section that changes the flight, not of a read-only one', () => {
    render(
      <EditorContext value={editor(true)}>
        <Section id="when" title="When">
          <input data-testid="date" />
        </Section>
        <Section id="metar" title="METAR" edits={false}>
          <button type="button" data-testid="refresh">
            Refresh
          </button>
        </Section>
      </EditorContext>,
    );
    expect(screen.getByTestId<HTMLInputElement>('date').matches(':disabled')).toBe(true);
    expect(screen.getByTestId<HTMLButtonElement>('refresh').matches(':disabled')).toBe(false);
  });

  it('leaves an editor’s sections alone', () => {
    render(
      <EditorContext value={editor(false)}>
        <Section id="when" title="When">
          <input data-testid="date" />
        </Section>
      </EditorContext>,
    );
    expect(screen.getByTestId<HTMLInputElement>('date').matches(':disabled')).toBe(false);
  });

  it('the map toolbar offers only zooming to the route', () => {
    render(<MapToolbar mode="idle" hasRoute onMode={() => {}} onFit={() => {}} readOnly />);
    expect(screen.queryByTestId('map-draw')).toBeNull();
    expect(screen.queryByTestId('map-undo')).toBeNull();
    expect(screen.getByTestId('map-fit')).toBeTruthy();
  });
});
