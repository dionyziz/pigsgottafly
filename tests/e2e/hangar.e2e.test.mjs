// End-to-end test of the aircraft page: the stations grid lines up, the envelope charts scroll with
// their tables (not sticky), the item 18 field warns only about indicators the flight plan drops,
// the approved fuels, and the photo and documents (chunked upload through the file inputs, the PDF
// opened in the in-app viewer).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, startServer } from './harness.mjs';
import { fleetSeed } from '../../tools/build_seed.ts';

let server, browser, page, tmp;
before(async () => {
  server = await startServer();
  browser = await launch();
  page = await browser.newPage();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pgf-hangar-'));
});
after(async () => { await page?.close(); await browser?.close(); await server?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const api = async (method, p, body) => {
  const r = await fetch(`${server.url}/api/${p}`, { method, headers: method !== 'GET' ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return r.status === 204 ? null : r.json();
};
/** Puts a file on disk into an <input type=file> (CDP) and fires change. */
async function setFile(selector, file) {
  const { root } = await page.send('DOM.getDocument', {});
  const { nodeId } = await page.send('DOM.querySelector', { nodeId: root.nodeId, selector });
  await page.send('DOM.setFileInputFiles', { nodeId, files: [file] });
}
function pdfFile(bytes) {
  // a valid one-page PDF, padded with a comment so that it takes more than one upload chunk
  const head = '%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] >> endobj\n';
  const buf = Buffer.concat([Buffer.from(head, 'latin1'), Buffer.alloc(bytes, 0x25), Buffer.from('\ntrailer << /Root 1 0 R >>\n%%EOF\n', 'latin1')]);
  const f = path.join(tmp, 'POH.pdf');
  fs.writeFileSync(f, buf);
  return { f, buf };
}

test('aircraft page: layout, item 18, fuels, photo and documents', async () => {
  await api('PUT', 'me', { fullName: 'Test Pilot', phone: '+30 690 000 0000', homeAerodrome: 'LGTT' });
  const [asv] = fleetSeed();
  const ac = await api('POST', 'aircraft', { ...asv, equipment: { ...asv.equipment, item18Extras: 'NAV/SBAS RMK/GARMIN GNS430W' } });
  await page.viewport(1400, 1000);
  await page.goto(`${server.url}/hangar/${ac.id}`);
  await page.waitFor(() => !!document.querySelector('[data-testid=aircraft-page]'));

  // item 18: NAV/ and RMK/ are kept by the flight plan, so no warning
  assert.equal(await page.eval(() => [...document.querySelectorAll('#fpl .issue')].map((e) => e.textContent).join('|')), '');
  // approved fuels: AVGAS and MOGAS rows
  assert.deepEqual(await page.eval(() => [...document.querySelectorAll('.fuel-tbl tbody td.mono')].map((e) => e.textContent)), ['AVGAS', 'MOGAS']);

  // stations: in every row the controls start at one height, and each column's controls share left and right edges
  const grid = await page.eval(() => [...document.querySelectorAll('.ed-table.stations tbody tr')].map((tr) => [...tr.children].map((td) => {
    const c = td.querySelector('input, select, .cell-na, button');
    const r = c.getBoundingClientRect();
    return { top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right) };
  })));
  for (const row of grid) assert.ok(Math.max(...row.map((c) => c.top)) - Math.min(...row.map((c) => c.top)) <= 1, `row tops ${JSON.stringify(row)}`);
  for (const col of [0, 1, 2]) assert.equal(new Set(grid.map((row) => row[col].left)).size, 1, `column ${col} left edges`);
  assert.equal(new Set(grid.map((row) => row[2].right)).size, 1, 'arm column right edges');
  assert.equal(new Set(grid.map((row) => row[4].right)).size, 1, 'max load column right edges');

  // envelope charts are in normal flow next to their tables
  assert.deepEqual(await page.eval(() => [...document.querySelectorAll('.env-row .chart-col')].map((e) => getComputedStyle(e).position)), ['static', 'static']);
  const side = await page.eval(() => [...document.querySelectorAll('.env-row')].map((row) => {
    const [t, c] = [...row.children].map((x) => x.getBoundingClientRect());
    return c.left > t.right - 1 && c.top < t.bottom;
  }));
  assert.deepEqual(side, [true, true]);

  // documents: a PDF bigger than one chunk goes up through the file input and opens in the viewer
  const { f, buf } = pdfFile(2 * 1024 * 1024 + 1000);
  await page.eval(() => document.getElementById('documents').scrollIntoView());
  await page.type('.doc-add input[aria-label="New document title"]', 'POH');
  await setFile('[data-testid=doc-file]', f);
  await page.waitFor(() => !!document.querySelector('[data-testid=doc-open]'), { timeout: 20000 });
  const files = await api('GET', `aircraft/${ac.id}/files`);
  assert.equal(files.documents.length, 1);
  assert.deepEqual([files.documents[0].title, files.documents[0].size, files.documents[0].chunks], ['POH', buf.length, 2]);
  await page.click('[data-testid=doc-open]');
  await page.waitFor(() => /^blob:/.test(document.querySelector('[data-testid=pdf-frame]')?.src || ''), { timeout: 15000 });
  await page.key('Escape');
  await page.waitFor(() => !document.querySelector('[data-testid=pdf-viewer]'));

  // photo: a large PNG is resized to at most 1600 px and shown in the header and on the hangar card
  const png = await page.eval(async () => {
    const c = document.createElement('canvas'); c.width = 3000; c.height = 2000;
    const g = c.getContext('2d'); g.fillStyle = '#5b9bd5'; g.fillRect(0, 0, 3000, 2000);
    const b = await new Promise((r) => c.toBlob(r, 'image/png'));
    const bytes = new Uint8Array(await b.arrayBuffer());
    let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  });
  fs.writeFileSync(path.join(tmp, 'plane.png'), Buffer.from(png, 'base64'));
  await page.eval(() => window.scrollTo(0, 0));
  await setFile('[data-testid=photo-file]', path.join(tmp, 'plane.png'));
  await page.waitFor(() => !!document.querySelector('.ac-photo.head img'), { timeout: 20000 });
  const dims = await page.eval(() => { const i = document.querySelector('.ac-photo.head img'); return [i.naturalWidth, i.naturalHeight]; });
  assert.deepEqual(dims, [1600, 1067]);
  assert.equal((await api('GET', `aircraft/${ac.id}/files`)).photo.mime, 'image/jpeg');
  await page.goto(`${server.url}/hangar`);
  await page.waitFor((id) => !!document.querySelector(`[data-aircraft-id="${id}"] .ac-photo.card img`), { args: [ac.id] });
  assert.deepEqual(page.errors, []);
});
