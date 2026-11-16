// @vitest-environment jsdom
// useFlightWeather: one weather + METAR loader for the editor and the exports (stops included, one
// METAR rule, a failed fetch ends loading, only the newest request counts).
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { aerodrome } from '../../../src/data/ref';
import type { RouteWeather } from '../../../src/data/weather';
import type { RoutePoint } from '../../../src/shared';
import { aerodromePoint } from '../../../src/shared';

const weatherCalls: any[] = [];
const metarCalls: string[][] = [];
let nextWeather: () => Promise<RouteWeather>;
vi.mock('../../../src/data/weather', async (orig) => ({
  ...(await orig<object>()),
  fetchRouteWeather: (req: any) => {
    weatherCalls.push(req);
    return nextWeather();
  },
}));
vi.mock('../../../src/data/weatherMetar', async (orig) => ({
  ...(await orig<object>()),
  fetchMetarTaf: (ids: string[]) => {
    metarCalls.push(ids);
    return Promise.resolve({ status: 'ok', message: '', source: 'aviationweather.gov', fetchedMs: 1, stations: {} });
  },
}));
const { flightWeatherPlan, metarRelevant, useFlightWeather } = await import('../../../src/data/useFlightWeather');
const { buildLegs } = await import('../../../src/calc');

afterEach(() => {
  cleanup();
  weatherCalls.length = 0;
  metarCalls.length = 0;
});

const ok = (legs: number): RouteWeather => ({
  status: 'ok',
  message: 'ok',
  legs: new Array(legs).fill(null),
  departure: null,
  destination: null,
  stops: [],
  source: null,
});
const route = (): RoutePoint[] => ['LGTT', 'LGMG', 'LGSY'].map((id) => aerodromePoint(aerodrome(id)!));
const today = new Date().toISOString().slice(0, 10);

function Probe({ r, date, metar }: { r: RoutePoint[]; date: string; metar?: 'near' | 'always' }) {
  const [options] = [{ aerodromeRequests: [{ pointUid: r[1].uid, kind: 'stop' as const, stopMin: 30 }] }];
  const wx = useFlightWeather({ date, route: r, options, model: null, metar });
  return (
    <p data-testid="wx">
      {wx.weatherLoading ? 'loading' : (wx.weather?.status ?? 'none')}|{wx.icaos.join(',')}|{wx.stops.length}
    </p>
  );
}

describe('flightWeatherPlan / metarRelevant', () => {
  it('includes intermediate stops and their ICAO codes, once', () => {
    const r = route();
    const p = flightWeatherPlan({
      date: today,
      model: null,
      route: r,
      options: { aerodromeRequests: [{ pointUid: r[1].uid, kind: 'touch-and-go' }] },
      legs: buildLegs(r, today),
    });
    expect(p.departure?.icao).toBe('LGTT');
    expect(p.destination?.icao).toBe('LGSY');
    expect(p.stops.map((s) => s.aerodrome?.icao)).toEqual(['LGMG']);
    expect(p.icaos).toEqual(['LGTT', 'LGMG', 'LGSY']);
    expect(p.mids).toHaveLength(2);
  });
  it('METAR matters only around the flight day', () => {
    const now = Date.parse('2026-11-16T10:00:00Z');
    expect(metarRelevant('2026-11-16', now)).toBe(true);
    expect(metarRelevant('2026-11-17', now)).toBe(false); // noon tomorrow is 26 h away (> 12 h + 6 h)
    expect(metarRelevant('2026-11-15', now)).toBe(false); // yesterday's noon: 22 h ago
    expect(metarRelevant('2026-11-15', Date.parse('2026-11-16T04:00:00Z'))).toBe(true); // 16 h ago
  });
});

describe('useFlightWeather', () => {
  it('fetches the stops too, and METAR near now', async () => {
    nextWeather = async () => ok(2);
    render(<Probe r={route()} date={today} />);
    await waitFor(() => expect(screen.getByTestId('wx').textContent).toBe('ok|LGTT,LGMG,LGSY|1'));
    expect(weatherCalls[0].stops).toHaveLength(1);
    expect(weatherCalls[0].departure).not.toBeNull();
    expect(metarCalls).toEqual([['LGTT', 'LGMG', 'LGSY']]);
  });

  it('a rejected fetch ends loading with an error, not a spinner forever', async () => {
    nextWeather = () => Promise.reject(new Error('network'));
    render(<Probe r={route()} date={today} />);
    await waitFor(() => expect(screen.getByTestId('wx').textContent).toBe('error|LGTT,LGMG,LGSY|1'));
  });

  it('no METAR for a flight far away, unless asked for always', async () => {
    nextWeather = async () => ok(2);
    const { unmount } = render(<Probe r={route()} date="2027-06-01" />);
    await waitFor(() => expect(screen.getByTestId('wx').textContent).toMatch(/^ok/));
    expect(metarCalls).toEqual([]);
    unmount();
    render(<Probe r={route()} date="2027-06-01" metar="always" />);
    await waitFor(() => expect(metarCalls.length).toBe(1));
  });

  it('only the newest request sets the weather', async () => {
    let release!: (w: RouteWeather) => void;
    nextWeather = () =>
      new Promise((r) => {
        release = r;
      });
    const r = route();
    const { rerender } = render(<Probe r={r} date={today} />);
    const first = release;
    nextWeather = async () => ({ ...ok(1), message: 'new' });
    rerender(<Probe r={r.slice(0, 2)} date={today} />);
    await waitFor(() => expect(screen.getByTestId('wx').textContent).toMatch(/^ok/));
    await act(async () => first({ ...ok(2), status: 'unavailable' }));
    expect(screen.getByTestId('wx').textContent).toMatch(/^ok/);
  });
});
