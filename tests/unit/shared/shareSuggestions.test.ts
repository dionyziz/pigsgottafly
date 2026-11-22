// Offering a flight's manifest passengers as viewers in the share dialog: who has an e-mail, and who
// does not hold the flight yet (a share or a pending invite, any letter case).
import { describe, expect, it } from 'vitest';

import { accessByEmail, manifestContacts, passengerShareSuggestions } from '../../../src/shared/sharing';
import type { FlightCrew, Passenger, PersonDetails } from '../../../src/shared/types';

const details = (fullName: string): PersonDetails => ({
  fullName,
  phone: '',
  dateOfBirth: null,
  weightKg: 70,
  idNumber: '',
  idType: '',
  nationality: '',
  relation: '',
});
const pax = (id: string, fullName: string, email: string): Passenger => ({
  ...details(fullName),
  id,
  email,
  notes: '',
  created: 0,
  updated: 0,
});
const seat = (passengerId: string | null, fullName: string, role: FlightCrew['role'] = 'PAX'): FlightCrew => ({
  role,
  passengerId,
  seat: 'rear-left',
  snapshot: details(fullName),
});

const passengers = [
  pax('a', 'Ana Email', 'ana@example.com'),
  pax('b', 'Bo Email', ' Bo@Example.com '),
  pax('c', 'Cy Noemail', ''),
  pax('d', 'Dee Twin', 'ANA@example.com'),
  pax('e', 'Ed Offboard', 'ed@example.com'),
];

describe('manifestContacts', () => {
  it('lists the manifest passengers with an e-mail, in manifest order, each address once', () => {
    const crew = [
      seat(null, 'Pilot Person', 'PIC'),
      seat('b', 'Bo on this flight'),
      seat('c', 'Cy Noemail'),
      seat('a', 'Ana Email'),
      seat('d', 'Dee Twin'),
      seat('gone', 'Unlinked'),
    ];
    expect(manifestContacts(crew, passengers)).toEqual([
      { name: 'Bo on this flight', email: 'Bo@Example.com' },
      { name: 'Ana Email', email: 'ana@example.com' },
    ]);
  });
  it('is empty without passengers', () => {
    expect(manifestContacts([seat(null, 'Pilot', 'PIC')], passengers)).toEqual([]);
  });
});

describe('passengerShareSuggestions', () => {
  const contacts = [
    { name: 'Ana', email: 'ana@example.com' },
    { name: 'Bo', email: 'bo@example.com' },
    { name: 'Owner Self', email: 'owner@example.com' },
    { name: 'Fay', email: 'fay@example.com' },
  ];
  it('leaves out whoever already has access: the owner, a share, an invite (case-insensitive)', () => {
    const people = [
      { email: 'Owner@Example.com' },
      { email: 'BO@example.com' },
      { email: 'fay@example.com', pending: true },
    ];
    expect(passengerShareSuggestions(contacts, people)).toEqual([{ name: 'Ana', email: 'ana@example.com' }]);
  });
  it('offers everyone on a flight shared with nobody', () => {
    expect(passengerShareSuggestions(contacts, [])).toEqual(contacts);
  });
});

describe('accessByEmail', () => {
  const people = [
    { pilotId: 'p1', email: 'Bo@Example.com' },
    { pilotId: 'fay@example.com', email: 'fay@example.com' },
  ];
  it('finds a share or an invite by address, any case', () => {
    expect(accessByEmail(people, ' bo@example.COM')?.pilotId).toBe('p1');
    expect(accessByEmail(people, 'FAY@example.com')?.pilotId).toBe('fay@example.com');
  });
  it('finds nobody for an unknown or empty address', () => {
    expect(accessByEmail(people, 'zed@example.com')).toBeUndefined();
    expect(accessByEmail([{ email: '' }], '')).toBeUndefined();
  });
});
