// General Declaration: header fields, routing places and crew, passenger counts, warnings, render.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GenDec, genDecModel, ROUTING_ROWS } from '..';
import { GENDEC_DISINSECT_LINES, GENDEC_HEALTH_LINES } from '../../../../shared/forms';
import { ad, aircraft, flight, pilot, vfr } from '../../form731/__tests__/fixtures';

describe('general declaration model', () => {
  it('fills operator, registration, date and places', () => {
    const m = genDecModel({ flight: flight(), aircraft, pilot });
    expect(m.operator).toBe('Example Aeroclub');
    expect(m.registration).toBe('SX-ABC');
    expect(m.flightNo).toBe('');
    expect(m.date).toEqual(['21', '11', '2026']);
    expect(m.departure).toBe('DEKELIA / TATOI (LGTT)');
    expect(m.arrival).toBe('DEKELIA / TATOI (LGTT)');
    expect(m.departureCode).toBe('LGTT');
    expect(m.arrivalCode).toBe('LGTT');
  });

  it('lists origin, en-route stops and destination, with the PIC as crew', () => {
    const m = genDecModel({ flight: flight(), aircraft, pilot });
    expect(m.routing).toHaveLength(ROUTING_ROWS);
    expect(m.routing.slice(0, 4)).toEqual([
      { place: 'LGTT', crew: 'Pat Pilot (PIC)' },
      { place: 'LGMG', crew: '' },
      { place: 'LGTT', crew: '' },
      { place: '', crew: '' },
    ]);
  });

  it('counts passengers (not the crew) embarking and disembarking', () => {
    const m = genDecModel({ flight: flight(), aircraft, pilot });
    expect([m.embarking, m.throughDeparture, m.disembarking, m.throughArrival]).toEqual([2, 0, 2, 0]);
    const solo = genDecModel({ flight: flight({ crew: [] }), aircraft, pilot });
    expect([solo.embarking, solo.disembarking]).toEqual([0, 0]);
    expect(solo.routing[0].crew).toBe('Pat Pilot (PIC)');
  });

  it('prints the PIC as operator when the aircraft has none, and warns', () => {
    const m = genDecModel({ flight: flight(), aircraft: { ...aircraft, operator: '' }, pilot });
    expect(m.operator).toBe('Pat Pilot');
    expect(m.warnings.join(' ')).toMatch(/no operator/);
  });

  it('keeps the destination in the last row when the route has more stops than rows', () => {
    const route = [ad('LGTT', 'a'), ...['LGMG', 'LGTT', 'LGMG', 'LGTT', 'LGMG', 'LGTT', 'LGMG', 'LGTT', 'LGMG'].map((id, i) => ad(id, 'x' + i)), vfr('KEA', 'k'), ad('LGAV', 'z')];
    const m = genDecModel({ flight: flight({ route }), aircraft, pilot });
    expect(m.routing[ROUTING_ROWS - 1].place).toBe('LGAV');
    expect(m.warnings.join(' ')).toMatch(/room for 9/);
  });
});

describe('general declaration sheet', () => {
  it('renders one portrait sheet with the values in place', () => {
    const html = renderToStaticMarkup(<GenDec flight={flight()} aircraft={aircraft} pilot={pilot} />);
    expect(html.match(/class="pgf-sheet gd-sheet"/g)).toHaveLength(1);
    expect(html).toContain('GENERAL DECLARATION');
    expect(html).toContain('ICAO ANNEX 9 - APPENDIX 1.1');
    expect(html).toMatch(/data-field="operator"><span class="pgf-fill">Example Aeroclub</);
    expect(html).toMatch(/data-field="embarking"><span class="pgf-fill">2</);
    expect(html).toMatch(/data-field="pic">Pat Pilot</);
  });

  it('reproduces the full Annex 9 Declaration of Health', () => {
    const html = renderToStaticMarkup(<GenDec flight={flight()} aircraft={aircraft} pilot={pilot} />);
    for (const l of GENDEC_HEALTH_LINES) expect(html).toContain(l);
    for (const l of GENDEC_DISINSECT_LINES) expect(html).toContain(l);
    expect(html).toContain('temperature 38°C/100°F or greater');
    expect(html).toContain('If no disinsecting has been carried out during the flight');
    expect(html).toContain('Crew member concerned');
  });

  it('draws the PIC e-signature on the declaration signature line, like Form 731', () => {
    const unsigned = renderToStaticMarkup(<GenDec flight={flight()} aircraft={aircraft} pilot={pilot} />);
    expect(unsigned).not.toContain('data-testid="signature"');
    const signedAt = Date.UTC(2026, 10, 15, 16, 51);
    const html = renderToStaticMarkup(<GenDec flight={flight()} aircraft={aircraft} pilot={pilot} signature={{ name: 'Pat Pilot', signedAt }} />);
    expect(html).toMatch(/class="gd-sigline"><span class="gd-pic-signature"><span class="pgf-signature-wrap" data-testid="signature">/);
    expect(html).toContain('>P. Pilot<');
    expect(html).toContain('signed 15/11/2026 16:51Z');
  });
});
