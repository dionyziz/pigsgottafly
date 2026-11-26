// The W&B and performance PDF e-mailed to an operator is the website's own print of the sheets
// (api/_lib/sheetPdf.ts: headless Chromium on the built PDF page, src/pdf/), drawn from the content
// the pilot sent:
//   - the page is served from the build on disk only: no other path, no other method, no network
//     (the browser has no session and reaches no API);
//   - the send uses the print, with the server's identifying fields and the PIC's signature; when the
//     print fails the server's own PDF writer sends the sheets and the failure is in app_errors;
//   - with a Chrome/Chromium on this machine (CHROME, or a local install): the real print of a fixture
//     flight, built from the sheet models, is a vector PDF of the website's sheets (text the server's
//     writer never prints). Skipped only when no Chrome/Chromium is found.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';

import { type SentMail, setMailTransport } from '../../api/_lib/mail';
import {
  chromiumFaxPdf,
  chromiumNavlogPdf,
  chromiumSheetPdf,
  localChrome,
  servedFile,
  type SheetSignature,
} from '../../api/_lib/sheetPdf';
import { REF, runwaysOf, SUN_TABLES } from '../../src/data/ref';
import { AERODROMES as aerodromes } from '../../src/data/ref';
import { perfSheetModel } from '../../src/features/exports/performance/model';
import { computeExportCalc } from '../../src/features/exports/wb/exportCalc';
import { wbSheetModel } from '../../src/features/exports/wb/model';
import { wbPerfContent } from '../../src/features/exports/wbperf/declaration';
import {
  type Aircraft,
  type DeclarationsState,
  emptyFlightDoc,
  type FlightDoc,
  type HangarAircraft,
  type OperatorItem,
  type PersonDetails,
  type Pilot,
  type WbPerfContent,
} from '../../src/shared';
import type { RefAerodrome } from '../../src/shared/ref';
import type { RoutePoint } from '../../src/shared/types';
import { fleetSeed } from '../../tools/build_seed';
import { fixtureNavlog, NAVLOG_POINTS } from '../helpers/navlogFixture';
import { type Client, client, startApi } from './helpers';

const ROOT = path.resolve(__dirname, '../..');
const ADS = ((aerodromes as any).aerodromes ?? aerodromes) as RefAerodrome[];
const pt = (icao: string, uid: string): RoutePoint => {
  const a = ADS.find((x) => x.icao === icao)!;
  return { uid, kind: 'aerodrome', refId: a.id, name: icao, lat: a.lat, lon: a.lon };
};

// ------------------------------------------------------------------------------------------------
// a fixture flight's sheets, as the export page builds them (SX-ASV, LGTT → LGMG, two on board)

const ASV: Aircraft = { ...structuredClone(fleetSeed()[0]), id: 'ac_asv', created: 0, updated: 0 };
const pilot = {
  fullName: 'Pat Pilot',
  weightKg: 80,
  settings: { taxiOutMin: 15, taxiInMin: 15, reserveMin: 60, finalReserveMin: 0, enrouteAerodromeRadiusNm: 2 },
} as unknown as Pilot;
const person = (fullName: string, weightKg: number): PersonDetails => ({
  fullName,
  phone: '',
  dateOfBirth: null,
  weightKg,
  idNumber: '',
  idType: '',
  nationality: '',
  relation: '',
});
function fixtureContent(): WbPerfContent {
  const doc: FlightDoc = {
    ...emptyFlightDoc('2026-11-21'),
    blockOff: '09:00',
    taxiOutMin: 15,
    taxiInMin: 15,
    aircraftId: ASV.id,
    route: [pt('LGTT', 'a'), pt('LGMG', 'b')],
    crew: [
      { role: 'PIC', passengerId: null, seat: 'front-left', snapshot: person('Pat Pilot', 80) },
      { role: 'PAX', passengerId: 'p1', seat: 'rear-left', snapshot: person('Robin Rider', 70) },
    ],
    baggageKg: { bag1: 10 },
    fobL: 100,
  };
  const calc = computeExportCalc({
    doc,
    aircraft: ASV,
    settings: pilot.settings,
    weather: null,
    metar: null,
    nowMs: Date.parse('2026-11-15T12:00:00Z'),
    ref: {
      aerodromes: REF.aerodromes,
      vfrPoints: REF.vfrPoints,
      vfrRoutes: REF.vfrRoutes,
      sunTables: SUN_TABLES,
      runwaysOf,
    },
  });
  return wbPerfContent(
    wbSheetModel({ doc, aircraft: ASV, pilot, calc, route: 'LGTT – LGMG' }),
    perfSheetModel({ doc, aircraft: ASV, pilot, calc }),
  );
}

// ------------------------------------------------------------------------------------------------

describe('the PDF page is served from the build on disk, and nothing else', () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'pgf-sheets-'));
  fs.mkdirSync(path.join(dist, 'assets'));
  fs.writeFileSync(path.join(dist, 'pdf.html'), '<!doctype html>');
  fs.writeFileSync(path.join(dist, 'assets', 'a.js'), '');
  fs.writeFileSync(path.join(dist, 'assets', 'a.js.map'), '');
  fs.writeFileSync(path.join(path.dirname(dist), 'pgf-secret.css'), '');
  const O = 'https://sheets.pdf.invalid';
  afterAll(() => fs.rmSync(dist, { recursive: true, force: true }));

  test('files of the build, under the page origin', () => {
    expect(servedFile(dist, `${O}/pdf.html`)).toBe(path.join(dist, 'pdf.html'));
    expect(servedFile(dist, `${O}/assets/a.js?v=1`)).toBe(path.join(dist, 'assets', 'a.js'));
  });
  test('no other origin, no path out of the build, no unknown file type, no directory', () => {
    expect(servedFile(dist, 'https://pigsgottafly.com/pdf.html')).toBeNull();
    expect(servedFile(dist, 'http://127.0.0.1:8765/api/me')).toBeNull();
    expect(servedFile(dist, `${O}.evil.example/pdf.html`)).toBeNull();
    expect(servedFile(dist, `${O}/../pgf-secret.css`)).toBeNull();
    expect(servedFile(dist, `${O}/%2e%2e/pgf-secret.css`)).toBeNull();
    expect(servedFile(dist, `${O}/assets/..%2f..%2fpgf-secret.css`)).toBeNull();
    expect(servedFile(dist, `${O}/assets/a.js.map`)).toBeNull();
    expect(servedFile(dist, `${O}/api/me`)).toBeNull();
    expect(servedFile(dist, `${O}/assets`)).toBeNull();
    expect(servedFile(dist, `${O}/`)).toBeNull();
  });
});

describe('sending: the print of the sheets, else the server’s own PDF', () => {
  let api: Awaited<ReturnType<typeof startApi>>;
  let owner: Client;
  let render: (c: WbPerfContent, s: SheetSignature | null) => Promise<Buffer>;
  const sent: SentMail[] = [];
  let flightId = '';
  beforeAll(async () => {
    api = await startApi({ sheetPdf: (c, s) => render(c, s) });
    owner = client(api.base);
    await owner.login('sheets-owner', 'olga@example.com');
    await owner.call('PUT', 'me', { fullName: 'Olga Owner' });
    const o = (await owner.call<OperatorItem>('POST', 'operators', { name: 'Sheets Club' })).body;
    await owner.call('PUT', `operators/${o.id}`, { requiresWbPerf: true, declarationsEmail: 'ops@club.example' });
    const ac = (
      await owner.call<HangarAircraft>('POST', 'aircraft', {
        ...fleetSeed()[0],
        registration: 'SX-PDF',
        operatorId: o.id,
      })
    ).body;
    flightId = (
      await owner.call('POST', 'flights', {
        aircraftId: ac.id,
        date: '2026-12-01',
        route: [pt('LGTT', 'a'), pt('LGSY', 'b'), pt('LGMG', 'c')],
      })
    ).body.id;
  });
  afterAll(() => api.close());
  afterEach(() => setMailTransport(null));
  const db = async () => (await api.server.ready).db;
  const send = async () => {
    // a flight's form goes out at most once every 10 minutes (sendCaps.ts): that pause, passed
    await (await db()).query('UPDATE mail_log SET at = at - 660000 WHERE flight_id = $1', [flightId]);
    return owner.call<DeclarationsState>('POST', `flights/${flightId}/declarations/send`, {
      content: { ...fixtureContent(), pilot: 'Someone Else', route: 'XXXX', registration: 'SX-NOT' },
      resend: true,
    });
  };

  test('the print is attached, drawn from the content with the server’s identifying fields', async () => {
    setMailTransport(async (m) => (sent.push(m), { id: `m-${sent.length}` }));
    const seen: { c: WbPerfContent; s: SheetSignature | null }[] = [];
    render = async (c, s) => (seen.push({ c, s }), Buffer.from('%PDF-1.7 printed'));
    const r = await send();
    expect(r.status).toBe(200);
    expect(sent.at(-1)!.attachments![0].content.toString()).toBe('%PDF-1.7 printed');
    expect(seen).toHaveLength(1);
    expect(seen[0].c).toMatchObject({ registration: 'SX-PDF', pilot: 'Olga Owner', route: 'LGTT – LGSY – LGMG' });
    expect(seen[0].c.perf.pages[0].takeoff.rows.length).toBeGreaterThan(3);
    expect(seen[0].s).toMatchObject({ name: 'Olga Owner' });
    expect(Math.abs(Date.now() - seen[0].s!.signedAt)).toBeLessThan(60e3);
    // "changed since sent" is the hash of what the pilot sent
    expect(r.body.submission?.hash).toBeTruthy();
  });

  test('a failed print: the server’s own PDF goes out and the failure is recorded', async () => {
    setMailTransport(async (m) => (sent.push(m), { id: `m-${sent.length}` }));
    render = async () => {
      throw new Error('Chromium did not start');
    };
    const r = await send();
    expect(r.status).toBe(200);
    const pdf = sent.at(-1)!.attachments![0].content;
    expect(pdf.subarray(0, 8).toString()).toBe('%PDF-1.4');
    const text = [...pdf.toString('latin1').matchAll(/stream\n([\s\S]*?)\nendstream/g)]
      .map((m) => {
        try {
          return zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1');
        } catch {
          return '';
        }
      })
      .join('\n');
    expect(text).toContain('(LOADING SHEET)');
    const [err] = await (await db()).query(`SELECT * FROM app_errors WHERE message LIKE '%the print failed%'`);
    expect(err).toMatchObject({ kind: 'server', route: '/flights/:id/declarations/send' });
    expect(err.message).toContain('Chromium did not start');
  });
});

// ------------------------------------------------------------------------------------------------
// The real print (headless Chrome/Chromium)

const chrome = localChrome();
if (!chrome) console.warn('sheetPdf.test: no Chrome/Chromium found (set CHROME): the real print tests are skipped');

describe.skipIf(!chrome)('the real print in headless Chromium', () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'pgf-sheets-build-'));
  const out = process.env.SHEET_PDF_OUT; // keep the PDF (e.g. to look at it)
  beforeAll(async () => {
    // the PDF page as the deployment builds it (vite.config.ts), into a temporary directory
    const { build } = await import('vite');
    await build({
      root: ROOT,
      configFile: path.join(ROOT, 'vite.config.ts'),
      logLevel: 'error',
      build: { outDir: dist, emptyOutDir: true, sourcemap: false, rolldownOptions: { input: { pdf: 'pdf.html' } } },
    });
  }, 120e3);
  afterAll(() => fs.rmSync(dist, { recursive: true, force: true }));

  test('a fixture flight: the website’s sheets, as vector text, one page per sheet', async () => {
    const content = fixtureContent();
    expect(content.perf.pages).toHaveLength(1);
    const t0 = Date.now();
    const pdf = await chromiumSheetPdf({ distDir: dist })(content, {
      name: 'Pat Pilot',
      signedAt: Date.UTC(2026, 10, 21, 8, 0),
    });
    console.info(`sheetPdf.test: printed by ${chrome} in ${Date.now() - t0} ms, ${pdf.length} bytes`);
    if (out) fs.writeFileSync(out, pdf);
    const raw = pdf.toString('latin1');
    expect(raw.startsWith('%PDF-')).toBe(true);
    // Chromium's PDF (Skia), not the server's writer; the loading sheet + one performance page
    expect(raw).toMatch(/Skia\/PDF/);
    expect(raw).toMatch(/\/Type\s*\/Pages[\s\S]{0,200}?\/Count 2\b/);
    // embedded fonts: the sheets' Arial (Arimo where Arial is not installed), the signature's handwriting
    const fonts = [...raw.matchAll(/\/BaseFont\s*\/([A-Za-z0-9+_-]+)/g)].map((m) => m[1]);
    expect(
      fonts.some((f) => /^[A-Z]{6}\+(Arial|Arimo)/.test(f)),
      fonts.join(' '),
    ).toBe(true);
    expect(
      fonts.some((f) => /^[A-Z]{6}\+HomemadeApple/.test(f)),
      fonts.join(' '),
    ).toBe(true);
    let text = '';
    try {
      const file = path.join(dist, 'sheets.pdf');
      fs.writeFileSync(file, pdf);
      text = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
    } catch {
      console.warn('sheetPdf.test: no pdftotext: the text of the print is not checked');
    }
    if (text) {
      expect(text).toContain('LOADING SHEET');
      expect(text).toContain('PERFORMANCE LOG');
      // the performance cards and runway diagrams of the website (never printed by the server's writer)
      expect(text).toMatch(/Take-off\s+09:15Z/);
      expect(text).toMatch(/HW \d+ kt/);
      expect(text).toContain('CENTRE OF GRAVITY MOMENT ENVELOPE');
      expect(text).toContain('LOADED AIRCRAFT MOMENT');
      expect(text).toContain('Electronically signed 2026-11-21 08:00Z');
    }
  }, 60e3);

  test('a fixture navlog: the website’s MD 4.2 sheets, A4 landscape, one page per sheet', async () => {
    const content = fixtureNavlog();
    expect(content.sheets).toHaveLength(2);
    const t0 = Date.now();
    const pdf = await chromiumNavlogPdf({ distDir: dist })(content);
    console.info(`sheetPdf.test: navlog printed in ${Date.now() - t0} ms, ${pdf.length} bytes`);
    if (process.env.NAVLOG_PDF_OUT) fs.writeFileSync(process.env.NAVLOG_PDF_OUT, pdf);
    const raw = pdf.toString('latin1');
    expect(raw).toMatch(/Skia\/PDF/);
    expect(raw).toMatch(/\/Type\s*\/Pages[\s\S]{0,200}?\/Count 2\b/);
    const boxes = [...raw.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)].map((m) => [+m[1], +m[2]]);
    expect(boxes.length).toBeGreaterThan(0);
    for (const [w, h] of boxes) {
      expect(Math.abs(w - 841.92)).toBeLessThan(2);
      expect(Math.abs(h - 595.92)).toBeLessThan(2);
    }
    let text = '';
    try {
      const file = path.join(dist, 'navlog.pdf');
      fs.writeFileSync(file, pdf);
      text = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
    } catch {
      console.warn('sheetPdf.test: no pdftotext: the text of the navlog print is not checked');
    }
    if (text) {
      const pages = text.split('\f');
      expect(pages[0]).toContain('Flight Planner');
      expect(pages[1]).toContain('Flight Planner');
      expect(text).toContain('Terminal Information');
      expect(text).toContain('DEPARTURE');
      expect(text).toContain('SX-ASV');
      expect(text).toContain('2026-11-21');
      for (const name of NAVLOG_POINTS) expect(text).toContain(name);
      expect(pages[1]).toContain('LGMG');
    }
  }, 60e3);

  test('a faxed flight plan: the cover page and the filled ICAO form, A4 portrait', async () => {
    const fpl =
      '(FPL-SXASV-VG\n-C172/L-SDFGY/C\n-LGTT0800\n-N0092VFR DCT\n-LGMG0030 LGAV\n-DOF/261116 REG/SXASV\n-E/0400 P/002 R/VE A/WHITE BLUE C/PILOT P +30 6900000000)';
    const pdf = await chromiumFaxPdf({ distDir: dist })({
      kind: 'file',
      to: { number: '+302103532635', unit: 'Athens Central AIS' },
      from: { name: 'Pat Pilot', phone: '+30 6900000000', email: 'pat@example.com' },
      fpl,
      addresses: ['LGGGZFZX', 'LGTTZTZX'],
      message: fpl,
      sentAt: Date.UTC(2026, 10, 16, 7, 0),
      signature: { name: 'Pat Pilot', signedAt: Date.UTC(2026, 10, 16, 7, 0) },
    });
    if (process.env.FAX_PDF_OUT) fs.writeFileSync(process.env.FAX_PDF_OUT, pdf);
    const raw = pdf.toString('latin1');
    expect(raw).toMatch(/Skia\/PDF/);
    expect(raw).toMatch(/\/Type\s*\/Pages[\s\S]{0,200}?\/Count 2\b/);
    const boxes = [...raw.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)].map((m) => [+m[1], +m[2]]);
    for (const [w, h] of boxes) {
      expect(Math.abs(w - 595.92)).toBeLessThan(2);
      expect(Math.abs(h - 841.92)).toBeLessThan(2);
    }
    let text = '';
    try {
      const file = path.join(dist, 'fax.pdf');
      fs.writeFileSync(file, pdf);
      text = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
    } catch {
      console.warn('sheetPdf.test: no pdftotext: the text of the fax is not checked');
    }
    if (text) {
      const [cover, form] = text.split('\f');
      expect(cover).toContain('FAX');
      expect(cover).toContain('Athens Central AIS, fax +30 210 3532635');
      expect(cover).toContain('Pat Pilot, pilot in command');
      expect(cover).toContain('(FPL-SXASV-VG');
      expect(cover).toContain('Please acknowledge receipt to +30 6900000000 or pat@example.com.');
      expect(form).toContain('FLIGHT PLAN');
      expect(form).toContain('PILOT P +30 6900000000');
      expect(form).toContain('WHITE BLUE');
      expect(form).toMatch(/L\s*G\s*G\s*G\s*Z\s*F\s*Z\s*X/);
    }
  }, 60e3);

  test('the page sees the content as data and reaches nothing: no network, no API, no other file', async () => {
    // a page of our own in the build, which reports what it can reach
    const probe = path.join(dist, 'probe');
    fs.rmSync(probe, { recursive: true, force: true });
    fs.mkdirSync(probe);
    fs.copyFileSync(path.join(dist, 'pdf.html'), path.join(probe, 'keep.html'));
    fs.writeFileSync(
      path.join(probe, 'pdf.html'),
      `<!doctype html><html><body><script>
        const tries = [fetch('https://example.com/'), fetch('/api/me'), fetch('/../package.json'),
          fetch('/pdf.html', { method: 'POST' }), fetch('http://127.0.0.1:8765/api/me'), fetch('/pdf.html')];
        Promise.allSettled(tries).then((r) => {
          const got = r.map((x) => x.status === 'fulfilled' ? 'ok' : 'no').join(',');
          document.body.textContent = got + ' ' + JSON.stringify(window.__PGF_SHEETS__.content.wb.rows[0]);
          document.documentElement.dataset.pdfReady = got === 'no,no,no,no,no,ok' ? 'true' : 'leak:' + got;
        });
      </script></body></html>`,
    );
    const pdf = await chromiumSheetPdf({ distDir: probe, timeoutMs: 15e3 })(fixtureContent(), null);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    // a page that does not render is an error (the caller falls back)
    fs.writeFileSync(path.join(probe, 'pdf.html'), '<!doctype html><p>never ready</p>');
    await expect(chromiumSheetPdf({ distDir: probe, timeoutMs: 4000 })(fixtureContent(), null)).rejects.toThrow(
      /did not render|timed out/,
    );
    await expect(chromiumSheetPdf({ distDir: path.join(dist, 'nowhere') })(fixtureContent(), null)).rejects.toThrow(
      /not built/,
    );
  }, 60e3);
});
