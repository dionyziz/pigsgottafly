// End-to-end tests of the editor map and layout, in headless Chrome against the local server:
//   1. dragging a route point snaps it like drawing: it becomes the point it is dropped on (kind, id, name,
//      position, a new uid: the overrides of its old legs go); dropped on open map a known point asks for a
//      name and becomes a custom point;
//   2. the ENR 5 areas on the map: hover and click details (identity only: no route section, the
//      vertical limits once), links to the AIP PDFs (areas, airspace, aerodromes);
//   3. the flight panel collapses and expands (button, keyboard, dragging its edge; remembered);
//   4. resizing the panels keeps the map canvas the size of its container in every painted frame;
//   5. the radio navaids (ENR 4.1, AD 2.19): ICAO symbols with ident labels, hover and click details, their toggle;
//   6. the layer toggles (kept per flight; the profile's choice for new flights), the FIR, tooltips inside
//      the map near its edges, the hint's close button.
// Screenshots go to tests/e2e/artifacts/map-*.png.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { after, before } from 'node:test';

import { launch, ROOT, startServer } from './harness.mjs';

let server, browser, page;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (method, p, body) => {
  const r = await fetch(`${server.url}/api/${p}`, {
    method,
    headers: method !== 'GET' ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
};
const ref = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/ref', f), 'utf8'));
const AERODROMES = ref('aerodromes.json'),
  VFR = ref('vfr-points.json'),
  AREAS = ref('areas.json'),
  NAVAIDS = ref('navaids.json');
const AD = (id) => AERODROMES.find((a) => a.id === id);
const nm = (a, b) => {
  const r = Math.PI / 180,
    dLat = (b.lat - a.lat) * r,
    dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 3440.065 * Math.asin(Math.sqrt(h));
};
const LGTT = AD('LGTT'),
  LGMG = AD('LGMG'),
  LGAV = AD('LGAV');
const ABLONAS = VFR.find((p) => p.id === 'LGAV/ABLONAS');
// another charted VFR point a few NM from ABLONAS, away from aerodromes (the drop target)
const OTHER = VFR.filter(
  (p) =>
    p.src !== 'ofm' &&
    p.id !== ABLONAS.id &&
    nm(p, ABLONAS) > 3 &&
    nm(p, ABLONAS) < 15 &&
    AERODROMES.every((a) => nm(a, p) > 3),
).sort((a, b) => nm(a, ABLONAS) - nm(b, ABLONAS))[0];

before(async () => {
  server = await startServer();
  browser = await launch();
  page = await browser.newPage();
  await page.viewport(1500, 950);
  // no network: forecasts and METARs unavailable (the map does not need them)
  await page.intercept('*/api/weather/metar*', () => ({ body: { stations: {}, fetched: Date.now() } }));
});
after(async () => {
  await page?.close();
  await browser?.close();
  await server?.close();
});

const shot = (name) => page.screenshot('map-' + name, { fullPage: false });
async function mouse(type, x, y, { modifiers = 0, buttons = 0 } = {}) {
  await page.send('Input.dispatchMouseEvent', {
    type,
    x,
    y,
    modifiers,
    clickCount: 1,
    button: type === 'mouseMoved' && !buttons ? 'none' : 'left',
    buttons,
  });
}
async function hover(x, y) {
  await mouse('mouseMoved', x - 3, y - 3);
  await mouse('mouseMoved', x, y);
  await sleep(150);
}
async function clickAt(x, y) {
  await hover(x, y);
  await mouse('mousePressed', x, y, { buttons: 1 });
  await mouse('mouseReleased', x, y);
  await sleep(200);
}
/** Presses at `from`, moves in steps to `to` (button held), releases there. */
async function drag(from, to, steps = 12) {
  await hover(from.x, from.y);
  await mouse('mousePressed', from.x, from.y, { buttons: 1 });
  for (let i = 1; i <= steps; i++) {
    await mouse('mouseMoved', from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps, {
      buttons: 1,
    });
    await sleep(25);
  }
  await sleep(120);
  await mouse('mouseReleased', to.x, to.y);
  await sleep(250);
}
/** Page coordinates of a lat/lon on the map, once MapLibre's size matches its container. */
const mapPx = async (lat, lon) => {
  await page.waitFor(() => {
    const c = document.querySelector('.pgf-map-canvas');
    const m = c?.__pgfMap;
    return (
      !!m &&
      Math.abs(m.getCanvas().width / m.getPixelRatio() - c.clientWidth) < 1 &&
      Math.abs(m.getCanvas().height / m.getPixelRatio() - c.clientHeight) < 1
    );
  });
  return page.eval(
    (lat, lon) => {
      const c = document.querySelector('.pgf-map-canvas');
      const r = c.getBoundingClientRect();
      const p = c.__pgfMap.project([lon, lat]);
      return { x: r.left + p.x, y: r.top + p.y };
    },
    lat,
    lon,
  );
};
const frame = (bounds) =>
  page.eval((b) => {
    document.querySelector('.pgf-map-canvas').__pgfMap.fitBounds(b, { padding: 60, animate: false });
  }, bounds);
const jump = (lat, lon, zoom) =>
  page.eval(
    (lat, lon, zoom) => {
      document.querySelector('.pgf-map-canvas').__pgfMap.jumpTo({ center: [lon, lat], zoom });
    },
    lat,
    lon,
    zoom,
  );
const waitSaved = () =>
  page.waitFor(() => document.querySelector('[data-testid=save-state]')?.textContent === 'Saved', { timeout: 15000 });
const pt = (uid, kind, refId, name, p) => ({ uid, kind, refId, name, lat: p.lat, lon: p.lon });

let flightId;
test('setup: a pilot and a flight LGTT → ABLONAS → LGMG with altitude overrides', async () => {
  assert.ok(OTHER, 'a second VFR point near ABLONAS');
  await api('PUT', 'me', {
    fullName: 'Test Pilot',
    phone: '+30 690 000 0000',
    homeAerodrome: 'LGTT',
    settings: { taxiOutMin: 10, taxiInMin: 10, reserveMin: 45 },
  });
  const route = [
    pt('p1', 'aerodrome', 'LGTT', 'LGTT', LGTT),
    pt('p2', 'vfr', ABLONAS.id, ABLONAS.name, ABLONAS),
    pt('p3', 'aerodrome', 'LGMG', 'LGMG', LGMG),
  ];
  const f = await api('POST', 'flights', {
    route,
    legOverrides: { 'p1>p2': { altFt: 3500 }, 'p2>p3': { altFt: 4500 } },
  });
  flightId = f.id;
  await page.goto(`${server.url}/flights/${flightId}`);
  await page.waitFor(() => document.querySelector('[data-testid=map]')?.dataset.ready === '1', { timeout: 20000 });
  const g = await api('GET', `flights/${flightId}`);
  assert.equal(g.route.length, 3);
});

test('legs carry direction arrows; a route point under the cursor grows with a halo', async () => {
  const lats = [LGTT.lat, LGMG.lat, ABLONAS.lat],
    lons = [LGTT.lon, LGMG.lon, ABLONAS.lon];
  await frame([
    [Math.min(...lons) - 0.05, Math.min(...lats) - 0.05],
    [Math.max(...lons) + 0.05, Math.max(...lats) + 0.05],
  ]);
  await sleep(400);
  // the map attribution is collapsed to its (i) button
  await page.waitFor(() => {
    const a = document.querySelector('.maplibregl-ctrl-attrib');
    return a && !a.classList.contains('maplibregl-compact-show') && !a.hasAttribute('open');
  });
  const arrows = await page.eval(() => {
    const m = document.querySelector('.pgf-map-canvas').__pgfMap;
    return {
      layer: !!m.getLayer('route-arrows'),
      image: m.hasImage('pgf-route-arrow'),
      n: m.getSource('route-arrows').serialize().data.features.length,
    };
  });
  assert.deepEqual(arrows, { layer: true, image: true, n: 4 }, 'two arrowheads on each of the two legs');
  const hovered = () =>
    page.eval(() => {
      const m = document.querySelector('.pgf-map-canvas').__pgfMap;
      return [0, 1, 2].filter((id) => m.getFeatureState({ source: 'route-points', id }).hover);
    });
  const a = await mapPx(ABLONAS.lat, ABLONAS.lon);
  await hover(a.x, a.y);
  await page.waitFor(() => document.querySelector('.pgf-map-canvas canvas')?.style.cursor === 'grab');
  assert.deepEqual(await hovered(), [1]);
  await hover(a.x + 60, a.y + 60);
  assert.deepEqual(await hovered(), []);
});

test('dragging a route point snaps it to the point it is dropped on, which it becomes', async () => {
  const lats = [LGTT.lat, LGMG.lat, ABLONAS.lat, OTHER.lat],
    lons = [LGTT.lon, LGMG.lon, ABLONAS.lon, OTHER.lon];
  await frame([
    [Math.min(...lons) - 0.05, Math.min(...lats) - 0.05],
    [Math.max(...lons) + 0.05, Math.max(...lats) + 0.05],
  ]);
  await sleep(400);
  // drag ABLONAS a few px off OTHER: the tooltip names OTHER while dragging, and the point becomes OTHER
  const a = await mapPx(ABLONAS.lat, ABLONAS.lon);
  const b = await mapPx(OTHER.lat, OTHER.lon);
  await hover(a.x, a.y);
  await mouse('mousePressed', a.x, a.y, { buttons: 1 });
  for (let i = 1; i <= 10; i++) {
    await mouse('mouseMoved', a.x + ((b.x + 5 - a.x) * i) / 10, a.y + ((b.y - 4 - a.y) * i) / 10, { buttons: 1 });
    await sleep(25);
  }
  await page.waitFor((name) => document.querySelector('[data-testid=snap-tip] b')?.textContent === name, {
    args: [OTHER.name],
    timeout: 5000,
  });
  await shot('1-drag-snap');
  await mouse('mouseReleased', b.x + 5, b.y - 4);
  await page.waitFor(
    () =>
      [...document.querySelectorAll('[data-testid=leg-label]')].length === 2 &&
      !document.querySelector('[data-testid=name-prompt]'),
  );
  await waitSaved();
  let f = await api('GET', `flights/${flightId}`);
  assert.deepEqual(
    f.route.map((r) => [r.kind, r.refId, r.name]),
    [
      ['aerodrome', 'LGTT', 'LGTT'],
      ['vfr', OTHER.id, OTHER.name],
      ['aerodrome', 'LGMG', 'LGMG'],
    ],
  );
  assert.deepEqual([f.route[1].lat, f.route[1].lon], [OTHER.lat, OTHER.lon], 'takes the reference position exactly');
  assert.notEqual(f.route[1].uid, 'p2', 'a new point: new uid');
  assert.deepEqual(f.legOverrides, {}, 'the old legs’ overrides are gone with them');
  const labelKeys = await page.eval(() =>
    [...document.querySelectorAll('[data-testid=leg-label]')].map((e) => e.dataset.leg),
  );
  assert.deepEqual(labelKeys.sort(), [`p1>${f.route[1].uid}`, `${f.route[1].uid}>p3`].sort());

  // dropped on open map (no known point within reach): it asks for a name and becomes a custom point
  const c = await mapPx(OTHER.lat, OTHER.lon);
  const open = await page.eval(
    (x, y) => {
      // a spot 40 px off with nothing to snap to
      return { x: x + 40, y: y + 40 };
    },
    c.x,
    c.y,
  );
  await drag(c, open);
  await page.waitFor(() => !!document.querySelector('[data-testid=name-prompt] input'));
  await page.type('[data-testid=name-prompt] input', 'zulu');
  await page.key('Enter');
  await page.waitFor(() => !document.querySelector('[data-testid=name-prompt]'));
  await waitSaved();
  f = await api('GET', `flights/${flightId}`);
  assert.deepEqual([f.route[1].kind, f.route[1].refId, f.route[1].name], ['custom', null, 'ZULU']);
  const zuluUid = f.route[1].uid;

  // a custom point moved on open map keeps its name and uid (and asks nothing)
  await page.eval((uid) => fetch(`/api/flights/${location.pathname.split('/')[2]}`).then(() => uid), zuluUid);
  const z = await mapPx(f.route[1].lat, f.route[1].lon);
  await drag(z, { x: z.x - 25, y: z.y + 10 });
  await waitSaved();
  f = await api('GET', `flights/${flightId}`);
  assert.deepEqual([f.route[1].kind, f.route[1].name, f.route[1].uid], ['custom', 'ZULU', zuluUid]);
  assert.ok(!(await page.eval(() => !!document.querySelector('[data-testid=name-prompt]'))));

  // and dropped on ABLONAS it becomes ABLONAS again (renamed)
  const z2 = await mapPx(f.route[1].lat, f.route[1].lon);
  const ab = await mapPx(ABLONAS.lat, ABLONAS.lon);
  await drag(z2, { x: ab.x - 4, y: ab.y + 3 });
  await waitSaved();
  f = await api('GET', `flights/${flightId}`);
  assert.deepEqual(
    [f.route[1].kind, f.route[1].refId, f.route[1].name, f.route[1].lat, f.route[1].lon],
    ['vfr', ABLONAS.id, 'ABLONAS', ABLONAS.lat, ABLONAS.lon],
  );
  await shot('2-after-drags');
});

test('ENR 5 areas: drawn, hover and click details with the AIP PDF link; popovers show identity only', async () => {
  const lgp1 = AREAS.find((a) => a.id === 'LGP1');
  assert.ok(lgp1?.circle, 'LGP1 ACROPOLIS is a circle');
  assert.ok(AREAS.filter((a) => a.kind === 'D').length > 20, 'danger areas loaded');
  // the layer toggles list the areas
  await page.click('[data-testid=map-layers]');
  await page.waitFor(() => !!document.querySelector('[data-testid=map-areas-prd]'));
  assert.ok(await page.eval(() => document.querySelector('[data-testid=map-areas-prd]').checked));
  await shot('3-layers');
  await page.click('[data-testid=map-layers]');
  // the area layers are drawn
  const rendered = await page.eval(
    () =>
      document
        .querySelector('.pgf-map-canvas')
        .__pgfMap.getStyle()
        .layers.filter((l) => l.id.startsWith('area-')).length,
  );
  assert.ok(rendered >= 6);
  // hover and click the Acropolis prohibited area
  await jump(lgp1.circle.lat, lgp1.circle.lon, 13);
  await sleep(500);
  const c = await mapPx(lgp1.circle.lat, lgp1.circle.lon);
  await hover(c.x, c.y);
  await page.waitFor(() => /LGP1/.test(document.querySelector('[data-testid=airspace-tip]')?.textContent || ''), {
    timeout: 5000,
  });
  await clickAt(c.x, c.y);
  await page.waitFor(() => !!document.querySelector('[data-testid=airspace-pop] [data-id=LGP1] dl'));
  await shot('4-area-pop');
  const pop = await page.eval(() => {
    const s = document.querySelector('[data-testid=airspace-pop] [data-id=LGP1]');
    return {
      text: s.textContent,
      vertical: s.querySelector('[data-testid=airspace-vertical]').textContent,
      href: s.querySelector('[data-testid=aip-link]').href,
      target: s.querySelector('[data-testid=aip-link]').target,
    };
  });
  assert.match(pop.text, /Prohibited area/);
  assert.match(pop.text, /H24/);
  assert.equal(pop.vertical, 'GND – 5000 ft');
  assert.match(
    pop.href,
    /^https:\/\/aisgr\.hasp\.gov\.gr\/aipgr_incl_amdt_\d{4}_wef_\w+\/cd\/ais\/eaip\/pdf\/enr%205\/LG_ENR_5_1_en\.pdf$/,
  );
  assert.equal(pop.target, '_blank');
  await page.key('Escape');
  await page.waitFor(() => !document.querySelector('[data-testid=airspace-pop]'));

  // the Tatoi ATZ: no route section, the limits once, the AD 2 / AD 1.6 PDF
  await jump(LGTT.lat + 0.06, LGTT.lon + 0.06, 10);
  await sleep(400);
  const t = await mapPx(LGTT.lat + 0.06, LGTT.lon + 0.06);
  await clickAt(t.x, t.y);
  await page.waitFor(() => !!document.querySelector('[data-testid=airspace-pop] [data-id=LGTT-ATZ]'));
  // the smallest / most restrictive item is open first: open the ATZ
  if (!(await page.eval(() => !!document.querySelector('[data-testid=airspace-pop] [data-id=LGTT-ATZ] dl'))))
    await page.click('[data-testid=airspace-pop] [data-id=LGTT-ATZ] .pgf-air-h');
  await page.waitFor(() => !!document.querySelector('[data-testid=airspace-pop] [data-id=LGTT-ATZ] dl'));
  await shot('4b-atz-pop');
  const atz = await page.eval(() => {
    const s = document.querySelector('[data-testid=airspace-pop] [data-id=LGTT-ATZ]');
    return {
      text: s.textContent,
      vertical: s.querySelector('[data-testid=airspace-vertical]').textContent,
      href: s.querySelector('[data-testid=aip-link]').href,
    };
  });
  assert.doesNotMatch(atz.text, /Route|enters|Leg \d|compared with altitude/);
  assert.doesNotMatch(atz.vertical, /\(/);
  assert.match(atz.href, /LG_AD_1_6_5_LGTT_en\.pdf$/);
  // the open item is outlined on the map with dashes walking around it; hovering another outlines that one
  const focus = () =>
    page.eval(() => {
      const m = document.querySelector('.pgf-map-canvas').__pgfMap;
      const f = m.getSource('air-focus').serialize().data.features;
      return {
        ids: f.map((x) => x.properties.id),
        dash: JSON.stringify(m.getPaintProperty('air-focus-line', 'line-dasharray')),
      };
    });
  await page.waitFor(() => {
    const m = document.querySelector('.pgf-map-canvas').__pgfMap;
    return m.getSource('air-focus').serialize().data.features[0]?.properties.id === 'LGTT-ATZ';
  });
  const d0 = (await focus()).dash;
  await sleep(250);
  assert.notEqual((await focus()).dash, d0, 'the dashes move');
  const other = await page.eval(() => {
    const s = [...document.querySelectorAll('[data-testid=airspace-pop] [data-testid=airspace-item]')].find(
      (x) => x.dataset.id !== 'LGTT-ATZ',
    );
    const r = s.querySelector('.pgf-air-h').getBoundingClientRect();
    return { id: s.dataset.id, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: other.x, y: other.y });
  await page.waitFor(
    (id) =>
      document.querySelector('.pgf-map-canvas').__pgfMap.getSource('air-focus').serialize().data.features[0]?.properties
        .id === id,
    { args: [other.id] },
  );
  await shot('4c-airspace-focus');
  await page.key('Escape');
  await page.waitFor(
    () =>
      document.querySelector('.pgf-map-canvas').__pgfMap.getSource('air-focus').serialize().data.features.length === 0,
  );

  // the Athens aerodrome box links its full AIP AD 2
  await jump(LGAV.lat, LGAV.lon, 10);
  await sleep(400);
  const av = await mapPx(LGAV.lat, LGAV.lon);
  await clickAt(av.x, av.y);
  await page.waitFor(() => !!document.querySelector('[data-testid=aerodrome-pop]'));
  await shot('5-aerodrome-pop');
  const links = await page.eval(() =>
    [...document.querySelectorAll('[data-testid=aerodrome-pop] [data-testid=aip-link]')].map((a) => a.href),
  );
  assert.ok(
    links.some((h) => /eaip\/pdf\/AD%202\/AD2-LGAV\/LG_AD_2_LGAV_en\.pdf$/.test(h)),
    links.join(' '),
  );
  await page.key('Escape');
});

/** Starts recording, after each painted frame, whether the map canvas and MapLibre's size match the container. */
const startFrameProbe = () =>
  page.eval(() => {
    const c = document.querySelector('.pgf-map-canvas');
    const m = c.__pgfMap;
    const cv = m.getCanvas();
    const w = window;
    w.__probe = { frames: 0, bad: [], run: true, widths: new Set() };
    const tick = () => {
      if (!w.__probe.run) return;
      // after this frame is painted (a task queued from rAF runs after rendering)
      setTimeout(() => {
        const cw = c.clientWidth,
          ch = c.clientHeight;
        w.__probe.frames++;
        w.__probe.widths.add(cw);
        if (
          Math.abs(m.getCanvas().width / m.getPixelRatio() - cw) >= 1 ||
          Math.abs(m.getCanvas().height / m.getPixelRatio() - ch) >= 1 ||
          Math.abs(cv.clientWidth - cw) >= 1 ||
          Math.abs(cv.clientHeight - ch) >= 1
        ) {
          w.__probe.bad.push([
            cw,
            ch,
            m.getCanvas().width / m.getPixelRatio(),
            m.getCanvas().height / m.getPixelRatio(),
            cv.clientWidth,
            cv.clientHeight,
          ]);
        }
      }, 0);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
const stopFrameProbe = () =>
  page.eval(() => {
    const p = window.__probe;
    p.run = false;
    return { frames: p.frames, bad: p.bad, sizes: p.widths.size };
  });

test('resizing the flight panel and the navlog keeps the map canvas the size of its container in every frame', async () => {
  const h = await page.eval(() => {
    const r = document.querySelector('[data-testid=resize-panel]').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const w0 = await page.eval(() => document.querySelector('[data-testid=editor-panel]').getBoundingClientRect().width);
  await startFrameProbe();
  await drag(h, { x: h.x + 160, y: h.y }, 24);
  await drag({ x: h.x + 160, y: h.y }, { x: h.x - 60, y: h.y }, 24);
  const probe = await stopFrameProbe();
  const w1 = await page.eval(() => document.querySelector('[data-testid=editor-panel]').getBoundingClientRect().width);
  assert.ok(Math.abs(w1 - (w0 - 60)) <= 2, `panel width ${w1} after dragging from ${w0}`);
  assert.ok(probe.sizes >= 5, `the map took ${probe.sizes} sizes while dragging`);
  assert.deepEqual(probe.bad, [], `frames with a stale canvas (${probe.frames} frames)`);
  assert.equal(await page.eval(() => localStorage.getItem('pgf.editor.panelWidth')), String(Math.round(w1)));

  // the navlog strip's top edge
  const s = await page.eval(() => {
    const e = document.querySelector('[data-testid=resize-navlog]');
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: r.left + 200, y: r.top + r.height / 2 };
  });
  if (s) {
    await startFrameProbe();
    await drag(s, { x: s.x, y: s.y - 120 }, 20);
    const p2 = await stopFrameProbe();
    assert.deepEqual(p2.bad, [], `navlog resize: frames with a stale canvas (${p2.frames} frames)`);
  }
  await shot('6-resized');
});

test('the flight panel collapses and expands (button, keyboard, dragging its edge), remembered per browser', async () => {
  const mapW = () => page.eval(() => document.querySelector('.pgf-map-canvas').clientWidth);
  const bodyW = await page.eval(() => document.querySelector('.editor-body').clientWidth);
  const before = await mapW();
  await page.click('[data-testid=panel-collapse]');
  await page.waitFor(() => document.querySelector('[data-testid=editor-panel]').hidden);
  await page.waitFor((w) => Math.abs(document.querySelector('.pgf-map-canvas').clientWidth - w) < 2, { args: [bodyW] });
  assert.ok((await mapW()) > before + 200);
  assert.equal(
    await page.eval(() => document.querySelector('[data-testid=panel-collapse]').getAttribute('aria-expanded')),
    'false',
  );
  await mapPx(LGTT.lat, LGTT.lon); // MapLibre followed the new size
  await shot('7-collapsed');
  // remembered
  await page.reload();
  await page.waitFor(() => document.querySelector('[data-testid=map]')?.dataset.ready === '1', { timeout: 20000 });
  assert.ok(await page.eval(() => document.querySelector('[data-testid=editor-panel]').hidden));
  // keyboard: focus the tab, Enter
  await page.eval(() => document.querySelector('[data-testid=panel-collapse]').focus());
  await page.key('Enter');
  await page.waitFor(() => !document.querySelector('[data-testid=editor-panel]').hidden);
  const wOpen = await page.eval(
    () => document.querySelector('[data-testid=editor-panel]').getBoundingClientRect().width,
  );
  assert.ok(wOpen >= 280, 'opens at its remembered width');
  // dragging the edge far past the narrowest width collapses it (and keeps the width for next time)
  const h = await page.eval(() => {
    const r = document.querySelector('[data-testid=resize-panel]').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await drag(h, { x: h.x - wOpen + 60, y: h.y }, 16);
  await page.waitFor(() => document.querySelector('[data-testid=editor-panel]').hidden);
  await page.click('[data-testid=panel-collapse]');
  await page.waitFor(() => !document.querySelector('[data-testid=editor-panel]').hidden);
  const wAgain = await page.eval(
    () => document.querySelector('[data-testid=editor-panel]').getBoundingClientRect().width,
  );
  assert.ok(Math.abs(wAgain - wOpen) <= 1, `${wAgain} vs ${wOpen}`);
  assert.deepEqual(page.errors, []);
});

test('radio navaids: ICAO symbols labelled with their ident, hover and click details with the AIP source, a toggle kept per flight', async () => {
  const ATV = NAVAIDS.find((n) => n.id === 'ATV VOR/DME');
  const KOR = NAVAIDS.find((n) => n.id === 'KOR NDB');
  assert.ok(ATV && KOR);
  const rendered = (layer) =>
    page.eval(
      (layer) =>
        document
          .querySelector('.pgf-map-canvas')
          .__pgfMap.queryRenderedFeatures({ layers: [layer] })
          .map((f) => f.properties.id),
      layer,
    );
  await page.goto(`${server.url}/flights/${flightId}`);
  await page.waitFor(() => document.querySelector('[data-testid=map]')?.dataset.ready === '1', { timeout: 20000 });
  await page.eval(() => {
    const b = document.querySelector('[data-testid=map-draw]');
    if (b.getAttribute('aria-pressed') === 'true') b.click();
  });
  // the Athens area: ATV VOR/DME and the KOR NDB drawn with their symbols and idents
  await frame([
    [KOR.lon - 0.1, KOR.lat - 0.25],
    [ATV.lon + 0.25, ATV.lat + 0.25],
  ]);
  await page.waitFor(
    () => {
      const ids = document
        .querySelector('.pgf-map-canvas')
        .__pgfMap.queryRenderedFeatures({ layers: ['navaid-icon'] })
        .map((f) => f.properties.id);
      return ids.includes('ATV VOR/DME') && ids.includes('KOR NDB');
    },
    { timeout: 10000 },
  );
  const icons = await page.eval(() =>
    Object.fromEntries(
      document
        .querySelector('.pgf-map-canvas')
        .__pgfMap.queryRenderedFeatures({ layers: ['navaid-icon'] })
        .map((f) => [f.properties.id, f.properties.icon]),
    ),
  );
  assert.equal(icons['ATV VOR/DME'], 'pgf-nav-vordme');
  assert.equal(icons['KOR NDB'], 'pgf-nav-ndb');
  await shot('navaids-1');
  // hover: type, ident, name, frequency; click: the details with the AIP sections
  await jump(ATV.lat, ATV.lon, 9.5);
  await sleep(500);
  await page.waitFor(
    () =>
      document
        .querySelector('.pgf-map-canvas')
        .__pgfMap.queryRenderedFeatures({ layers: ['navaid-label'] })
        .some((f) => f.properties.label === 'ATV'),
    { timeout: 10000 },
  );
  await shot('navaids-2-zoomed');
  const c = await mapPx(ATV.lat, ATV.lon);
  await hover(c.x, c.y);
  await page.waitFor(
    () => /ATV · ATHINAI/.test(document.querySelector('[data-testid=navaid-tip]')?.textContent || ''),
    {
      timeout: 5000,
    },
  );
  assert.match(await page.eval(() => document.querySelector('[data-testid=navaid-tip]').textContent), /114\.40 MHz/);
  await clickAt(c.x, c.y);
  await page.waitFor(() => !!document.querySelector('[data-testid=navaid-pop]'));
  const pop = await page.eval(() => ({
    text: document.querySelector('[data-testid=navaid-pop]').textContent,
    links: [...document.querySelectorAll('[data-testid=navaid-pop] [data-testid=aip-link]')].map((a) => a.href),
  }));
  assert.match(pop.text, /VOR\/DME/);
  assert.match(pop.text, /CH 91X/);
  assert.match(pop.text, /AIP Greece ENR 4\.1/);
  assert.ok(
    pop.links.some((h) => /LG_ENR_4_1_en\.pdf$/.test(h)),
    pop.links.join(' '),
  );
  await shot('navaids-3-pop');
  await page.key('Escape');
  await page.waitFor(() => !document.querySelector('[data-testid=navaid-pop]'));
  // the toggle hides the layer and its tooltips, and is kept on the flight
  await page.click('[data-testid=map-layers]');
  await page.waitFor(() => !!document.querySelector('[data-testid=map-navaids]'));
  assert.ok(await page.eval(() => document.querySelector('[data-testid=map-navaids]').checked));
  await page.click('[data-testid=map-navaids]');
  await page.waitFor(
    () => document.querySelector('.pgf-map-canvas').__pgfMap.getLayoutProperty('navaid-icon', 'visibility') === 'none',
  );
  assert.equal(
    await page.eval(() =>
      document.querySelector('.pgf-map-canvas').__pgfMap.getLayoutProperty('navaid-label', 'visibility'),
    ),
    'none',
  );
  await page.click('[data-testid=map-layers]');
  await sleep(300);
  assert.deepEqual(await rendered('navaid-icon'), []);
  await hover(c.x + 2, c.y);
  await hover(c.x, c.y);
  assert.equal(await page.eval(() => !!document.querySelector('[data-testid=navaid-tip]')), false);
  const navaidsOn = async () => (await api('GET', `flights/${flightId}`)).options.mapLayers?.navaids;
  for (let i = 0; i < 100 && (await navaidsOn()) !== false; i++) await sleep(100);
  assert.equal(await navaidsOn(), false);
  // back on
  await page.click('[data-testid=map-layers]');
  await page.waitFor(() => !!document.querySelector('[data-testid=map-navaids]'));
  await page.click('[data-testid=map-navaids]');
  await page.click('[data-testid=map-layers]');
  await page.waitFor(
    () =>
      (document.querySelector('.pgf-map-canvas').__pgfMap.getLayoutProperty('navaid-icon', 'visibility') ??
        'visible') === 'visible',
  );
  for (let i = 0; i < 100 && (await navaidsOn()) !== true; i++) await sleep(100);
  assert.equal(await navaidsOn(), true);
  assert.deepEqual(page.errors, []);
});

test('layers: separate toggles kept per flight, the profile choice for new flights, the FIR drawn; tooltips stay inside the map; the hint X stays clickable', async () => {
  const layerVis = (id) =>
    page.eval(
      (id) => document.querySelector('.pgf-map-canvas').__pgfMap.getLayoutProperty(id, 'visibility') ?? 'visible',
      id,
    );
  const hidden = (id) =>
    page.waitFor(
      (id) => document.querySelector('.pgf-map-canvas')?.__pgfMap?.getLayoutProperty(id, 'visibility') === 'none',
      { args: [id], timeout: 10000 },
    );
  const ready = () =>
    page.waitFor(() => document.querySelector('[data-testid=map]')?.dataset.ready === '1', { timeout: 20000 });
  // the FIR boundary and the ATHINAI | MAKEDONIA line
  const fir = await page.eval(() =>
    document
      .querySelector('.pgf-map-canvas')
      .__pgfMap.getSource('fir')
      .serialize()
      .data.features.map((f) => f.properties.label),
  );
  assert.deepEqual(fir, ['LGGG ATHINAI FIR', 'ATHINAI | MAKEDONIA']);
  assert.equal(await layerVis('fir-line'), 'visible');
  // turn VFR routes and TMAs off on this flight
  await page.click('[data-testid=map-layers]');
  await page.waitFor(() => !!document.querySelector('[data-testid=map-vfr-routes]'));
  await page.click('[data-testid=map-vfr-routes]');
  await page.click('[data-testid=map-tma]');
  await hidden('vfr-route-line');
  assert.equal(await layerVis('airspace-line'), 'none');
  assert.equal(await layerVis('aerodrome-icon'), 'visible');
  assert.equal(await layerVis('route-line'), 'visible');
  await shot('8-layers-off');
  await page.click('[data-testid=map-layers]');
  await waitSaved();
  const f = await api('GET', `flights/${flightId}`);
  assert.deepEqual(
    [f.options.mapLayers.vfrRoutes, f.options.mapLayers.tma, f.options.mapLayers.aerodromes],
    [false, false, true],
  );
  // remembered for this flight
  await page.reload();
  await ready();
  await hidden('vfr-route-line');
  // a new flight starts from the profile's choice
  await page.goto(`${server.url}/profile`);
  await page.waitFor(() => !!document.querySelector('[data-testid=profile-map-layers] [data-testid=map-aerodromes]'));
  await page.click('[data-testid=profile-map-layers] [data-testid=map-aerodromes]');
  for (let i = 0; i < 100 && (await api('GET', 'me')).settings.mapLayers?.aerodromes !== false; i++) await sleep(50);
  const nf = await api('POST', 'flights', {});
  assert.deepEqual([nf.options.mapLayers.aerodromes, nf.options.mapLayers.vfrRoutes], [false, true]);
  await page.goto(`${server.url}/flights/${nf.id}`);
  await ready();
  await hidden('aerodrome-icon');
  // tooltips near the right and bottom edges stay fully inside the map
  await page.eval(() => {
    const b = document.querySelector('[data-testid=map-draw]');
    if (b.getAttribute('aria-pressed') === 'true') b.click();
  });
  await jump(37.9, 23.7, 9);
  await sleep(500);
  const box = await page.eval(() => {
    const r = document.querySelector('.pgf-map').getBoundingClientRect();
    return { l: r.left, t: r.top, r: r.right, b: r.bottom };
  });
  for (const at of [
    { x: box.r - 70, y: box.t + 300 },
    { x: box.l + 300, y: box.b - 6 },
  ]) {
    await hover(at.x, at.y);
    await page.waitFor(() => !!document.querySelector('[data-testid=airspace-tip]'), { timeout: 5000 });
    const tip = await page.eval(() => {
      const r = document.querySelector('[data-testid=airspace-tip]').getBoundingClientRect();
      return { l: r.left, t: r.top, r: r.right, b: r.bottom };
    });
    assert.ok(
      tip.l >= box.l && tip.t >= box.t && tip.r <= box.r && tip.b <= box.b,
      `tip ${JSON.stringify(tip)} inside ${JSON.stringify(box)}`,
    );
  }
  await shot('9-tip-edge');
  // the hint stays visible over its close button, which closes it
  await page.click('[data-testid=map-draw]');
  await page.waitFor(() => !!document.querySelector('[data-testid=map-hint-close]'));
  const x = await page.eval(() => {
    const r = document.querySelector('[data-testid=map-hint-close]').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await hover(x.x - 10, x.y);
  await hover(x.x, x.y);
  assert.ok(!(await page.eval(() => document.querySelector('[data-testid=map-hint]').classList.contains('is-away'))));
  await clickAt(x.x, x.y);
  await page.waitFor(() => !document.querySelector('[data-testid=map-hint]'));
  assert.deepEqual(page.errors, []);
});
