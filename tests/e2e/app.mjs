// App-level helpers for the end-to-end tests.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A new blank flight, opened (like File → New flight)
export async function freshApp(page, server, responder) {
  if (responder) await page.mockOpenMeteo(responder);
  await page.goto(server.url + '/#/');
  await page.eval(() => localStorage.clear());
  await page.eval(() => { location.hash = '#/new'; });
  await page.waitFor(() => /^#\/f\//.test(location.hash) && !document.querySelector('#flight').hidden && !!document.querySelector('.sheet'));
}

// Click a menu item by selector: opens its menu first (File / Edit / Flight)
export async function menuItem(page, selector) {
  const menu = await page.eval((s) => document.querySelector(s).closest('.menu').dataset.menu, selector);
  await page.click(`.menu-btn[data-menu="${menu}"]`);
  await page.waitFor((m) => !document.querySelector(`.menu[data-menu="${m}"]`).hidden, { args: [menu] });
  await page.click(selector);
}

export const windyUrl = (pts, date, hour) =>
  `https://www.windy.com/route-planner/vfr/${pts.map((p) => `${p.lat},${p.lon}`).join(';')}${date ? `?${date}-${String(hour ?? 9).padStart(2, '0')}` : ''}`;

// Wait until a new Open-Meteo request was made and its result applied.
export async function expectWindFetch(page, action, { ok = true } = {}) {
  const n = page.requests.length;
  await action();
  const t0 = Date.now();
  while (page.requests.length === n) { if (Date.now() - t0 > 8000) throw new Error('no Open-Meteo request was made'); await sleep(30); }
  await page.waitFor((ok) => (ok ? ['ok'] : ['ok', 'error']).includes(document.body.dataset.wx), { args: [ok] });
  await sleep(120);
}

export async function openRouteDialog(page) {
  if (await page.eval(() => document.querySelector('#route-dialog').open)) return;
  await menuItem(page, '#btn-route');
  await page.waitFor(() => document.querySelector('#route-dialog').open);
}
export async function pasteRoute(page, url, n) {
  await openRouteDialog(page);
  await expectWindFetch(page, async () => {
    await page.paste('#windy-url', url);
  }, { ok: false });
  await page.waitFor(() => !document.querySelector('#route-dialog').open);
  if (n) await page.waitFor((n) => document.querySelector('#windy-url').title.startsWith(n + ' waypoints'), { args: [n] });
}

export async function gotoSheet(page, idx) {
  for (let k = 0; k < 20; k++) {
    const cur = await page.eval(() => [...document.querySelectorAll('#sheet > .sheet')].findIndex((s) => s.classList.contains('active')));
    if (cur === idx) return;
    await page.click('#pg-next');
  }
  throw new Error('could not reach sheet ' + idx);
}

// Altitudes are typed straight onto the sheet (paging for legs 10+).
export async function setAlts(page, alts) {
  for (let i = 0; i < alts.length; i++) {
    await gotoSheet(page, Math.floor(i / 9));
    await page.type(`.sheet.active [data-key="L${i}.alt"]`, String(alts[i]));
  }
  await page.blur();
  await gotoSheet(page, 0);
}

export async function setFlight(page, { date, block, aircraft, card, other } = {}) {
  if (date !== undefined) await page.type('#date', date);
  if (block !== undefined) await page.type('#block-start', block);
  if (aircraft) await page.select('#aircraft', aircraft);
  if (other !== undefined) await page.type('#aircraft-other', other);
  await page.blur();
  if (card) await settings(page, async () => page.select('#card', card));
}

export async function settings(page, fn) {
  await menuItem(page, '#btn-settings');
  await page.waitFor(() => document.querySelector('#settings').open);
  await fn();
  await page.click('#settings button.close');
  await page.waitFor(() => !document.querySelector('#settings').open);
}

// Every data-key cell on the sheets: {key: {value, user}} (first occurrence wins)
export async function readSheet(page) {
  return page.eval(() => {
    const out = {};
    document.querySelectorAll('.sheet [data-key]').forEach((e) => {
      if (!(e.dataset.key in out)) out[e.dataset.key] = { value: e.value, user: e.classList.contains('user') };
    });
    return out;
  });
}
export const v = (sheet, key) => (sheet[key] ? sheet[key].value : undefined);

export async function terminalRows(page) {
  return page.eval(() => {
    const cells = [...document.querySelectorAll('#sheet > .sheet:first-child .foot .ti textarea')];
    const rows = [];
    for (let i = 0; i < cells.length; i += 4) rows.push({ id: cells[i].dataset.key.split('.')[1], field: cells[i].value, elev: cells[i + 1].value, rwy: cells[i + 2].value, freq: cells[i + 3].value });
    return rows;
  });
}

export const chips = (page) => page.eval(() => [...document.querySelectorAll('#chips .chip')].map((b) => ({ kind: b.className.replace('chip', '').trim(), text: b.textContent, tip: b.title })));

// Layout audit: any text that does not fit its cell, labels that overflow, elements outside the sheet.
export async function layoutAudit(page) {
  return page.eval(() => {
    const issues = [];
    const name = (e) => e.dataset.key || e.className || e.textContent.slice(0, 20);
    const S = '#sheet > .sheet.active';
    // measure the rendered text against the room between the paddings (checkpoint names must stay off the hexagon arrows)
    const ctx = document.createElement('canvas').getContext('2d');
    document.querySelectorAll(S + ' input').forEach((e) => {
      if (!e.value) return;
      const cs = getComputedStyle(e);
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const w = ctx.measureText(e.value).width, room = e.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      if (w > room + 0.5) issues.push(`text overflows: ${name(e)}="${e.value}" (${w.toFixed(1)}>${room.toFixed(1)})`);
    });
    // checkpoint text must sit between the arrows (arrow width = 14/126 of the cell), unclipped, and readable
    document.querySelectorAll(S + ' .cpn textarea').forEach((e) => {
      if (!e.value) return;
      // between the legs the arrows are at most ~6/126 of the width within the text's height
      const cell = e.closest('.cpn').getBoundingClientRect(), arrow = cell.width * 6 / 126;
      const cs = getComputedStyle(e);
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const widest = Math.max(...e.value.split(/\s+/).map((wd) => ctx.measureText(wd).width));
      const room = e.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      if ((cell.width - room) / 2 < arrow || widest > room + 0.5) issues.push(`checkpoint name on the arrows: "${e.value}"`);
      if (e.scrollHeight > e.clientHeight + 1) issues.push(`checkpoint name clipped: "${e.value}"`);
      const u = document.querySelector('.sheet').offsetWidth / 1145;
      if (parseFloat(cs.fontSize) < 9.5 * u) issues.push(`checkpoint name too small: "${e.value}" ${(parseFloat(cs.fontSize) / u).toFixed(1)}u`);
    });
    document.querySelectorAll(S + ' textarea').forEach((e) => {
      if (e.value && e.scrollHeight > e.clientHeight + 1) issues.push(`text clipped: ${name(e)}="${e.value.slice(0, 40)}" (${e.scrollHeight}>${e.clientHeight})`);
    });
    document.querySelectorAll(['.h', '.lbl', '.est', '.tot-label', '.th', '.title', '.ti-title'].map((c) => S + ' ' + c).join(',')).forEach((e) => {
      if (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1) issues.push(`label overflows: "${e.textContent.trim().slice(0, 30)}" (${e.scrollWidth}x${e.scrollHeight} > ${e.clientWidth}x${e.clientHeight})`);
    });
    document.querySelectorAll('.sheet').forEach((s) => {
      const r = s.getBoundingClientRect();
      s.querySelectorAll('.g').forEach((g) => { const b = g.getBoundingClientRect(); if (b.right > r.right + 1 || b.left < r.left - 1) issues.push('grid wider than sheet'); });
    });
    if (!matchMedia('print').matches) {
      const de = document.documentElement;
      if (de.scrollWidth > innerWidth + 1 || de.scrollHeight > innerHeight + 1) issues.push(`page has scrollbars (${de.scrollWidth}x${de.scrollHeight} > ${innerWidth}x${innerHeight})`);
      const r = document.querySelector(S).getBoundingClientRect();
      if (r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.left < -1) issues.push(`sheet outside the window (${Math.round(r.left)},${Math.round(r.top)}-${Math.round(r.right)},${Math.round(r.bottom)})`);
      const bar = document.querySelector('#bar').getBoundingClientRect();
      if (r.top < bar.bottom - 1) issues.push('sheet overlaps the bar');
    }
    return issues;
  });
}
