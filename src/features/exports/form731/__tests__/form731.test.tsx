// Form 731: field contents, manifest order, pagination, warnings, and the rendered sheet.
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { Form731, form731Model } from '..';
import { formatDate, routePlaces, routeText } from '../common';
import { ad, aircraft, flight, pax, pilot, vfr } from './fixtures';

describe('form 731 model', () => {
  it('fills airport, date, registration and the aerodrome route', () => {
    const m = form731Model({ flight: flight(), aircraft, pilot });
    expect(m.airport).toBe('DEKELIA / TATOI (LGTT)');
    expect(m.date).toBe('2026-11-21');
    expect(m.registration).toBe('SX-ABC');
    expect(m.route).toBe('LGTT – LGTT');
  });

  it('lists the PIC first, then the passengers in seat order, with live profile details filling the snapshot gaps', () => {
    const m = form731Model({ flight: flight(), aircraft, pilot });
    expect(m.sheets).toHaveLength(1);
    expect(m.sheets[0].map((r) => [r.no, r.role, r.name])).toEqual([
      [1, 'PIC', 'Pat Pilot'],
      [2, 'PAX', 'Front Person'],
      [3, 'PAX', 'Rear Person'],
    ]);
    const pic = m.sheets[0][0];
    expect(pic).toMatchObject({ relation: 'PIC', idPassport: 'AB 123456', contact: '+30 690 000 0000' });
    expect(m.sheets[0][2]).toMatchObject({ relation: 'PAX', idPassport: 'X1', contact: '+30 691' });
    expect(m.picName).toBe('Pat Pilot');
  });

  it('prefers the manifest snapshot over the live record', () => {
    const f = flight();
    f.crew[1].snapshot.phone = '+30 000 snapshot';
    const m = form731Model({ flight: f, aircraft, pilot });
    expect(m.sheets[0][0].contact).toBe('+30 000 snapshot');
  });

  it('fills a passenger gap from the passenger list when given', () => {
    const f = flight({ crew: [pax('Front Person', 'front-right', {}, 'px1')] });
    const passengers = [
      {
        ...f.crew[0].snapshot,
        id: 'px1',
        fullName: 'Front Person',
        phone: '+30 699',
        idNumber: 'Z9',
        idType: 'ID' as const,
        email: '',
        notes: '',
        created: 0,
        updated: 0,
      },
    ];
    const m = form731Model({ flight: f, aircraft, pilot, passengers });
    expect(m.sheets[0][1]).toMatchObject({ contact: '+30 699', idPassport: 'Z9' });
  });

  it('adds the pilot as PIC when the manifest has none', () => {
    const m = form731Model({ flight: flight({ crew: [] }), aircraft, pilot });
    expect(m.sheets[0].map((r) => r.name)).toEqual(['Pat Pilot']);
  });

  it('continues on a second sheet after six people', () => {
    const crew = [
      { role: 'PIC' as const, passengerId: null, seat: 's0', snapshot: { ...pilot } },
      ...Array.from({ length: 7 }, (_, i) => pax(`P${i + 1}`, `s${i + 1}`)),
    ];
    const m = form731Model({ flight: flight({ crew }), aircraft: null, pilot });
    expect(m.sheets.map((s) => s.length)).toEqual([6, 2]);
    expect(m.sheets[1][0].no).toBe(7);
  });

  it('warns about missing data instead of inventing it', () => {
    const m = form731Model({
      flight: flight({ route: [], date: '' }),
      aircraft: null,
      pilot: { ...pilot, idNumber: '' },
    });
    expect(m.airport).toBe('');
    expect(m.registration).toBe('');
    expect(m.warnings.join(' ')).toMatch(/route is empty/);
    expect(m.warnings.join(' ')).toMatch(/no date/);
    expect(m.warnings.join(' ')).toMatch(/No aircraft/);
    expect(m.warnings.join(' ')).toMatch(/PIC: no ID\/passport number/);
  });
});

describe('route places', () => {
  it('keeps origin, aerodromes on the way and destination; drops VFR points and repeats', () => {
    expect(routeText([ad('LGTT', 'a'), vfr('KEA', 'b'), ad('LGTT', 'c')])).toBe('LGTT – LGTT');
    expect(routeText([ad('LGTT', 'a'), ad('LGTT', 'x'), ad('LGMG', 'c'), ad('LGMG', 'd')])).toBe('LGTT – LGMG');
    expect(routeText([vfr('KEA', 'a'), ad('LGMG', 'b')])).toBe('KEA – LGMG');
    expect(routePlaces([])).toEqual([]);
    expect(formatDate('')).toBe('');
  });
});

// the warnings' fix links need a router
const markup = (el: ReactElement) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>);

describe('form 731 sheet', () => {
  it('renders one landscape sheet with the values in their fields and six numbered rows', () => {
    const html = markup(<Form731 flight={flight()} aircraft={aircraft} pilot={pilot} />);
    expect(html.match(/class="pgf-sheet f731-sheet"/g)).toHaveLength(1);
    expect(html).toContain('OFFICIAL STATEMENT OF PERSONS BOARDING PRIVATE AIRCRAFTS');
    expect(html).toMatch(/data-field="registration"><span class="pgf-fill">SX-ABC</);
    expect(html).toMatch(/data-field="route"><span class="pgf-fill">LGTT – LGTT</);
    for (let i = 1; i <= 6; i++) expect(html).toContain(`<td class="f731-no">${i}.</td>`);
    expect(html).toMatch(/data-field="pic">Pat Pilot</);
    expect(html).not.toContain('form-warnings');
  });
});
