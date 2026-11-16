// Editor panel helpers: the manifest following the passenger list, the take-off/landing weather
// line, the navlog strip's forecast run, and the in-place fixes of warnings.
import { describe, expect, it } from 'vitest';

import { editorWarningFix, onEditorFocus, sectionOf } from '../../../src/features/editor/focus';
import { applyPerson, editCrewField, followPerson, resetCrew } from '../../../src/features/editor/panels/manifest';
import { weatherRunText } from '../../../src/features/editor/panels/NavlogStrip';
import { weatherText } from '../../../src/features/editor/panels/PerformanceSection';
import type { FlightCrew, PersonDetails } from '../../../src/shared';

const person = (o: Partial<PersonDetails> = {}): PersonDetails => ({
  fullName: 'Maria P',
  phone: '+30 690',
  dateOfBirth: '1990-04-02',
  weightKg: 62,
  idNumber: 'AK 1',
  idType: 'ID',
  nationality: 'GR',
  relation: '',
  ...o,
});

describe('followPerson', () => {
  it('copies the fields changed in the list and keeps the ones set for this flight', () => {
    const snap = person({ weightKg: 70 }); // weight typed for this flight
    const out = followPerson(snap, person(), person({ idNumber: 'AK 2' }));
    expect(out).toEqual(person({ weightKg: 70, idNumber: 'AK 2' }));
  });
  it('a weight changed in the list replaces the flight weight', () => {
    expect(followPerson(person({ weightKg: 70 }), person(), person({ weightKg: 65 })).weightKg).toBe(65);
  });
  it('nothing changed: the same object', () => {
    const snap = person({ weightKg: 70 });
    expect(followPerson(snap, person(), person())).toBe(snap);
  });
  it('a field edited on the flight stays when the list changes it', () => {
    const out = followPerson(person({ weightKg: 70 }), person(), person({ weightKg: 65, phone: '+30 691' }), [
      'weightKg',
    ]);
    expect(out).toEqual(person({ weightKg: 70, phone: '+30 691' }));
  });
});

describe('manifest overrides', () => {
  const row = (o: Partial<FlightCrew> = {}): FlightCrew => ({
    role: 'PAX',
    passengerId: 'p1',
    seat: 'rear-left',
    snapshot: person(),
    ...o,
  });
  it('editing a field on the flight marks it once', () => {
    const a = editCrewField(row(), 'weightKg', 70);
    expect(a.snapshot.weightKg).toBe(70);
    expect(a.overrides).toEqual(['weightKg']);
    expect(editCrewField(a, 'weightKg', 72).overrides).toEqual(['weightKg']);
  });
  it('saved details (dialog) apply to every field but the edited ones', () => {
    const a = editCrewField(row(), 'weightKg', 70);
    const b = applyPerson(a, person({ weightKg: 64, idNumber: 'AK 9' }));
    expect(b.snapshot).toEqual(person({ weightKg: 70, idNumber: 'AK 9' }));
    expect(b.overrides).toEqual(['weightKg']);
    expect(applyPerson(b, b.snapshot)).toBe(b);
    // without an override the weight follows
    expect(applyPerson(row(), person({ weightKg: 64 })).snapshot.weightKg).toBe(64);
  });
  it('reset takes the saved details and clears the overrides', () => {
    const a = editCrewField(row(), 'weightKg', 70);
    const r = resetCrew(a, person({ weightKg: 64 }));
    expect(r.snapshot.weightKg).toBe(64);
    expect(r.overrides).toBeUndefined();
    expect(followPerson(r.snapshot, person({ weightKg: 64 }), person({ weightKg: 60 }), r.overrides).weightKg).toBe(60);
  });
});

describe('weatherText', () => {
  const surface = (wind: unknown, tempC: number | null, qnhHpa: number | null) => ({
    surface: { wind, tempC, qnhHpa } as never,
  });
  it('wind, temperature and QNH in one line', () => {
    expect(weatherText(surface({ dirTrueDeg: 240, speedKt: 12 }, 18.4, 1013.2))).toBe('240°/12 kt · 18°C · Q1013');
  });
  it('gusts, calm, variable, unknown', () => {
    expect(weatherText(surface({ dirTrueDeg: 5, speedKt: 15, gustKt: 25 }, 10, 1020))).toBe(
      '005°/15G25 kt · 10°C · Q1020',
    );
    expect(weatherText(surface({ dirTrueDeg: 0, speedKt: 0 }, 10, 1020))).toBe('calm · 10°C · Q1020');
    expect(weatherText(surface({ dirTrueDeg: null, speedKt: 4 }, null, null))).toBe('VRB/4 kt · –°C · Q–');
    expect(weatherText({ surface: null })).toBe('ISA, calm');
  });
});

describe('weatherRunText', () => {
  const ok = (runMs: number | null) =>
    ({
      status: 'ok',
      message: 'ECMWF IFS 0.25°, run 2026-11-16 06Z, fetched 08:00Z',
      legs: [],
      departure: null,
      destination: null,
      source: { run: runMs == null ? null : { runMs, availableMs: null }, endpoint: 'forecast' },
    }) as never;
  it('the model run hour', () => {
    expect(weatherRunText(ok(Date.UTC(2026, 10, 16, 6)), false, true)).toMatchObject({ text: '06Z run' });
  });
  it('loading, failed, no run', () => {
    expect(weatherRunText(null, true, true).text).toBe('Fetching winds…');
    expect(weatherRunText({ status: 'error', message: 'Winds unavailable: x' } as never, false, true)).toEqual({
      text: 'No winds',
      title: 'Winds unavailable: x',
      tone: 'warn',
    });
    expect(weatherRunText(ok(null), false, true).text).toBe('Forecast');
    expect(weatherRunText(null, false, false).text).toBe('');
  });
});

describe('editorWarningFix', () => {
  it('a field of this flight is focused in place, in the section that holds it', () => {
    const seen: string[] = [];
    const off = onEditorFocus((k) => seen.push(k));
    const f = editorWarningFix('Block-off time not set: take-off and landing distances use ISA and calm wind.', 'ac1');
    expect(f && 'onFix' in f).toBe(true);
    if (f && 'onFix' in f) f.onFix();
    off();
    expect(seen).toEqual(['blockOff']);
    expect(sectionOf('blockOff')).toBe('when');
    expect(sectionOf('route')).toBe('route');
  });
  it('the aircraft is a link to the hangar; weather has no fix', () => {
    expect(editorWarningFix('Compass card "A" expired on 2026-01-01.', 'ac1')).toEqual({
      label: 'Fix in the hangar',
      to: '/hangar/ac1?focus=compass',
    });
    expect(editorWarningFix('LGTT: thunderstorm (forecast).', 'ac1')).toBeNull();
  });
});
