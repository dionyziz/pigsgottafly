// The core's people and typed-input functions against the website's forms.
import { describe, expect, test } from 'vitest';

import { cleanWaypointName } from '../../../src/features/editor/map/snap';
import { personForm, personInput, validatePerson } from '../../../src/features/passengers/person';
import { formatDms, formatIcao, normaliseWaypointName, parseLatLon } from '../../../src/features/waypoints/coords';
import { parseCoords, parseTyped, personIssues } from '../../../src/native/core';
import {
  dateProblem,
  fmtDurationField,
  maskDate,
  parseDate,
  parseDuration,
  parseTime,
} from '../../../src/shared/typedInput';

const TODAY = '2026-11-15';

describe('personIssues: the passenger and profile forms', () => {
  test('a passenger without an e-mail, born tomorrow, too heavy', () => {
    const form = { ...personForm(null, 'Robin'), dateOfBirth: '2026-11-16', weightKg: 400 };
    const out = personIssues({ form, today: TODAY });
    expect(out.issues).toEqual(validatePerson(form, { today: TODAY }));
    expect(out.issues.map((i) => i.field)).toEqual(['email', 'dateOfBirth', 'weightKg']);
    expect(out.input).toBeNull();
  });

  test('a saved record opens as the dialog’s form; a good one gives the API body', () => {
    const person = {
      fullName: '  Robin   Rider ',
      phone: '',
      dateOfBirth: null,
      weightKg: 70,
      idType: 'ID' as const,
      idNumber: 'AK1',
      nationality: 'gr',
      relation: '',
      email: 'robin@example.com',
      notes: '',
    };
    const out = personIssues({ person, today: TODAY });
    expect(out.form).toEqual(personForm(person));
    expect(out.issues).toEqual([]);
    expect(out.input).toEqual(personInput(personForm(person)));
    expect(personIssues({ person: { ...person, phone: '' }, pilot: true, today: TODAY }).issues).toEqual(
      validatePerson(personForm(person), { pilot: true, today: TODAY }),
    );
  });
});

describe('parseCoords', () => {
  test.each(['37.9083, 23.7261', "37°54.5'N 23°43.6'E", '375430N 0234334E', 'nowhere'])('%s', (text) => {
    const ll = parseLatLon(text);
    expect(parseCoords({ text })).toEqual({
      latLon: ll,
      dms: ll ? formatDms(ll) : null,
      icao: ll ? formatIcao(ll) : null,
      name: null,
    });
  });
  test('a waypoint name as saved', () => {
    expect(parseCoords({ name: '  my   field ' }).name).toBe(normaliseWaypointName('  my   field '));
  });
});

describe('parseTyped', () => {
  test.each(['930', '9:30', '25:00', ''])('time %s', (text) => {
    expect(parseTyped({ kind: 'time', text })).toEqual({ value: parseTime(text) });
  });
  test.each(['90', '1:30', '130', 'x'])('duration %s', (text) => {
    const v = parseDuration(text);
    expect(parseTyped({ kind: 'duration', text })).toEqual({ value: v, field: v == null ? null : fmtDurationField(v) });
  });
  test.each(['20261116', '2026-02-30', '', '2026/11/1'])('date %s', (text) => {
    expect(parseTyped({ kind: 'date', text, min: TODAY })).toEqual({
      value: parseDate(text),
      problem: dateProblem(text, TODAY),
      masked: maskDate(text),
    });
  });
  test('slot and route point', () => {
    expect(parseTyped({ kind: 'slot', text: '09:38' })).toEqual({ value: '09:45' });
    expect(parseTyped({ kind: 'slot', text: 'x' })).toEqual({ value: null });
    expect(parseTyped({ kind: 'routePoint', text: ' my  pt ' })).toEqual({ value: cleanWaypointName(' my  pt ') });
  });
});
