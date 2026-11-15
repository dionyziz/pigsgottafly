// General Declaration: header fields, routing (origin and destination only) and crew, passenger
// counts, warnings, render.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GenDec, genDecModel, ROUTING_ROWS } from '..';
import { GENDEC_DISINSECT_LINES, GENDEC_HEALTH_LINES } from '../../../../shared/forms';
import { ad, aircraft, flight, pilot, vfr } from '../../form731/__tests__/fixtures';

describe('general declaration model', () => {
  it('fills operator, registration, flight number, ISO date and places', () => {
    const m = genDecModel({ flight: flight(), aircraft, pilot });
    expect(m.operator).toBe('Example Aeroclub');
    expect(m.registration).toBe('SXABC');
    expect(m.flightNo).toBe('PVT');
    expect(m.date).toBe('2026-11-21');
    expect(m.departure).toBe('LGTT');
    expect(m.arrival).toBe('LGTT');
  });

  it('lists only the origin (with the PIC in capitals) and the destination: no en-route stops', () => {
    const m = genDecModel({ flight: flight(), aircraft, pilot });
    expect(m.routing).toEqual([
      { place: 'LGTT', crew: 'PAT PILOT' },
      { place: 'LGTT', crew: '' },
    ]);
    const route = [ad('LGTT', 'a'), ...['LGMG', 'LGSY', 'LGMG', 'LGTT', 'LGMG', 'LGTT', 'LGMG', 'LGTT', 'LGMG'].map((id, i) => ad(id, 'x' + i)), vfr('KEA', 'k'), ad('LGAV', 'z')];
    const long = genDecModel({ flight: flight({ route }), aircraft, pilot });
    expect(long.routing.map((r) => r.place)).toEqual(['LGTT', 'LGAV']);
    expect(long.warnings.join(' ')).not.toMatch(/room for/);
  });

  it('counts passengers (not the crew) embarking and disembarking', () => {
    const m = genDecModel({ flight: flight(), aircraft, pilot });
    expect([m.embarking, m.throughDeparture, m.disembarking, m.throughArrival]).toEqual([2, 0, 2, 0]);
    const solo = genDecModel({ flight: flight({ crew: [] }), aircraft, pilot });
    expect([solo.embarking, solo.disembarking]).toEqual([0, 0]);
    expect(solo.routing[0].crew).toBe('PAT PILOT');
  });

  it('prints the PIC as operator when the aircraft has none, and warns', () => {
    const m = genDecModel({ flight: flight(), aircraft: { ...aircraft, operator: '' }, pilot });
    expect(m.operator).toBe('Pat Pilot');
    expect(m.warnings.join(' ')).toMatch(/no operator/);
  });
});

describe('general declaration sheet', () => {
  it('renders one portrait sheet with the values in bold after their labels', () => {
    const html = renderToStaticMarkup(<GenDec flight={flight()} aircraft={aircraft} pilot={pilot} />);
    expect(html.match(/class="pgf-sheet gd-sheet"/g)).toHaveLength(1);
    expect(html).toContain('GENERAL DECLARATION');
    expect(html).toContain('(OUTWARD/INWARD)');
    expect(html).toMatch(/Operator: <b class="gd-val pgf-fill" data-field="operator">Example Aeroclub<\/b>/);
    expect(html).toMatch(/Flight No\.: <b[^>]*data-field="flightNo">PVT</);
    expect(html).toMatch(/Date: <b[^>]*data-field="date">2026-11-21</);
    expect(html).toMatch(/data-field="embarking">2</);
    expect(html).toContain('* To be completed when required by the State.');
  });

  it('routing table: origin with the PIC, the arrow, destination, then blank ruled rows', () => {
    const html = renderToStaticMarkup(<GenDec flight={flight()} aircraft={aircraft} pilot={pilot} />);
    const body = html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>'));
    expect(body.match(/<tr>/g)).toHaveLength(ROUTING_ROWS);
    expect(body).toMatch(/data-end="origin">LGTT<\/td><td class="gd-crew-col pgf-fill" data-field="crew">PAT PILOT</);
    expect(body).toContain('data-testid="gendec-arrow"');
    expect(body).toMatch(/data-end="destination">LGTT</);
    expect(body).not.toContain('LGMG');
  });

  it('reproduces the full Annex 9 Declaration of Health, struck through NIL', () => {
    const html = renderToStaticMarkup(<GenDec flight={flight()} aircraft={aircraft} pilot={pilot} />);
    for (const l of GENDEC_HEALTH_LINES) expect(html).toContain(l);
    for (const l of GENDEC_DISINSECT_LINES) expect(html).toContain(l);
    expect(html).toContain('temperature 38°C/100°F or greater');
    expect(html).toContain('Crew member concerned');
    expect(html).toMatch(/data-testid="gendec-nil"[^]*>NIL<\/text>/);
  });

  it('draws the PIC e-signature on the declaration signature line, like Form 731', () => {
    const unsigned = renderToStaticMarkup(<GenDec flight={flight()} aircraft={aircraft} pilot={pilot} />);
    expect(unsigned).not.toContain('data-testid="signature"');
    const signedAt = Date.UTC(2026, 10, 15, 16, 51);
    const html = renderToStaticMarkup(<GenDec flight={flight()} aircraft={aircraft} pilot={pilot} signature={{ name: 'Pat Pilot', signedAt }} />);
    expect(html).toMatch(/class="gd-sigline"><span class="gd-pic-signature"><span class="pgf-signature-wrap" data-testid="signature">/);
    expect(html).toContain('>P. Pilot<');
    expect(html).toContain('signed 2026-11-15 16:51Z');
    expect(html).toContain('Authorized Agent or Pilot-in-Command');
  });
});
