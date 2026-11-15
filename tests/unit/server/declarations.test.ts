// The W&B and performance sheets sent to an operator: the browser's hash of what it shows equals the
// server's hash of what it sent (so "changed since it was sent" is right), the content is normalized
// the same on both sides, and the PDF renders (one loading sheet + one page per sector).
import { describe, expect, test } from 'vitest';
import zlib from 'node:zlib';
import { wbPerfContentOf, wbPerfText } from '../../../src/shared/declarations';
import { sha256Url } from '../../../src/features/exports/wbperf/declaration';
import { wbPerfHash } from '../../../api/_lib/routes/declarations';
import { wbPerfPdf } from '../../../api/_lib/declarationPdf';

const sample = (sectors = 1) => wbPerfContentOf({
  registration: 'SX-ABC', makeModel: 'F172M', operator: 'Αερολέσχη Test', date: '2026-11-20', pilot: 'Pat Pilot', route: 'LGTT – LGSY', category: 'Normal',
  wb: {
    verdict: 'fail', verdictText: 'Outside limits',
    rows: [{ kind: 'line', label: 'Corrected empty weight', mass: '691.2', arm: '0.995', moment: '687.74' }, { kind: 'person', label: 'PIC · Pat', note: 'Front left', mass: '80.0' }],
    totals: [{ kind: 'total', label: 'Total at take-off', mass: '1100.0', arm: '1.010', moment: '1111.00', over: true }],
    checks: [{ label: 'Take-off', ok: false, text: '1100.0 kg', categories: 'Normal: OUTSIDE' }],
    chart: { envelopes: [{ label: 'Normal', outline: [[600, 700], [1100, 1043], [1200, 1043], [800, 700]], cgOutline: [[610, 700], [1190, 1043]] }], points: [{ label: 'T/O', moment: 1111, mass: 1100, ok: false }] },
    limits: ['MTOW 1043 kg'], weighing: 'Weighing 2024', note: 'note',
  },
  perf: {
    verdict: 'pass', verdictText: 'ok',
    pages: Array.from({ length: sectors }, (_, i) => ({ label: `S${i}`, speeds: 'Vx 60', takeoff: { title: 'Departure', rows: [{ label: 'TODR', value: '420 m', status: 'bad' }] }, landing: { title: 'Destination' } })),
    factors: [{ label: 'Grass', factor: '1.20' }], notes: ['n'],
  },
  junk: 'dropped',
});

describe('W&B and performance declarations', () => {
  test('normalization keeps the known fields only, with defaults', () => {
    const c = sample();
    expect((c as any).junk).toBeUndefined();
    expect(c.wb.rows[1]).toEqual({ kind: 'person', label: 'PIC · Pat', note: 'Front left', mass: '80.0', arm: '', moment: '', over: false });
    expect(c.perf.pages[0].landing).toEqual({ title: 'Destination', aerodrome: '', time: '', rows: [], verdict: 'incomplete', verdictText: '', weather: '', metar: '' });
    expect(wbPerfContentOf(JSON.parse(JSON.stringify(c)))).toEqual(c);
    expect(() => wbPerfContentOf('x')).toThrow();
  });

  test('the browser and the server hash a version the same way', async () => {
    const c = sample();
    expect(await sha256Url(wbPerfText(c))).toBe(wbPerfHash(c));
    // what the server receives (JSON) normalizes to the same text
    expect(wbPerfHash(wbPerfContentOf(JSON.parse(JSON.stringify(c))))).toBe(wbPerfHash(c));
    expect(wbPerfHash(sample(2))).not.toBe(wbPerfHash(c));
  });

  test('the PDF: a loading sheet and a page per sector, signed', () => {
    const pdf = wbPerfPdf(sample(2), { key: 'PIC', name: 'Pat Pilot', signedAt: Date.UTC(2026, 10, 20, 8, 0) });
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toMatch(/\/Count 3 /);
    // the page contents (Flate) carry the sheet's text; Greek is transliterated
    const pages = [...text.matchAll(/stream\n([\s\S]*?)\nendstream/g)].map((m) => { try { return zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { return ''; } }).join('\n');
    expect(pages).toContain('(LOADING SHEET)');
    expect(pages).toContain('(PERFORMANCE LOG)');
    expect(pages).toContain('(Aeroleschi Test)');
    expect(pages).toContain('(Electronically signed 2026-11-20 08:00Z)');
  });
});
