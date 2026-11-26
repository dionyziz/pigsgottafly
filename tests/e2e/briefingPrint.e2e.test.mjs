// The NOTAM briefing printed: a long list runs over several A4 pages, each with its own margins (the page's,
// not only the sheet's padding on the first), no NOTAM cut at the page edge.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test, { after, before } from 'node:test';

import { fleetSeed } from '../../tools/build_seed.ts';
import { launch, startServer } from './harness.mjs';
import { refJson } from './refInEffect.mjs';

const AD = refJson('aerodromes.json');
const ad = (id) => {
  const a = AD.find((x) => x.id === id);
  return { uid: id, kind: 'aerodrome', refId: a.id, name: id, lat: a.lat, lon: a.lon };
};
const G = 2 ** 30 / 90; // autorouter's coordinate unit
const date = new Date(Date.now() + 86400e3).toISOString().slice(0, 10);
const at = (hhmm) => Math.floor(Date.parse(`${date}T${hhmm}:00Z`) / 1000);

const NOTAMS = Array.from({ length: 40 }, (_, i) => ({
  id: i + 1,
  series: 'A',
  number: 9100 + i,
  year: 26,
  type: 'N',
  fir: 'LGGG',
  code23: 'RT',
  code45: 'CA',
  traffic: 'IV',
  purpose: 'BO',
  scope: 'W',
  lower: 0,
  upper: 50,
  lat: Math.round((38.0 + (i % 8) * 0.01) * G),
  lon: Math.round(23.6 * G),
  radius: 3,
  itema: ['LGGG'],
  startvalidity: at('06:00'),
  endvalidity: at('18:00'),
  iteme: `TEMPO RESTRICTED AREA ${i + 1} ACTIVATED FOR MILITARY EXERCISES. ` + 'ALL VFR TRAFFIC TO AVOID. '.repeat(6),
  itemf: 'SFC',
  itemg: '5000FT AMSL',
}));
const autorouterFetch = async (input) => {
  const url = new URL(String(input));
  const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (url.pathname.endsWith('/oauth2/token')) return json({ access_token: 'tok', expires_in: 3600 });
  if (url.pathname.endsWith('/notam')) return json({ total: NOTAMS.length, rows: NOTAMS });
  return new Response(JSON.stringify({ error: 'no such endpoint' }), { status: 404 });
};

let server, browser, page, flightId;
const api = async (method, p, body) => {
  const r = await fetch(`${server.url}/api/${p}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${await r.text()}`);
  return r.json();
};
before(async () => {
  server = await startServer({
    autorouter: { email: 'app@example.com', password: 'x', filing: false, fetch: autorouterFetch },
  });
  await api('PUT', 'me', { fullName: 'Test Pilot', phone: '+30 690 000 0000', homeAerodrome: 'LGTT' });
  const ac = await api('POST', 'aircraft', fleetSeed()[0]);
  const f = await api('POST', 'flights', {
    route: [ad('LGTT'), ad('LGMG')],
    date,
    blockOff: '09:00',
    aircraftId: ac.id,
  });
  flightId = f.id;
  browser = await launch();
  page = await browser.newPage();
  await page.viewport(1400, 900);
});
after(async () => {
  await page?.close();
  await browser?.close();
  await server?.close();
});

/** The text boxes of each page (poppler's pdftotext -bbox), in points; null when poppler is not installed. */
function textBoxes(file) {
  let html;
  try {
    html = execFileSync('pdftotext', ['-bbox', file, '-'], { encoding: 'utf8' });
  } catch {
    return null;
  }
  return html
    .split('<page ')
    .slice(1)
    .map((p) =>
      [...p.matchAll(/xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)"/g)].map((m) =>
        m.slice(1).map(Number),
      ),
    );
}

test('a long briefing prints on several A4 pages, each with margins', async () => {
  await page.goto(`${server.url}/flights/${flightId}/export/briefing`);
  await page.waitFor(() => document.querySelectorAll('.brief-notam').length >= 40, { timeout: 30000 });
  await page.media('print');
  const r = await page.pdf('briefing-print');
  await page.media('');
  assert.ok(r.pages >= 3, `${r.pages} pages`);
  assert.ok(Math.abs(r.width - 595.92) < 2 && Math.abs(r.height - 841.92) < 2, `${r.width}×${r.height}`);
  const pages = textBoxes(r.file);
  if (!pages) return;
  const MM = 72 / 25.4;
  for (const [i, boxes] of pages.entries()) {
    assert.ok(boxes.length, `page ${i + 1} has text`);
    const left = Math.min(...boxes.map((b) => b[0]));
    const top = Math.min(...boxes.map((b) => b[1]));
    const right = Math.max(...boxes.map((b) => b[2]));
    const bottom = Math.max(...boxes.map((b) => b[3]));
    assert.ok(left >= 12 * MM && right <= r.width - 12 * MM, `page ${i + 1}: text from ${left} to ${right} pt`);
    assert.ok(top >= 12 * MM && bottom <= r.height - 12 * MM, `page ${i + 1}: text from ${top} to ${bottom} pt`);
  }
});
