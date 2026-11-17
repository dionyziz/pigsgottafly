// End-to-end test of the aircraft page: the header lines up with the body, edits save on their own
// (no save bar; a bar only for errors, with links to their fields), the section nav follows the
// scroll, the stations grid lines up, the envelope charts scroll with their tables (not sticky), the
// item 18 field warns only about indicators the flight plan drops, the approved fuels, the placeholder
// picture and the photo, and documents (chunked upload through the file inputs, the PDF opened in the
// in-app viewer). The performance tables: units in the headers, speeds in knots, no unit over a value.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';

import { fleetSeed } from '../../tools/build_seed.ts';
import { launch, startServer } from './harness.mjs';

let server, browser, page, tmp;
before(async () => {
  server = await startServer();
  browser = await launch();
  page = await browser.newPage();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pgf-hangar-'));
});
after(async () => {
  await page?.close();
  await browser?.close();
  await server?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});
const shot = async (name) => {
  if (process.env.SHOTS) await page.screenshot(name, { fullPage: false });
};
/** Polls an async condition (in node) until it holds. */
async function until(fn, timeout = 10000) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('until: timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
}

const api = async (method, p, body) => {
  const r = await fetch(`${server.url}/api/${p}`, {
    method,
    headers: method !== 'GET' ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
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
  const head =
    '%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] >> endobj\n';
  const buf = Buffer.concat([
    Buffer.from(head, 'latin1'),
    Buffer.alloc(bytes, 0x25),
    Buffer.from('\ntrailer << /Root 1 0 R >>\n%%EOF\n', 'latin1'),
  ]);
  const f = path.join(tmp, 'POH.pdf');
  fs.writeFileSync(f, buf);
  return { f, buf };
}

test('aircraft page: layout, autosave, item 18, fuels, photo and documents', async () => {
  await api('PUT', 'me', { fullName: 'Test Pilot', phone: '+30 690 000 0000', homeAerodrome: 'LGTT' });
  const [asv] = fleetSeed();
  const ac = await api('POST', 'aircraft', {
    ...asv,
    equipment: { ...asv.equipment, item18Extras: 'NAV/SBAS RMK/GARMIN GNS430W' },
  });
  await page.viewport(1400, 1000);
  await page.goto(`${server.url}/hangar/${ac.id}`);
  await page.waitFor(() => !!document.querySelector('[data-testid=aircraft-page]'));

  // header: the back arrow over the section nav, the photo's left edge on the cards' left edge
  const head = await page.eval(() => {
    const r = (s) => {
      const b = document.querySelector(s).getBoundingClientRect();
      return { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
    };
    return {
      back: r('.ac-head .back'),
      nav: r('.ac-nav'),
      photo: r('.ac-photo.head'),
      card: r('#identity'),
      h1: r('.ac-title h1'),
    };
  });
  assert.ok(head.back.left >= head.nav.left - 1 && head.back.right <= head.nav.right + 1, 'back arrow over the nav');
  assert.ok(
    Math.abs(head.photo.left - head.card.left) <= 1,
    `photo left ${head.photo.left} vs card left ${head.card.left}`,
  );
  assert.ok(head.h1.left > head.photo.right, 'registration beside the photo');
  // no photo yet: the aircraft's own placeholder picture, and "Add photo" inside the box
  assert.ok([1, 2, 3].includes(ac.placeholder), `placeholder ${ac.placeholder}`);
  await page.waitFor(
    (n) => {
      const i = document.querySelector('.ac-photo.head [data-testid=aircraft-placeholder]');
      return i && i.complete && i.naturalWidth === 800 && i.getAttribute('src') === `/aircraft/placeholder-${n}.webp`;
    },
    { args: [ac.placeholder] },
  );
  const overlay = await page.eval(() => {
    const o = document.querySelector('[data-testid=photo-pick]').getBoundingClientRect();
    const p = document.querySelector('.ac-photo.head').getBoundingClientRect();
    return {
      inside: o.left >= p.left - 1 && o.right <= p.right + 1 && o.top >= p.top - 1 && o.bottom <= p.bottom + 1,
      text: document.querySelector('[data-testid=photo-pick]').textContent,
    };
  });
  assert.deepEqual(overlay, { inside: true, text: 'Add photo' });
  // nothing edited: no status, no bar
  assert.equal(await page.eval(() => document.querySelector('[data-testid=save-status]').textContent), '');
  assert.equal(await page.eval(() => !!document.querySelector('.ac-savebar, [data-testid=problem-bar]')), false);
  await shot('aircraft-head');
  const ph = await page.eval(() => {
    const b = document.querySelector('.ac-head-photo').getBoundingClientRect();
    return [b.left + b.width / 2, b.top + b.height / 2];
  });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ph[0], y: ph[1] });
  await page.waitFor(() => getComputedStyle(document.querySelector('[data-testid=photo-pick]')).opacity === '1');
  await shot('aircraft-head-hover');
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 600 });

  // the section nav follows the scroll; a click scrolls there and puts it in the URL
  const activeNav = () => page.eval(() => document.querySelector('.ac-nav a.active > span')?.textContent);
  assert.equal(await activeNav(), 'Identity');
  await page.eval(() => {
    const e = document.getElementById('fuel');
    window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - 80);
  });
  await page.waitFor(() => document.querySelector('.ac-nav a.active > span')?.textContent === 'Fuel');
  await page.eval(() => {
    const e = document.getElementById('mb');
    window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - 80);
  });
  await page.waitFor(() => document.querySelector('.ac-nav a.active > span')?.textContent === 'Mass and balance');
  await shot('aircraft-scrollspy');
  await page.eval(() =>
    [...document.querySelectorAll('.ac-nav a')].find((a) => a.firstChild.textContent === 'Performance').click(),
  );
  await page.waitFor(
    () =>
      location.hash === '#performance' &&
      document.querySelector('.ac-nav a.active > span')?.textContent === 'Performance',
  );
  await page.waitFor(() => Math.abs(document.getElementById('performance').getBoundingClientRect().top - 80) < 40, {
    timeout: 5000,
  });
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal(await activeNav(), 'Performance');
  await page.eval(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitFor(() => document.querySelector('.ac-nav a.active > span')?.textContent === 'Documents');
  await page.eval(() => window.scrollTo(0, 0));
  await page.waitFor(() => document.querySelector('.ac-nav a.active > span')?.textContent === 'Identity');

  // item 18: NAV/ and RMK/ are kept by the flight plan, so no warning
  assert.equal(
    await page.eval(() => [...document.querySelectorAll('#fpl .issue')].map((e) => e.textContent).join('|')),
    '',
  );
  // approved fuels: AVGAS and MOGAS rows
  assert.deepEqual(
    await page.eval(() => [...document.querySelectorAll('.fuel-tbl tbody td.mono')].map((e) => e.textContent)),
    ['AVGAS', 'MOGAS'],
  );

  // stations: in every row the controls start at one height, and each column's controls share left and right edges
  const grid = await page.eval(() =>
    [...document.querySelectorAll('.ed-table.stations tbody tr')].map((tr) =>
      [...tr.children].map((td) => {
        const c = td.querySelector('input, select, .cell-na, button');
        const r = c.getBoundingClientRect();
        return { top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right) };
      }),
    ),
  );
  for (const row of grid)
    assert.ok(
      Math.max(...row.map((c) => c.top)) - Math.min(...row.map((c) => c.top)) <= 1,
      `row tops ${JSON.stringify(row)}`,
    );
  // (column 0 is the drag handle)
  for (const col of [0, 1, 2, 3])
    assert.equal(new Set(grid.map((row) => row[col].left)).size, 1, `column ${col} left edges`);
  assert.equal(new Set(grid.map((row) => row[3].right)).size, 1, 'arm column right edges');
  assert.equal(new Set(grid.map((row) => row[5].right)).size, 1, 'max load column right edges');
  // numbers are right-aligned in the tables
  assert.deepEqual(
    await page.eval(() => [
      ...new Set(
        [...document.querySelectorAll('.ed-table.stations .numfield input, .pt-table .numfield input')].map(
          (i) => getComputedStyle(i).textAlign,
        ),
      ),
    ]),
    ['right'],
  );

  // stations reorder by dragging the handle; the order is saved
  const ids = () => api('GET', `aircraft/${ac.id}`).then((x) => x.massBalance.stations.map((s) => s.id));
  const before = await ids();
  const [from, to] = await page.eval(() => {
    const rows = [...document.querySelectorAll('.ed-table.stations tbody tr')];
    rows[0].scrollIntoView({ block: 'center' });
    const h = rows[0].querySelector('.drag-handle').getBoundingClientRect();
    const r = rows[1].getBoundingClientRect();
    return [
      [h.left + h.width / 2, h.top + h.height / 2],
      [h.left + h.width / 2, r.top + r.height * 0.75],
    ];
  });
  const mouse = (type, [x, y], extra = {}) =>
    page.send('Input.dispatchMouseEvent', {
      type,
      x,
      y,
      button: 'left',
      buttons: type === 'mouseReleased' ? 0 : 1,
      clickCount: 1,
      ...extra,
    });
  await mouse('mousePressed', from);
  await mouse('mouseMoved', [from[0], (from[1] + to[1]) / 2]);
  await mouse('mouseMoved', to);
  await mouse('mouseReleased', to);
  // saved on its own: "Saved" next to the registration, and no save bar
  await until(async () => JSON.stringify(await ids()) === JSON.stringify([before[1], before[0], ...before.slice(2)]));
  await page.waitFor(() => document.querySelector('[data-testid=save-status]')?.textContent === 'Saved');
  assert.equal(await page.eval(() => !!document.querySelector('.ac-savebar, [data-testid=problem-bar]')), false);

  // typing: one save after the pause, with the whole text
  await page.eval(() => window.scrollTo(0, 0));
  await page.type('input[name=colours]', 'WHITE RED STRIPES');
  await page.waitFor(() => /Saving/.test(document.querySelector('[data-testid=save-status]')?.textContent));
  await shot('aircraft-saving');
  await until(async () => (await api('GET', `aircraft/${ac.id}`)).colours === 'WHITE RED STRIPES');
  await page.waitFor(() => document.querySelector('[data-testid=save-status]')?.textContent === 'Saved');

  // an error holds the save back: a bar lists it, and its link focuses the input
  await page.eval(() => window.scrollTo(0, document.body.scrollHeight));
  await page.type('input[name="fuel.usableL"]', '999');
  await page.blur();
  await page.waitFor(() => !!document.querySelector('[data-testid=problem-bar] [data-testid=issue-go]'));
  assert.equal(await page.eval(() => document.querySelector('[data-testid=save-status]').textContent), 'Not saved');
  await shot('aircraft-error-bar');
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal((await api('GET', `aircraft/${ac.id}`)).fuel.usableL, 144);
  await page.eval(() =>
    [...document.querySelectorAll('[data-testid=problem-bar] [data-testid=issue-go]')]
      .find((b) => /more than the total capacity/.test(b.textContent))
      .click(),
  );
  await page.waitFor(
    () =>
      document.activeElement?.getAttribute('name') === 'fuel.usableL' &&
      document.activeElement.classList.contains('attention'),
  );
  await page.type('input[name="fuel.usableL"]', '140');
  await page.blur();
  await page.waitFor(() => !document.querySelector('[data-testid=problem-bar]'));
  await until(async () => (await api('GET', `aircraft/${ac.id}`)).fuel.usableL === 140);

  // envelope charts are in normal flow next to their tables
  assert.deepEqual(
    await page.eval(() =>
      [...document.querySelectorAll('.env-row .chart-col')].map((e) => getComputedStyle(e).position),
    ),
    ['static', 'static'],
  );
  const side = await page.eval(() =>
    [...document.querySelectorAll('.env-row')].map((row) => {
      const [t, c] = [...row.children].map((x) => x.getBoundingClientRect());
      return c.left > t.right - 1 && c.top < t.bottom;
    }),
  );
  assert.deepEqual(side, [true, true]);

  // documents: a PDF bigger than one chunk goes up through the file input and opens in the viewer
  const { f, buf } = pdfFile(2 * 1024 * 1024 + 1000);
  await page.eval(() => document.getElementById('documents').scrollIntoView());
  await page.type('.doc-add input[aria-label="New document title"]', 'POH');
  await setFile('[data-testid=doc-file]', f);
  await page.waitFor(() => !!document.querySelector('[data-testid=doc-open]'), { timeout: 20000 });
  const files = await api('GET', `aircraft/${ac.id}/files`);
  assert.equal(files.documents.length, 1);
  assert.deepEqual(
    [files.documents[0].title, files.documents[0].size, files.documents[0].chunks],
    ['POH', buf.length, 2],
  );
  await page.click('[data-testid=doc-open]');
  await page.waitFor(() => /^blob:/.test(document.querySelector('[data-testid=pdf-frame]')?.src || ''), {
    timeout: 15000,
  });
  await page.key('Escape');
  await page.waitFor(() => !document.querySelector('[data-testid=pdf-viewer]'));

  // compass swing report: a PDF attached to the first card opens in the same viewer
  const small = path.join(tmp, 'swing.pdf');
  fs.writeFileSync(small, pdfFile(10).buf);
  await page.eval(() => document.getElementById('compass').scrollIntoView());
  await setFile('[data-testid=compass-card] [data-testid=swing-report-file]', small);
  await page.waitFor(() => !!document.querySelector('[data-testid=compass-card] [data-testid=swing-report-open]'), {
    timeout: 15000,
  });
  await page.click('[data-testid=compass-card] [data-testid=swing-report-open]');
  await page.waitFor(
    () => /^blob:/.test(document.querySelector('[data-testid=swing-report-viewer] [data-testid=pdf-frame]')?.src || ''),
    { timeout: 15000 },
  );
  await page.key('Escape');
  await page.waitFor(() => !document.querySelector('[data-testid=swing-report-viewer]'));

  // compass points: no drag handles, shown in increasing heading order, three digits, 0 as 360
  const forCol = () =>
    page.eval(() =>
      [...document.querySelectorAll('[data-testid=compass-card] .pt-table tbody tr')].map(
        (tr) => tr.querySelectorAll('.numfield input')[0].value,
      ),
    );
  assert.equal(
    await page.eval(() => document.querySelectorAll('[data-testid=compass-card] .pt-table .drag-handle').length),
    0,
  );
  const fors = await forCol();
  assert.ok(fors.length > 1 && fors.every((v) => /^\d{3}(\.\d+)?$/.test(v)), fors.join(' '));
  assert.deepEqual([...fors].sort(), fors);
  assert.ok(!fors.includes('000'));
  // a heading typed out of order moves into place once the field is left
  const first = await page.eval(() =>
    document.querySelector('[data-testid=compass-card] .pt-table tbody tr .numfield input').getAttribute('name'),
  );
  await page.eval((n) => {
    const i = document.querySelector(`input[name="${n}"]`);
    i.focus();
    i.select();
  }, first);
  await page.type(`input[name="${first}"]`, '355');
  assert.equal((await forCol())[0], '355');
  await page.eval(() => document.activeElement.blur());
  await page.waitFor(() => {
    const v = [...document.querySelectorAll('[data-testid=compass-card] .pt-table tbody tr')].map(
      (tr) => tr.querySelectorAll('.numfield input')[0].value,
    );
    return v[v.length - 1] === '360' || v[v.length - 1] === '355';
  });

  // photo: a large PNG is resized to at most 1600 px and shown in the header and on the hangar card
  const png = await page.eval(async () => {
    const c = document.createElement('canvas');
    c.width = 3000;
    c.height = 2000;
    const g = c.getContext('2d');
    g.fillStyle = '#5b9bd5';
    g.fillRect(0, 0, 3000, 2000);
    const b = await new Promise((r) => c.toBlob(r, 'image/png'));
    const bytes = new Uint8Array(await b.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  });
  fs.writeFileSync(path.join(tmp, 'plane.png'), Buffer.from(png, 'base64'));
  await page.eval(() => window.scrollTo(0, 0));
  await setFile('[data-testid=photo-file]', path.join(tmp, 'plane.png'));
  await page.waitFor(() => /^blob:/.test(document.querySelector('.ac-photo.head img')?.getAttribute('src') || ''), {
    timeout: 20000,
  });
  await page.waitFor(() => document.querySelector('.ac-photo.head img').complete);
  const dims = await page.eval(() => {
    const i = document.querySelector('.ac-photo.head img');
    return [i.naturalWidth, i.naturalHeight];
  });
  assert.deepEqual(dims, [1600, 1067]);
  assert.equal((await api('GET', `aircraft/${ac.id}/files`)).photo.mime, 'image/jpeg');
  assert.equal(await page.eval(() => document.querySelector('[data-testid=photo-pick]').textContent), 'Change photo');
  await page.goto(`${server.url}/hangar`);
  await page.waitFor(
    (id) =>
      /^blob:/.test(
        document.querySelector(`[data-aircraft-id="${id}"] .ac-photo.card-top img`)?.getAttribute('src') || '',
      ),
    { args: [ac.id] },
  );

  // removing the photo brings back the same placeholder
  await page.goto(`${server.url}/hangar/${ac.id}`);
  await page.waitFor(() => !!document.querySelector('[data-testid=photo-remove]'));
  await page.eval(() => document.querySelector('[data-testid=photo-remove]').click());
  await page.waitFor(
    (n) =>
      document.querySelector('.ac-photo.head [data-testid=aircraft-placeholder]')?.getAttribute('src') ===
      `/aircraft/placeholder-${n}.webp`,
    { args: [ac.placeholder] },
  );
  assert.equal((await api('GET', `aircraft/${ac.id}`)).placeholder, ac.placeholder);

  // hangar cards show the placeholder, cover-cropped
  await api('POST', 'aircraft', { ...asv, registration: 'SX-PIG' });
  await page.goto(`${server.url}/hangar`);
  await page.waitFor(
    () =>
      [...document.querySelectorAll('.ac-photo.card-top [data-testid=aircraft-placeholder]')].filter(
        (i) => i.complete && i.naturalWidth,
      ).length === 2,
  );
  assert.equal(
    await page.eval(() => getComputedStyle(document.querySelector('.ac-photo.card-top img')).objectFit),
    'cover',
  );
  await shot('hangar-cards');

  // the whole card opens the aircraft; the menu still opens the menu
  const at = (sel, fx, fy) =>
    page.eval(
      (s, a, b) => {
        const r = document.querySelector(s).getBoundingClientRect();
        return [r.left + r.width * a, r.top + r.height * b];
      },
      sel,
      fx,
      fy,
    );
  const click = async ([x, y]) => {
    for (const type of ['mousePressed', 'mouseReleased'])
      await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  };
  const card = `[data-aircraft-id="${ac.id}"]`;
  await click(await at(`${card} .kebab button`, 0.5, 0.5));
  await page.waitFor(() => !!document.querySelector('.kebab .menu'));
  assert.equal(new URL(await page.eval(() => location.href)).pathname, '/hangar');
  await page.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  });
  await page.waitFor(() => !document.querySelector('.kebab .menu'));
  for (const [fx, fy] of [
    [0.97, 0.98], // bottom-right corner, past the chips
    [0.6, 0.45], // header row, between the registration and the menu
  ]) {
    await click(await at(card, fx, fy));
    await page.waitFor((id) => location.pathname === `/hangar/${id}`, { args: [ac.id] });
    await page.goto(`${server.url}/hangar`);
    await page.waitFor((s) => !!document.querySelector(s), { args: [card] });
  }

  // phone width: the header fits, no horizontal scroll
  await page.viewport(390, 844);
  await page.goto(`${server.url}/hangar/${ac.id}`);
  await page.waitFor(() => !!document.querySelector('.ac-photo.head [data-testid=aircraft-placeholder]'));
  assert.ok(await page.eval(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal scroll');
  await shot('aircraft-phone');
  await page.viewport(1400, 1000);
  assert.deepEqual(page.errors, []);
});

test('performance tables: units in the headers, speeds in knots, no unit over a value', async () => {
  const [asv] = fleetSeed();
  const ac = await api('POST', 'aircraft', { ...asv, registration: 'SX-PRF' });
  await page.viewport(1400, 1000);
  await page.goto(`${server.url}/hangar/${ac.id}#performance`);
  await page.waitFor(() => !!document.querySelector('#performance table.perf'));
  const TO = '#performance [data-path="performance.takeoff"]';
  assert.deepEqual(
    await page.eval(
      (to) =>
        [...document.querySelectorAll(`${to} thead tr:first-child th`)]
          .slice(0, 3)
          .map((th) => th.textContent.replace(/­/g, '')),
      TO,
    ),
    ['Masskg', 'Lift-offkt', 'Headwindkt'],
  );
  // read view: plain numbers under the headers
  assert.deepEqual(
    await page.eval(
      (to) =>
        [...document.querySelectorAll(`${to} tbody`)].map((tb) => [
          tb.querySelector('th.mass').textContent,
          tb.querySelector('td.ias').textContent,
          tb.querySelector('td.hw').textContent,
        ]),
      TO,
    ),
    [
      ['750', '50', '0'],
      ['900', '55', '0'],
      ['1043', '59', '0'],
    ],
  );
  const APP = 'input[name="performance.landing.approachIasKt"]';
  assert.equal(await page.eval((s) => document.querySelector(s).value, APP), '60');

  await page.eval(() =>
    [...document.querySelectorAll('#performance button')].find((b) => b.textContent === 'Edit tables').click(),
  );
  await page.waitFor(() => !!document.querySelector('#performance table.perf input[aria-label="Lift-off IAS"]'));
  await shot('aircraft-performance-edit');
  // no unit drawn inside a table field; units beside their fields; no field's text under its unit
  const layout = await page.eval(() => {
    const sec = document.getElementById('performance');
    const ctx = document.createElement('canvas').getContext('2d');
    const overlaps = [];
    for (const f of sec.querySelectorAll('.numfield.unit-input')) {
      const i = f.querySelector('input');
      const u = f.querySelector(':scope > span');
      const cs = getComputedStyle(i);
      ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const w = ctx.measureText(i.value).width;
      const ir = i.getBoundingClientRect();
      const left =
        cs.textAlign === 'right'
          ? ir.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth) - w
          : ir.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth);
      const ur = u.getBoundingClientRect();
      if (i.value && left + w > ur.left && left < ur.right) overlaps.push(`${i.name || i.ariaLabel}: ${i.value}`);
    }
    for (const u of sec.querySelectorAll('table.perf .u')) {
      const ur = u.getBoundingClientRect();
      for (const i of u.closest('th, td').querySelectorAll('input')) {
        const ir = i.getBoundingClientRect();
        if (ir.right > ur.left && ir.left < ur.right && ir.bottom > ur.top && ir.top < ur.bottom)
          overlaps.push(`${i.ariaLabel} under ${u.textContent}`);
      }
    }
    return { inTables: sec.querySelectorAll('table .unit-input').length, overlaps };
  });
  assert.deepEqual(layout, { inTables: 0, overlaps: [] });
  assert.deepEqual(
    await page.eval((to) => [...document.querySelectorAll(`${to} thead .alt-ed .u`)].map((u) => u.textContent), TO),
    ['ft', 'ft', 'ft', 'ft', '°C', '°C', '°C', '°C'],
  );

  // speeds are knots only: numbers, saved as such; a unit typed after the number is not taken
  await page.type('#performance input[aria-label="Lift-off IAS"]', '52');
  await page.type(APP, '63');
  await page.blur();
  await until(async () => {
    const p = (await api('GET', `aircraft/${ac.id}`)).performance;
    return p.takeoff.rows[0].liftoffIasKt === 52 && p.landing.approachIasKt === 63;
  });
  await page.type(APP, '60 kt');
  await page.waitFor((s) => document.querySelector(s).getAttribute('aria-invalid') === 'true', { args: [APP] });
  await page.blur();
  await page.waitFor((s) => document.querySelector(s).value === '60', { args: [APP] });
  await until(async () => (await api('GET', `aircraft/${ac.id}`)).performance.landing.approachIasKt === 60);
  assert.deepEqual(page.errors, []);
});
