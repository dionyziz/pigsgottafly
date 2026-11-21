// The W&B and performance sheets sent to an operator: the browser's hash of what it shows equals the
// server's hash of what it sent (so "changed since it was sent" is right), the content is normalized
// the same on both sides, and the PDF renders (one loading sheet + one page per sector).
import zlib from 'node:zlib';

import { describe, expect, test } from 'vitest';

import { wbPerfPdf } from '../../../api/_lib/declarationPdf';
import { wbPerfHash } from '../../../api/_lib/routes/declarations';
import { sha256Url } from '../../../src/features/exports/wbperf/declaration';
import { sheetText, wbPerfContentOf, wbPerfText } from '../../../src/shared/declarations';

const sample = (sectors = 1) =>
  wbPerfContentOf({
    registration: 'SX-ABC',
    makeModel: 'F172M',
    operator: 'Αερολέσχη Test',
    date: '2026-11-20',
    pilot: 'Pat Pilot',
    route: 'LGTT – LGSY',
    category: 'Normal',
    wb: {
      verdict: 'fail',
      verdictText: 'Outside limits',
      rows: [
        { kind: 'empty', key: 'empty', label: 'Corrected empty weight', mass: '691.2', arm: '0.995', moment: '687.74' },
        { kind: 'person', label: 'PIC · Pat', note: 'Front left', mass: '80.0' },
      ],
      totals: [
        { kind: 'total', label: 'Total at take-off', mass: '1100.0', arm: '1.010', moment: '1111.00', over: true },
      ],
      checks: [
        {
          phase: 'takeoff',
          label: 'Take-off',
          ok: false,
          text: '1100.0 kg',
          categories: [{ label: 'Normal', ok: false }],
        },
      ],
      chart: {
        envelopes: [
          {
            category: 'normal',
            label: 'Normal',
            outline: [
              [600, 700],
              [1100, 1043],
              [1200, 1043],
              [800, 700],
            ],
            cgOutline: [
              [610, 700],
              [1190, 1043],
            ],
          },
        ],
        points: [{ key: 'takeoff', label: 'T/O', moment: 1111, mass: 1100, ok: false }],
      },
      limits: ['MTOW 1043 kg'],
      weighing: 'Weighing 2024',
      note: 'note',
    },
    perf: {
      verdict: 'pass',
      verdictText: 'ok',
      pages: Array.from({ length: sectors }, (_, i) => ({
        label: `S${i}`,
        stall: { vsKt: 44, vsoKt: null },
        speedsSource: 'AFM',
        takeoff: {
          phase: 'takeoff',
          title: 'Departure',
          rows: [{ key: 'todr', label: 'TODR', value: '420 m', status: 'bad' }],
          diagram: {
            runway: '02',
            reciprocal: '20',
            runwayHdgMag: 20,
            windFromMag: 360,
            headwindKt: 9.4,
            crosswindKt: 3.4,
            crossFrom: 'L',
          },
        },
        landing: { phase: 'landing', title: 'Destination' },
      })),
      factors: [{ label: 'Grass', factor: '1.20' }],
      crosswind: { takeoff: 15, landing: 'x' },
      notes: ['n'],
    },
    junk: 'dropped',
  });

describe('W&B and performance declarations', () => {
  test('normalization keeps the known fields only, with defaults', () => {
    const c = sample();
    expect((c as any).junk).toBeUndefined();
    expect(c.wb.rows[1]).toEqual({
      kind: 'person',
      key: '',
      label: 'PIC · Pat',
      note: 'Front left',
      mass: '80.0',
      arm: '',
      moment: '',
      over: false,
      need: false,
    });
    expect(c.perf.pages[0].stall).toEqual({ vsKt: 44, vsoKt: null });
    expect(c.perf.crosswind).toEqual({ takeoff: 15, landing: null });
    expect(c.perf.pages[0].takeoff.diagram?.crossFrom).toBe('L');
    expect(c.wb.chart.points[0].key).toBe('takeoff');
    expect(c.wb.checks[0].categories).toEqual([{ label: 'Normal', ok: false }]);
    expect(c.perf.pages[0].landing).toEqual({
      phase: 'landing',
      title: 'Destination',
      aerodrome: '',
      time: '',
      rows: [],
      verdict: 'incomplete',
      verdictText: '',
      weather: '',
      metar: '',
      diagram: null,
    });
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
    const pages = [...text.matchAll(/stream\n([\s\S]*?)\nendstream/g)]
      .map((m) => {
        try {
          return zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1');
        } catch {
          return '';
        }
      })
      .join('\n');
    expect(pages).toContain('(LOADING SHEET)');
    expect(pages).toContain('(PERFORMANCE LOG)');
    expect(pages).toContain('(Aeroleschi Test)');
    expect(pages).toContain('(Electronically signed 2026-11-20 08:00Z)');
  });
});

describe('free text on the sheets', () => {
  test('links, domain names and e-mail addresses are removed; the sheet data stays', () => {
    expect(sheetText('Verify at https://evil.example/login now', 100)).toBe('Verify at now');
    expect(sheetText('go to www.evil.example or evil.example/x, mail a@b.example', 100)).toBe('go to or mail');
    expect(sheetText('1040.2 kg · CG 1.010 m · 1050.40 kg·m', 100)).toBe('1040.2 kg · CG 1.010 m · 1050.40 kg·m');
    expect(sheetText('LGTT 150850Z 36010KT CAVOK 18/09 Q1015', 100)).toBe('LGTT 150850Z 36010KT CAVOK 18/09 Q1015');
    expect(sheetText('a‮b\nc', 100)).toBe('a b c');
    expect(sheetText('x'.repeat(500), 60)).toHaveLength(60);
  });

  test('lists and strings are tightly bounded', () => {
    const c = wbPerfContentOf({
      route: 'R'.repeat(5000),
      wb: { rows: Array.from({ length: 500 }, () => ({ label: 'L'.repeat(900) })), limits: Array(100).fill('x') },
      perf: { notes: Array(100).fill('n'), pages: Array(50).fill({}) },
    });
    expect(c.route.length).toBeLessThanOrEqual(200);
    expect(c.wb.rows.length).toBeLessThanOrEqual(40);
    expect(c.wb.rows[0].label.length).toBeLessThanOrEqual(80);
    expect(c.wb.limits.length).toBeLessThanOrEqual(12);
    expect(c.perf.notes.length).toBeLessThanOrEqual(10);
    expect(c.perf.pages.length).toBeLessThanOrEqual(10);
  });
});
