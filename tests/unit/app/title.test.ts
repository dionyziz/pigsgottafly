import { describe, expect, test } from 'vitest';

import { flightTitle, pageTitle, routeTitle } from '../../../src/app/title';

describe('page titles', () => {
  test('every page has a name', () => {
    expect(routeTitle('/')).toBe('Flights');
    expect(routeTitle('/flights/new')).toBe('New flight');
    expect(routeTitle('/flights/fl_x')).toBe('Flight');
    expect(routeTitle('/flights/fl_x/export/form731')).toBe('File & forms');
    expect(routeTitle('/hangar')).toBe('Hangar');
    expect(routeTitle('/hangar/ac_1')).toBe('Aircraft');
    expect(routeTitle('/operators/op_1')).toBe('Operator');
    expect(routeTitle('/admin/errors')).toBe('Errors');
    expect(routeTitle('/passengers')).toBe('Passengers');
  });
  test('most specific first, the app last', () => {
    expect(pageTitle('Form 731', 'LGTT → LGSY · 2026-11-22')).toBe(
      "Form 731 · LGTT → LGSY · 2026-11-22 · Pig's Gotta Fly",
    );
    expect(pageTitle(null, '', undefined)).toBe("Pig's Gotta Fly");
  });
  test("a flight's name: its title, else its route and date", () => {
    const ad = (name: string) => ({ kind: 'aerodrome', name });
    expect(flightTitle({ title: ' Ydra tour ', date: '2026-11-22', route: [ad('LGTT')] })).toBe('Ydra tour');
    expect(
      flightTitle({ title: '', date: '2026-11-22', route: [ad('LGTT'), { kind: 'vrp', name: 'YDRA' }, ad('LGSY')] }),
    ).toBe('LGTT → LGSY · 2026-11-22');
    expect(flightTitle({ title: '', date: '2026-11-22', route: [ad('LGTT'), ad('LGTT')] })).toBe(
      'Local flight · LGTT · 2026-11-22',
    );
    expect(flightTitle({ title: '', date: null, route: [] })).toBe('Untitled flight');
  });
});
