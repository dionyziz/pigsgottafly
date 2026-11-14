/* global AIP, VFR, SUN, AIRCRAFT, Nav, Weather, Store */
(function () {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const LEGS_PER_SHEET = 9;
  const PREFS_KEY = 'navlog.prefs';   // aircraft and settings carried over to new flights

  // ------------------------------------------------------------------ state
  const DEFAULTS = {
    windyUrl: '', date: '', blockStart: '', aircraft: 'SX-ASV', aircraftOther: '', card: 'Magnetic compass',
    taxiMin: 10, model: 'ecmwf_ifs025', variation: 5, fieldRadius: 2, fuelFlow: 30, fuelExtra: 4,
    waypoints: [], ov: {}, termManual: [], termHidden: [], title: '',
  };
  const PREF_FIELDS = ['aircraft', 'aircraftOther', 'card', 'taxiMin', 'model', 'variation', 'fieldRadius', 'fuelFlow', 'fuelExtra'];
  let state = blankFlight();
  let currentId = null;
  let wx = { sig: '', raw: null, status: 'idle', msg: '', fetchedAt: null };
  let lastCalc = null;

  function blankFlight() {
    const s = structuredClone(DEFAULTS);
    try { Object.assign(s, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch (e) { /* none */ }
    s.date = new Date().toISOString().slice(0, 10);
    return s;
  }
  let lastSaved = '';
  function save() {
    record();
    if (!currentId) return;
    const sum = summaryOf(state, lastCalc);
    const j = JSON.stringify([state, sum]);
    if (j === lastSaved) { renderTitle(); return; }
    lastSaved = j;
    Store.save(currentId, state, sum);
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(Object.fromEntries(PREF_FIELDS.map((k) => [k, state[k]])))); } catch (e) { /* ignore */ }
    renderTitle();
  }
  function autoTitle(st) {
    const names = st.waypoints.map((w) => w.name).filter((n, i, a) => n && n !== a[i - 1]);
    return names.length > 1 ? names.join(' → ') : 'Untitled flight';
  }
  const titleOf = (st) => (st.title || '').trim() || autoTitle(st);
  function summaryOf(st, c) {
    return {
      title: titleOf(st), date: st.date || '', aircraft: st.aircraft === 'OTHER' ? (st.aircraftOther || '').toUpperCase() : st.aircraft,
      route: st.waypoints.map((w) => [+w.lat.toFixed(3), +w.lon.toFixed(3)]),
      dist: c && c.nLegs ? c.totals.dist : null, ete: c && c.nLegs ? c.totals.ete : null, fuel: c && c.nLegs ? c.totals.fuel : null,
    };
  }
  const history = { past: [], future: [], last: null, key: null, t: 0 };
  function record() {
    const j = JSON.stringify(state);
    if (history.last === null) { history.last = j; return; }
    if (j === history.last) return;
    const ae = document.activeElement;
    const key = ae && ((ae.dataset && ae.dataset.key) || ae.id);
    const now = Date.now();
    if (!(key && key === history.key && now - history.t < 1500)) {
      history.past.push(history.last);
      if (history.past.length > 300) history.past.shift();
    }
    history.future = [];
    history.last = j; history.key = key; history.t = now;
  }
  function restore(j) {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    state = JSON.parse(j);
    history.last = j; history.key = null;
    renderControls(); refresh(true); scheduleWx();
  }
  function undo() { if (!history.past.length) return; history.future.push(JSON.stringify(state)); restore(history.past.pop()); }
  function redo() { if (!history.future.length) return; history.past.push(JSON.stringify(state)); restore(history.future.pop()); }

  // ------------------------------------------------------------------ helpers
  const num = (v) => { if (v === undefined || v === null || String(v).trim() === '') return NaN; const n = parseFloat(String(v).replace(',', '.').replace(/[\u2212\u2013]/g, '-')); return isFinite(n) ? n : NaN; };
  const ovNum = (k) => num(state.ov[k]);
  const has = (k) => state.ov[k] !== undefined && String(state.ov[k]).trim() !== '';
  const fmtDate = (iso) => iso || ''; // dates are shown as YYYY-MM-DD
  const isIsoDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
  const daysBetween = (aIso, bIso) => Math.round((Date.parse(bIso) - Date.parse(aIso)) / 86400000);
  function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function registration() { return state.aircraft === 'OTHER' ? (state.aircraftOther || '').toUpperCase() : state.aircraft; }
  function currentCard() {
    const ac = AIRCRAFT[state.aircraft];
    if (!ac) return null;
    return ac.cards[state.card] || Object.values(ac.cards)[0];
  }

  const ADS = AIP.aerodromes.filter((a) => isFinite(a.lat) && isFinite(a.lon));
  function nearestAerodrome(p, maxNm) {
    let best = null, bd = Infinity;
    for (const a of ADS) {
      const d = Nav.distanceNm(p, a);
      if (d < bd) { bd = d; best = a; }
    }
    return bd <= maxNm ? best : null;
  }
  // VFR reporting points (eAIP VFR route charts)
  const VFRP = (typeof VFR !== 'undefined' ? VFR.points : []);
  function nearestVfr(p, maxNm) {
    let best = null, bd = Infinity;
    for (const v of VFRP) { const d = Nav.distanceNm(p, v); if (d < bd) { bd = d; best = v; } }
    return bd <= maxNm ? best : null;
  }
  // Name for a clicked waypoint: aerodrome right there, else a VFR reporting point, else a nearby aerodrome.
  function autoName(p, i, n) {
    const ad = nearestAerodrome(p, 2);
    if (ad && Nav.distanceNm(p, ad) <= 1) return adLabel(ad);
    const v = nearestVfr(p, 1.5);
    if (v) return v.name;
    if (ad) return adLabel(ad);
    return i === 0 ? 'DEP' : i === n - 1 ? 'ARR' : `WP${i}`;
  }
  // Charted VFR route altitude for a leg between two reporting points (respecting one-way routes).
  function vfrRoute(a, b) {
    if (typeof VFR === 'undefined') return null;
    // a point can appear on several charts (e.g. DIDIS on the Mikonos and Paros charts)
    const near = (p) => VFRP.filter((v) => v.src !== 'ofm' && Nav.distanceNm(p, v) <= 1.5);
    const A = near(a), B = near(b);
    for (const va of A) for (const vb of B) {
      if (va.name === vb.name) continue;
      const r = VFR.routes.find((r) => r.chart === va.chart && r.chart === vb.chart &&
        ((r.a === va.name && r.b === vb.name) || (!r.oneway && r.a === vb.name && r.b === va.name)));
      if (r) return r;
    }
    return null;
  }

  function adLabel(a) { return a.icao || a.name.split('/').pop().trim(); }
  function adField(a) {
    const nm = a.name.includes('/') ? a.name.split('/')[0].trim() + ' / ' + a.name.split('/')[1].trim() : a.name;
    return a.icao || nm;
  }

  function defaultTas(i, n) { return i === 0 || i === n - 1 ? 80 : 92; }

  // ------------------------------------------------------------------ frequency text
  function shortUnit(callsign, service) {
    const last = callsign.trim().split(/\s+/).pop();
    const map = { TOWER: 'TWR', GROUND: 'GND', DELIVERY: 'DEL', APPROACH: 'APP', RADAR: 'RDR', CONTROL: 'CTL', AIRFIELD: 'A/A', RADIO: 'RADIO' };
    if (last === 'INFORMATION') return service === 'ATIS' ? 'ATIS' : 'INFO';
    return map[last] || last;
  }
  const UNIT_ORDER = ['ATIS', 'DEL', 'GND', 'TWR', 'INFO', 'A/A', 'APP', 'RDR'];
  function aerodromeFreqText(a) {
    const groups = new Map();
    for (const f of a.freqs) {
      const k = f.callsign || f.service;
      if (!groups.has(k)) groups.set(k, { label: shortUnit(f.callsign || f.service, f.service), list: [] });
      groups.get(k).list.push(f);
    }
    const parts = [];
    for (const g of groups.values()) {
      const prim = g.list.filter((f) => f.role === 'primary').map((f) => f.mhz);
      const back = g.list.filter((f) => f.role !== 'primary').map((f) => f.mhz);
      const use = prim.length ? [...prim, ...back.slice(0, 1)] : back.slice(0, 2);
      parts.push({ label: g.label, text: `${g.label} ${[...new Set(use)].join(' ')}` });
    }
    parts.sort((x, y) => (UNIT_ORDER.indexOf(x.label) + 99) % 99 - (UNIT_ORDER.indexOf(y.label) + 99) % 99);
    // units sharing exactly the same frequencies (e.g. TWR and APP at military fields) are merged
    const merged = [];
    for (const p of parts) {
      const fq = p.text.slice(p.label.length + 1);
      const m = merged.find((q) => q.fq === fq);
      if (m) m.labels.push(p.label); else merged.push({ fq, labels: [p.label] });
    }
    return merged.map((m) => `${m.labels.join('/')} ${m.fq}`).join(' · ');
  }
  function unitText(u) { return `${shortUnit(u.callsign, '')} ${u.freqs.slice(0, 2).join(' ')}`; }

  // ------------------------------------------------------------------ core calculation
  function calc() {
    const wps = state.waypoints;
    const nLegs = Math.max(0, wps.length - 1);
    const card = currentCard();
    const vals = {};
    const rows = [];
    const date = state.date;
    const bsMin = Nav.parseClock(state.blockStart);
    const startMin = (isFinite(bsMin) ? bsMin : 12 * 60) + (num(state.taxiMin) || 0);
    const dayMs = date ? Date.parse(date + 'T00:00:00Z') : NaN;

    // geometry + inputs
    const legs = [];
    for (let i = 0; i < nLegs; i++) {
      const a = wps[i], b = wps[i + 1];
      const k = `L${i}.`;
      const route = vfrRoute(a, b);
      legs.push({
        a, b, mid: Nav.midpoint(a, b), route,
        tc: has(k + 'tc') ? ovNum(k + 'tc') : Nav.trueCourse(a, b),
        dist: has(k + 'dist') ? ovNum(k + 'dist') : Nav.distanceNm(a, b),
        alt: has(k + 'alt') ? ovNum(k + 'alt') : NaN,
        tas: has(k + 'tas') ? ovNum(k + 'tas') : defaultTas(i, nLegs),
      });
    }

    // default altitudes: charted VFR route (highest permitted), else the previous leg's altitude;
    // the leg into the destination flies its traffic pattern altitude (elevation + 1000 ft).
    const patternAlt = (p) => { const ad = nearestAerodrome(p, 2); return ad && isFinite(ad.elevFt) ? Math.round((ad.elevFt + 1000) / 100) * 100 : NaN; };
    legs.forEach((L, i) => {
      L.altAuto = NaN;
      if (L.route) L.altAuto = L.route.max;
      else if (i === nLegs - 1 && isFinite(patternAlt(L.b))) L.altAuto = patternAlt(L.b);
      else if (i > 0) L.altAuto = legs[i - 1].alt;
      else L.altAuto = patternAlt(L.a);
      if (!has(`L${i}.alt`)) L.alt = L.altAuto;
    });

    // timeline <-> wind iteration (GS depends on wind, wind depends on time)
    let res = [];
    const winds = legs.map(() => null);
    for (let iter = 0; iter < 4; iter++) {
      let t = startMin;
      res = legs.map((L, i) => {
        const k = `L${i}.`;
        const prevMin = t;
        // sample wind for this leg at mid-leg time from the previous iteration's GS
        const guessMin = res && res[i] && isFinite(res[i].minutesExact) ? res[i].minutesExact : (L.dist / (L.tas || 90)) * 60;
        const midMs = dayMs + (prevMin + guessMin / 2) * 60000;
        let w = null;
        if (wx.raw && wx.raw[i] && wx.raw[i].hourly && isFinite(L.alt) && isFinite(midMs)) w = Weather.sampleAt(wx.raw[i].hourly, L.alt, midMs);
        winds[i] = w;
        const wd = has(k + 'wd') ? ovNum(k + 'wd') : (w ? Math.round(w.dir) % 360 || 360 : NaN);
        const ws = has(k + 'ws') ? ovNum(k + 'ws') : (w ? Math.round(w.spd) : NaN);
        const r = Nav.computeLeg({ tc: L.tc, dist: L.dist, tas: L.tas, wd: isFinite(wd) ? wd : 0, ws: isFinite(ws) ? ws : 0, devManual: ovNum(k + 'dev') },
          { variation: num(state.variation) || 0, card: card ? card.points : null, fuelPerHour: num(state.fuelFlow) || 30 });
        // cascade a few typed-over values
        if (has(k + 'wca') && isFinite(r.th)) { r.wca = ovNum(k + 'wca'); r.th = Nav.norm360(r.tc + r.wca); r.mh = Nav.norm360(r.th + r.var); if (isFinite(r.dev)) r.ch = Nav.norm360(r.mh + r.dev); }
        if (has(k + 'dev') && isFinite(r.mh)) { r.dev = ovNum(k + 'dev'); r.ch = Nav.norm360(r.mh + r.dev); }
        if (has(k + 'gs') && ovNum(k + 'gs') > 0) { r.gs = ovNum(k + 'gs'); r.minutesExact = (r.dist / r.gs) * 60; r.ete = Math.round(r.minutesExact); r.fuel = Math.ceil(r.minutesExact * ((num(state.fuelFlow) || 30) / 60) - 1e-9); }
        r.wd = wd; r.ws = ws; r.temp = has(k + 'temp') ? ovNum(k + 'temp') : (w ? Math.round(w.temp) : NaN);
        r.windMissing = !w && !(has(k + 'wd') && has(k + 'ws'));
        t = prevMin + (isFinite(r.minutesExact) ? r.minutesExact : 0);
        return r;
      });
    }
    // typed-over ETE / fuel feed the totals
    res.forEach((r, i) => {
      const k = `L${i}.`;
      if (has(k + 'ete')) { const m = parseHmm(state.ov[k + 'ete']); if (isFinite(m)) r.ete = m; }
      if (has(k + 'fuel') && isFinite(ovNum(k + 'fuel'))) r.fuel = ovNum(k + 'fuel');
      if (has(k + 'dist') && isFinite(ovNum(k + 'dist'))) r.dist = Math.round(ovNum(k + 'dist'));
    });
    const totals = Nav.summarize(res, num(state.fuelExtra) || 0);

    res.forEach((r, i) => {
      const k = `L${i}.`;
      const L = legs[i];
      vals[k + 'tc'] = Nav.fmtHdg(r.tc);
      vals[k + 'alt'] = isFinite(L.altAuto) ? String(L.altAuto) : '';
      vals[k + 'wd'] = isFinite(r.wd) && !r.windMissing ? Nav.fmtHdg(r.wd) : '';
      vals[k + 'ws'] = isFinite(r.ws) && !r.windMissing ? String(r.ws) : '';
      vals[k + 'temp'] = isFinite(r.temp) ? String(r.temp) : '';
      vals[k + 'tas'] = String(L.tas);
      vals[k + 'wca'] = Nav.fmtSigned(r.wca);
      vals[k + 'th'] = Nav.fmtHdg(r.th);
      vals[k + 'var'] = isFinite(r.var) ? Nav.fmtSigned(r.var) : '';
      vals[k + 'mh'] = Nav.fmtHdg(r.mh);
      vals[k + 'dev'] = isFinite(r.dev) ? (r.dev === 0 ? '0' : Nav.fmtSigned(r.dev)) : '';
      vals[k + 'ch'] = Nav.fmtHdg(r.ch);
      vals[k + 'dist'] = isFinite(r.dist) ? String(r.dist) : '';
      vals[k + 'rem'] = String(r.distRem);
      vals[k + 'gs'] = isFinite(r.gs) ? String(r.gs) : '';
      vals[k + 'ete'] = isFinite(r.ete) ? Nav.fmtHmm(r.ete) : '';
      vals[k + 'ate'] = Nav.fmtHmm(r.ateRem);
      vals[k + 'fuel'] = isFinite(r.fuel) ? String(r.fuel) : '';
      rows.push(r);
    });
    vals['T.dist'] = nLegs ? String(totals.dist) : '';
    vals['T.ete'] = nLegs ? Nav.fmtHmm(totals.ete) : '';
    vals['T.fuel'] = nLegs ? String(totals.fuel) : '';

    // header
    vals['H.date'] = fmtDate(date);
    vals['H.aircraft'] = registration();
    vals['H.blockstart'] = isFinite(bsMin) ? Nav.fmtClock(bsMin) + 'Z' : '';

    // forecast surface conditions for the TEMP / WIND / SKY boxes
    const surf = (idx, min) => (wx.raw && wx.raw[idx] && wx.raw[idx].hourly && isFinite(dayMs) ? Weather.sampleSurface(wx.raw[idx].hourly, dayMs + min * 60000) : null);
    if (nLegs) {
      const flown = res.reduce((sum, r) => sum + (isFinite(r.minutesExact) ? r.minutesExact : 0), 0);
      const o = surf(nLegs, isFinite(bsMin) ? bsMin : startMin);
      const d = surf(nLegs + 1, startMin + flown);
      vals['H.temp'] = Weather.fmtTempDew(o); vals['H.wind'] = Weather.fmtWind(o); vals['H.sky'] = Weather.fmtSky(o);
      vals['HL.temp'] = Weather.fmtTempDew(d); vals['HL.wind'] = Weather.fmtWind(d); vals['HL.sky'] = Weather.fmtSky(d);
      // runway in use: most headwind for the forecast surface wind (take-off on the first sheet, landing on the last)
      vals['H.qnh'] = Weather.fmtQnh(o); vals['HL.qnh'] = Weather.fmtQnh(d);
      vals['H.runway'] = runwayInUse(nearestAerodrome(wps[0], 2), o);
      vals['HL.runway'] = runwayInUse(nearestAerodrome(wps[wps.length - 1], 2), d);
    }

    // checkpoints
    vals['dep'] = wps[0] ? wps[0].name : '';
    vals['arr'] = wps.length > 1 ? wps[wps.length - 1].name : '';
    for (let i = 0; i < nLegs; i++) vals[`cp${i}`] = wps[i + 1].name;

    // sunset at destination
    let sunset = '';
    if (wps.length > 1 && date) {
      const m = sunsetFromAip(date, wps[wps.length - 1]);
      if (m !== null) sunset = `SUNSET ${Nav.fmtClock(m)}Z`;
    }
    vals['T.sunset'] = sunset;

    // terminal information
    const term = terminalRows(legs);
    for (const t of term) for (const c of ['field', 'elev', 'rwy', 'freq']) vals[`T.${t.id}.${c}`] = t[c] || '';

    // notes
    vals['notes'] = autoNotes(totals, card, nLegs);

    lastCalc = { vals, rows, legs, totals, term, winds, nLegs, startMin, bsSet: isFinite(bsMin) };
    return lastCalc;
  }

  function runwayInUse(ad, sfc) {
    if (!ad || !ad.runways.length) return '';
    const ends = ad.runways.flatMap((r) => r.split('/')).map((e) => ({ e, hdg: parseInt(e, 10) * 10 })).filter((x) => x.hdg > 0);
    if (!ends.length) return '';
    let best = ends[0];
    if (sfc && sfc.wind && sfc.wind.spd >= 1) {
      const wMag = sfc.wind.dir - (num(state.variation) || 0);      // forecast wind is true; runways are magnetic
      const head = (x) => Math.cos(((wMag - x.hdg) * Math.PI) / 180);
      best = ends.reduce((a, b) => (head(b) > head(a) + 1e-9 ? b : a));
    }
    // parallel runways: list both sides, e.g. 03L/R
    const par = ends.filter((x) => x.hdg === best.hdg).map((x) => x.e);
    return par.length > 1 ? par[0] + '/' + par.slice(1).map((x) => x.replace(/^\d+/, '')).join('/') : best.e;
  }

  // Sunset from AIP GEN 2.7 (National Observatory of Athens tables); fields not listed use the nearest
  // listed aerodrome (GEN 2.7.2). Outside Greece, the NOAA algorithm.
  function sunsetFromAip(date, p) {
    if (typeof SUN !== 'undefined') {
      let best = null, bd = Infinity;
      for (const [icao, t] of Object.entries(SUN)) { const d = Nav.distanceNm(p, t); if (d < bd) { bd = d; best = t; } }
      if (best && bd < 120) {
        const [, mo, da] = date.split('-').map(Number);
        const idx = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31].slice(0, mo - 1).reduce((a, b) => a + b, 0) + da - 1;
        if (best.ss[idx] != null) return best.ss[idx];
      }
    }
    const m = Nav.sunsetUtcMinutes(date, p.lat, p.lon);
    return m === null ? null : Math.floor(m);
  }

  function parseHmm(s) {
    s = String(s || '').trim();
    let m = s.match(/^(\d+):(\d{1,2})$/); if (m) return +m[1] * 60 + +m[2];
    m = s.match(/^\d+$/); if (m) return +s;
    return NaN;
  }

  function terminalRows(legs) {
    const wps = state.waypoints;
    const rows = [];
    if (wps.length < 2) return rows;
    const dep = nearestAerodrome(wps[0], 2), arr = nearestAerodrome(wps[wps.length - 1], 2);
    const adRow = (a, id) => ({ id, field: adField(a), elev: isFinite(a.elevFt) ? String(a.elevFt) : '', rwy: a.runways.map((r) => r.replace('/', ' / ')).join(', '), freq: aerodromeFreqText(a) });
    if (dep) rows.push(adRow(dep, 'ad-' + dep.id)); else rows.push({ id: 'dep', field: wps[0].name });
    // aerodromes passed over / near the route
    const radius = num(state.fieldRadius);
    const enr = [];
    if (radius >= 0) {
      for (const a of ADS) {
        if (a.water || (dep && a.id === dep.id) || (arr && a.id === arr.id)) continue;
        let best = null;
        legs.forEach((L, i) => {
          const d = Nav.pointSegDistNm(a, L.a, L.b);
          if (d.dist <= radius && (!best || i + d.t < best.pos)) best = { pos: i + d.t };
        });
        if (best) enr.push({ a, pos: best.pos });
      }
    }
    enr.sort((x, y) => x.pos - y.pos).forEach((e) => rows.push(adRow(e.a, 'ad-' + e.a.id)));
    if (!arr) rows.push({ id: 'arr', field: wps[wps.length - 1].name });
    else if (!(dep && arr.id === dep.id)) rows.push(adRow(arr, 'ad-' + arr.id + '-arr'));

    // airspace (TMA / MTMA) entered at the planned altitude
    const hits = new Map();
    legs.forEach((L, i) => {
      for (const v of AIP.airspace) {
        const lo = Nav.parseLevelFt(v.lower), hi = Nav.parseLevelFt(v.upper);
        const altOk = !isFinite(L.alt) || (L.alt >= lo && L.alt <= hi);
        if (!altOk) continue;
        if (!Nav.segmentEntersPolygon(L.a, L.b, v.polygon)) continue;
        if (!hits.has(v.name)) hits.set(v.name, { first: i, vols: [] });
        const h = hits.get(v.name);
        if (!h.vols.includes(v)) h.vols.push(v);
      }
    });
    [...hits.entries()].sort((a, b) => a[1].first - b[1].first).forEach(([name, h]) => {
      const units = [];
      for (const v of h.vols) for (const u of v.units) if (!units.some((x) => x.callsign === u.callsign)) units.push(u);
      const lim = (x) => x.replace(/ FT AGL$/, "' AGL").replace(/ FT$/, "'");
      const limits = [...new Set(h.vols.map((v) => `${lim(v.lower)}–${lim(v.upper)}`))].join(', ');
      rows.push({ id: 'as-' + name.replace(/\W+/g, '-'), field: name, elev: '', rwy: '', freq: units.map(unitText).join(' · '), limits });
    });

    // FIS (always both, as requested)
    const f = AIP.fis.units;
    rows.push({ id: 'fis', field: 'FIS', elev: '', rwy: '', freq: `ATHINAI/MAKEDONIA INFO ${f[0].freqs.join(' ')}` });

    const hidden = new Set(state.termHidden);
    const out = rows.filter((r) => !hidden.has(r.id));
    state.termManual.forEach((id) => out.push({ id, field: '', elev: '', rwy: '', freq: '', manual: true }));
    return out;
  }

  function autoNotes(totals, card, nLegs) {
    const lines = [];
    if (nLegs) lines.push(`Taxi fuel ${num(state.fuelExtra) || 0} L`);
    const left = cardDaysLeft(card);
    if (isFinite(left) && left <= 90) lines.push(left < 0 ? `Compass card expired ${fmtDate(card.expires)} — swing required` : `Compass swing due: card expires ${fmtDate(card.expires)}`);
    return lines.join('\n');
  }
  function cardDaysLeft(card) {
    if (!card) return NaN;
    return daysBetween(state.date || new Date().toISOString().slice(0, 10), card.expires);
  }

  // ------------------------------------------------------------------ weather
  function wxSignature() {
    const wps = state.waypoints;
    if (wps.length < 2 || !state.date) return '';
    const mids = [];
    for (let i = 0; i < wps.length - 1; i++) { const m = Nav.midpoint(wps[i], wps[i + 1]); mids.push(m.lat.toFixed(3) + ',' + m.lon.toFixed(3)); }
    mids.push(`${wps[0].lat.toFixed(3)},${wps[0].lon.toFixed(3)}`, `${wps[wps.length - 1].lat.toFixed(3)},${wps[wps.length - 1].lon.toFixed(3)}`);
    return [state.model, state.date, mids.join(';')].join('|');
  }
  let wxTimer = null;
  function scheduleWx(force) {
    const sig = wxSignature();
    if (!sig) { wx = { sig: '', raw: null, status: 'idle', msg: '' }; return; }
    if (!force && sig === wx.sig && wx.status !== 'error') return;
    clearTimeout(wxTimer);
    wxTimer = setTimeout(() => fetchWx(sig), force ? 0 : 500);
  }
  async function fetchWx(sig) {
    const wps = state.waypoints;
    const mids = [];
    for (let i = 0; i < wps.length - 1; i++) mids.push(Nav.midpoint(wps[i], wps[i + 1]));
    mids.push(wps[0], wps[wps.length - 1]); // surface conditions at departure and destination
    const d0 = state.date;
    const d1 = new Date(Date.parse(d0 + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
    wx = { sig, raw: wx.raw, status: 'loading', msg: 'Loading winds…' };
    renderBar();
    try {
      // the next day is included for flights crossing midnight; fall back to one day at the edge of the forecast range
      const raw = await Weather.fetchPoints(mids, d0, d1, state.model).catch(() => Weather.fetchPoints(mids, d0, d0, state.model));
      if (sig !== wxSignature()) return; // superseded
      const now = new Date();
      wx = { sig, raw, status: 'ok', msg: `${Weather.MODELS[state.model] || state.model}, fetched ${now.toISOString().slice(11, 16)}Z`, fetchedAt: now.toISOString().slice(11, 16) };
    } catch (e) {
      if (sig !== wxSignature()) return;
      wx = { sig, raw: null, status: 'error', msg: e.message };
    }
    refresh();
  }

  // ------------------------------------------------------------------ sheet DOM
  const U = (n) => `calc(${n} * var(--u))`;
  function cell(r, c, html, cls = '', rs = 1, cs = 1) {
    return `<div class="${cls}" style="grid-row:${r} / span ${rs};grid-column:${c} / span ${cs}">${html}</div>`;
  }
  const inp = (key, extra = '') => `<input data-key="${key}" ${extra} autocomplete="off" spellcheck="false">`;
  const twoH = (t1, t2) => `<div class="sub2"><div class="h">${t1}</div><div class="h">${t2}</div></div>`;
  const hexSvg = `<svg viewBox="0 0 126 54" preserveAspectRatio="none"><polygon points="0,0 14,27 0,54" fill="#000"/><polygon points="126,0 112,27 126,54" fill="#000"/></svg>`;

  function sheetHtml(sheetIdx, nSheets, legOffset) {
    const H = [];
    // header
    H.push(`<div class="date-top">${inp('H.date', 'class="blank"')}<span class="pgno">${sheetIdx + 1}</span></div>`);
    // TEMP / WIND / SKY: departure on the first sheet, destination on the last one
    const wk = sheetIdx === 0 ? 'H' : sheetIdx === nSheets - 1 ? 'HL' : `HM${sheetIdx}`;
    H.push('<div class="fold-line"></div>');
    H.push(`<div class="g hdr">
      <div class="title">Flight Planner</div>
      <div class="lbl">AIRCRAFT</div><div class="val">${inp('H.aircraft')}</div>
      <div class="lbl">TAKE-OFF</div><div class="val">${inp('H.takeoff')}</div>
      <div class="lbl">BLOCK START</div><div class="val">${inp('H.blockstart')}</div>
      <div class="lbl">BLOCK END</div><div class="val">${inp('H.blockend')}</div>
      <div class="lbl">ATIS CODE</div><div class="val">${inp('H.atis')}</div>
      <div class="lbl">SKY</div><div class="val">${inp(wk + '.sky')}</div>
      <div class="lbl">TEMP</div><div class="val">${inp(wk + '.temp')}</div>
      <div class="lbl">WIND</div><div class="val">${inp(wk + '.wind')}</div>
      <div class="lbl big" style="grid-column:span 2">En Route</div>
      <div class="lbl">QNH</div><div class="val">${inp(wk + '.qnh')}</div>
      <div class="lbl">RUNWAY</div><div class="val">${inp(wk + '.runway')}</div>
      <div class="est">EST ${esc(state.fuelFlow)}lt/h = ${esc(+(state.fuelFlow / 60).toFixed(2))}lt/min</div>
    </div>`);

    // main table
    const C = [];
    C.push(cell(1, 1, 'PLANNED', 'h c', 1, 2));
    C.push(cell(2, 1, 'TRUE<br>COURSE', 'h', 2));
    C.push(cell(2, 2, 'ALTITUDE', 'h', 2));
    C.push(cell(1, 3, 'PREDICTED WIND', 'h c', 1, 2));
    C.push(cell(2, 3, 'DIRECTION', 'h', 2));
    C.push(cell(2, 4, 'VELOCITY', 'h', 2));
    C.push(cell(1, 5, 'TEMP', 'h', 3));
    C.push(cell(1, 6, 'PLAN TAS', 'h', 3));
    C.push(cell(1, 7, 'WIND<br>CORR<br>ANGLE<br>-L&nbsp;&nbsp;+R', 'h', 3));
    C.push(cell(1, 8, twoH('TRUE<br>HEADING', '-E +W&nbsp;&nbsp;VAR'), '', 3));
    C.push(cell(1, 9, twoH('MAG<br>HEADING', '± DEV'), 'fold', 3));
    C.push(cell(1, 10, 'Checkpoints', 'h big', 1));
    // top box: the departure, or on a continuation sheet the waypoint this sheet starts from
    const topKey = sheetIdx === 0 ? 'dep' : `cp${legOffset - 1}`;
    C.push(cell(2, 10, `<div class="sub2" style="grid-template-rows:auto 1fr"><div class="h" style="border:0">${sheetIdx === 0 ? 'DEPARTURE' : ''}</div><div class="dep">${inp(topKey)}</div></div>`, 'cp-end', 2));
    C.push(cell(1, 11, 'COMPASS<br>HEADING', 'h', 3));
    C.push(cell(1, 12, 'DIST', 'h')); C.push(cell(1, 13, 'GS', 'h'));
    C.push(cell(2, 12, 'LEG', 'h')); C.push(cell(2, 13, 'EST', 'h'));
    C.push(cell(3, 12, 'REM', 'h')); C.push(cell(3, 13, 'ACT', 'h'));
    C.push(cell(1, 14, twoH('ETE', 'ATE'), '', 3));
    C.push(cell(1, 15, twoH('ETA', 'ATA'), '', 3));
    C.push(cell(1, 16, twoH('FUEL<br>USED', 'FUEL<br>REM.'), '', 3));
    C.push(cell(1, 17, '<b>VOR</b>', 'h c', 1, 2));
    C.push(cell(2, 17, 'FREQ', 'h')); C.push(cell(2, 18, 'BEARING', 'h'));
    C.push(cell(3, 17, 'IDENT', 'h')); C.push(cell(3, 18, 'TO/FROM', 'h'));
    C.push(cell(1, 19, "TRANS-<br>PONDER<br>CODES<br>'SQUAWKS'", 'h', 3));

    for (let j = 0; j < LEGS_PER_SHEET; j++) {
      const i = legOffset + j;
      const r = 4 + 2 * j;
      const k = `L${i}.`;
      C.push(cell(r, 1, inp(k + 'tc'), '', 2));
      C.push(cell(r, 2, inp(k + 'alt'), '', 2));
      C.push(cell(r, 3, inp(k + 'wd'), '', 2));
      C.push(cell(r, 4, inp(k + 'ws'), '', 2));
      C.push(cell(r, 5, inp(k + 'temp'), '', 2));
      C.push(cell(r, 6, inp(k + 'tas'), '', 2));
      C.push(cell(r, 7, inp(k + 'wca'), '', 2));
      C.push(cell(r, 8, inp(k + 'th'))); C.push(cell(r + 1, 8, inp(k + 'var')));
      C.push(cell(r, 9, inp(k + 'mh'), 'fold')); C.push(cell(r + 1, 9, inp(k + 'dev'), 'fold'));
      // the arrows sit on the leg row (they point along the leg) ...
      C.push(cell(r, 10, hexSvg, 'cp', 2));
      // ... and the checkpoint ending this leg sits on the line to the next leg, between two pairs of arrows
      if (j < LEGS_PER_SHEET - 1) C.push(cell(r + 1, 10, `<textarea data-key="cp${i}" rows="2" spellcheck="false"></textarea>`, 'cpn', 2));
      C.push(cell(r, 11, inp(k + 'ch'), '', 2));
      C.push(cell(r, 12, inp(k + 'dist'))); C.push(cell(r + 1, 12, inp(k + 'rem')));
      C.push(cell(r, 13, inp(k + 'gs'))); C.push(cell(r + 1, 13, inp(k + 'gsact', 'class="blank"')));
      C.push(cell(r, 14, inp(k + 'ete'))); C.push(cell(r + 1, 14, inp(k + 'ate')));
      C.push(cell(r, 15, inp(k + 'eta', 'class="blank"'))); C.push(cell(r + 1, 15, inp(k + 'ata', 'class="blank"')));
      C.push(cell(r, 16, inp(k + 'fuel'))); C.push(cell(r + 1, 16, inp(k + 'fuelrem', 'class="blank"')));
      C.push(cell(r, 17, inp(k + 'vfreq', 'class="blank"'))); C.push(cell(r + 1, 17, inp(k + 'vident', 'class="blank"')));
      C.push(cell(r, 18, inp(k + 'vbrg', 'class="blank"'))); C.push(cell(r + 1, 18, inp(k + 'vtofrom', 'class="blank"')));
      C.push(cell(r, 19, inp(k + 'sqk', 'class="blank"'), '', 2));
    }
    const tr = 4 + 2 * LEGS_PER_SHEET;
    const last = sheetIdx === nSheets - 1;
    C.push(cell(tr, 1, 'Terminal Information<button class="add-row no-print" data-act="add-row" title="Add a row">+</button>', 'ti-title fold', 1, 9));
    // bottom box: the arrival, or the waypoint ending this sheet's last leg (it starts the next sheet)
    const botKey = last ? 'arr' : `cp${legOffset + LEGS_PER_SHEET - 1}`;
    C.push(cell(tr, 10, `<div class="sub2" style="grid-template-rows:auto 1fr"><div class="h" style="border:0">${last ? 'ARRIVAL' : ''}</div><div class="dep">${inp(botKey)}</div></div>`, 'cp-end total-row'));
    C.push(cell(tr, 11, 'TOTALS', 'tot-label total-row'));
    // whole-flight totals on every sheet
    C.push(cell(tr, 12, inp('T.dist'), 'total-row'));
    C.push(cell(tr, 13, '', 'total-row'));
    C.push(cell(tr, 14, inp('T.ete'), 'total-row'));
    C.push(cell(tr, 15, '', 'total-row'));
    C.push(cell(tr, 16, inp('T.fuel'), 'total-row'));
    C.push(cell(tr, 17, inp('T.sunset'), 'sunset total-row', 1, 3));
    const rowsTpl = `${U(19)} ${U(19)} ${U(19)} repeat(${2 * LEGS_PER_SHEET}, ${U(27)}) ${U(30)}`;
    H.push(`<div class="g tbl" style="grid-template-rows:${rowsTpl}">${C.join('')}</div>`);

    // terminal info + notes
    const term = lastCalc ? lastCalc.term : [];
    const nRows = Math.max(5, term.length);
    const rowH = 165 / nRows;
    const T = [`<div class="th">Field</div><div class="th">Elevation</div><div class="th">Runways</div><div class="th">Radio Frequencies</div>`];
    for (let i = 0; i < nRows; i++) {
      const t = term[i];
      if (!t) { T.push(`<div style="height:${U(rowH)}"></div>`.repeat(4)); continue; }
      const ctl = `<span class="rowctl"><button data-del-row="${t.id}" title="Remove row">×</button></span>`;
      ['field', 'elev', 'rwy', 'freq'].forEach((c, ci) => {
        T.push(`<div class="${ci === 3 ? 'cellrow' : ''}" style="height:${U(rowH)}">${ci === 3 ? ctl : ''}<textarea data-key="T.${t.id}.${c}" rows="1" spellcheck="false"></textarea></div>`);
      });
    }
    H.push(`<div class="g foot"><div class="ti">${T.join('')}</div><div class="notes"><div class="th">Notes:</div><div class="note-lines">${'<div></div>'.repeat(12)}</div><textarea data-key="notes" spellcheck="false"></textarea></div></div>`);
    return H.join('');
  }

  let structSig = '';
  function buildSheets(force) {
    const n = Math.max(1, Math.ceil(lastCalc.nLegs / LEGS_PER_SHEET));
    const sig = `${n}|${lastCalc.term.map((t) => t.id).join(',')}|${state.fuelFlow}`;
    if (!force && sig === structSig) return;
    structSig = sig;
    // keep the cell being typed in (value, caret) across the rebuild
    const ae = document.activeElement;
    const focusKey = ae && ae.dataset && ae.dataset.key;
    const focusState = focusKey ? { value: ae.value, start: ae.selectionStart, end: ae.selectionEnd } : null;
    const host = $('#sheet');
    host.innerHTML = '';
    host.className = '';
    for (let s = 0; s < n; s++) {
      const d = document.createElement('div');
      d.className = 'sheet';
      if (s > 0) d.style.breakBefore = 'page';
      d.innerHTML = sheetHtml(s, n, s * LEGS_PER_SHEET);
      host.appendChild(d);
    }
    page = Math.min(page, n - 1);
    showPage();
    if (focusState) {
      const el = document.querySelector(`#sheet > .sheet.active [data-key="${focusKey}"]`) || document.querySelector(`#sheet [data-key="${focusKey}"]`);
      if (el) { el.value = focusState.value; el.focus(); try { el.setSelectionRange(focusState.start, focusState.end); } catch (e) { /* not a text field */ } }
    }
  }

  // ------------------------------------------------------------------ screen: one sheet at a time, scaled to fit the window
  let page = 0;
  function showPage() {
    const sheets = document.querySelectorAll('#sheet > .sheet');
    sheets.forEach((s, i) => s.classList.toggle('active', i === page));
    $('#pager').hidden = sheets.length < 2;
    $('#pg-label').textContent = `${page + 1}/${sheets.length}`;
    fit();
    fitTerminalText();
  }
  function fit() {
    const stage = $('#stage');
    const bar = $('#bar');
    const pad = 12;
    const availW = window.innerWidth - 2 * pad;
    const availH = window.innerHeight - bar.offsetHeight - 2 * pad;
    const sheet = document.querySelector('#sheet > .sheet.active');
    if (!sheet) return;
    // measure the sheet at 1px per unit, then scale
    stage.style.setProperty('--fit', '1px');
    const w = sheet.offsetWidth, h = sheet.offsetHeight;
    const u = Math.max(0.3, Math.min(availW / w, availH / h));
    stage.style.setProperty('--fit', u + 'px');
    // rules snapped to whole device pixels so they stay crisp at any zoom
    const dpr = window.devicePixelRatio || 1, snap = (w, min) => `${Math.max(min, Math.round(w * dpr)) / dpr}px`;
    stage.style.setProperty('--hair', snap(u, 1));
    stage.style.setProperty('--thick', snap(u * 1.6, 2));
    stage.style.height = (window.innerHeight - bar.offsetHeight) + 'px';
    stage.style.paddingTop = pad + 'px';
  }

  function fillInputs() {
    const v = lastCalc.vals;
    document.querySelectorAll('[data-key]').forEach((el) => {
      if (el === document.activeElement) return;
      const k = el.dataset.key;
      const user = has(k);
      const val = user ? state.ov[k] : (v[k] ?? '');
      if (el.value !== val) el.value = val;
      el.classList.toggle('user', user);
    });
    const c = lastCalc;
    for (let i = 0; i < c.nLegs; i++) {
      const alt = document.querySelector(`.sheet [data-key="L${i}.alt"]`);
      if (alt) alt.classList.toggle('need', !isFinite(c.legs[i].alt));
      const calm = c.rows[i] && c.rows[i].windMissing && isFinite(c.legs[i].alt) && wx.status !== 'loading';
      for (const f of ['wd', 'ws']) { const e = document.querySelector(`.sheet [data-key="L${i}.${f}"]`); if (e) e.classList.toggle('calm', !!calm); }
    }
    fitTerminalText();
  }

  // Shrink any sheet cell whose text is too wide (e.g. long checkpoint names). Sizes are in sheet
  // units so the result holds when printing.
  // On screen only the visible sheet is fitted; when printing, every sheet is.
  const fitScope = () => (matchMedia('print').matches ? '#sheet > .sheet' : '#sheet > .sheet.active');
  // Every filled cell gets the largest font that fits its box (readable in flight), in sheet units
  // so the result holds when printing.
  // Measured text width (the input's scroll width does not notice text running into its padding,
  // e.g. checkpoint names over the hexagon arrows)
  const measureCtx = document.createElement('canvas').getContext('2d');
  function textWidth(el) {
    const cs = getComputedStyle(el);
    measureCtx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    return measureCtx.measureText(el.value).width;
  }
  function room(el) {
    const cs = getComputedStyle(el);
    return el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 1;
  }
  // Checkpoint names: largest size that fits between the arrows, on one line or wrapped onto two
  // at a space; vertically centred in the hexagon.
  function fitCheckpoints(uPx) {
    document.querySelectorAll(fitScope() + ' .cpn textarea').forEach((el) => {
      el.style.fontSize = ''; el.style.paddingTop = '';
      const text = el.value.trim();
      if (!text) return;
      const cs = getComputedStyle(el);
      const w = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 1;
      const h = el.clientHeight;
      const words = text.split(/\s+/);
      const width = (t, px) => { measureCtx.font = `${cs.fontStyle} ${cs.fontWeight} ${px}px ${cs.fontFamily}`; return measureCtx.measureText(t).width; };
      let best = { px: 3, lines: 1 };
      // the white hexagon is widest on the line between legs; text stays within its middle half
      for (let px = Math.min(17 * uPx, h * 0.46); px > 3; px *= 0.95) {
        if (width(text, px) <= w) { best = { px, lines: 1 }; break; }
        if (words.length > 1 && 2 * px * 1.08 <= h * 0.6) {
          const ok = words.slice(1).some((_, k) => Math.max(width(words.slice(0, k + 1).join(' '), px), width(words.slice(k + 1).join(' '), px)) <= w);
          if (ok) { best = { px, lines: 2 }; break; }
        }
      }
      el.style.fontSize = `calc(${(best.px / uPx).toFixed(2)} * var(--u))`;
      el.style.lineHeight = '1.08';
      el.style.paddingTop = `${Math.max(0, (h - best.lines * best.px * 1.08) / 2).toFixed(1)}px`;
    });
  }
  function fitInputs() {
    const sh = document.querySelector(fitScope());
    if (!sh || !sh.offsetWidth) return;
    const uPx = sh.offsetWidth / 1145; // the sheet is 1145 units wide
    fitCheckpoints(uPx);
    document.querySelectorAll(fitScope() + ' input').forEach((el) => {
      el.style.fontSize = '';
      if (!el.value) return;
      const cap = el.closest('.cp') ? 17 : el.closest('.date-top') ? 16 : 21;     // names / date / numbers
      let size = Math.min(cap, (el.clientHeight / uPx) * 0.82);
      el.style.fontSize = `calc(${size.toFixed(2)} * var(--u))`;
      while (textWidth(el) > room(el) && size > 4) {
        size *= 0.94;
        el.style.fontSize = `calc(${size.toFixed(2)} * var(--u))`;
      }
    });
  }

  // Shrink terminal-information text until it fits its cell (sizes in sheet units, so it holds in print).
  function fitTerminalText() {
    fitInputs();
    document.querySelectorAll(fitScope() + ' .foot .ti textarea').forEach((el) => {
      const col = el.dataset.key.split('.').pop();
      let size = col === 'elev' || col === 'rwy' || col === 'field' ? 17 : 12;   // largest that fits
      el.style.fontSize = `calc(${size} * var(--u))`;
      while (el.scrollHeight > el.clientHeight + 1 && size > 4.5) {
        size -= 0.5;
        el.style.fontSize = `calc(${size} * var(--u))`;
      }
    });
  }

  // ------------------------------------------------------------------ bar + settings
  function renderControls() {
    const setv = (sel, v) => { const e = $(sel); if (e !== document.activeElement) e.value = v; };
    setv('#windy-url', state.windyUrl || '');
    setv('#date', state.date || '');
    setv('#block-start', state.blockStart || '');
    $('#aircraft').value = state.aircraft;
    setv('#aircraft-other', state.aircraftOther || '');
    $('#aircraft-other').hidden = state.aircraft !== 'OTHER';
    const ac = AIRCRAFT[state.aircraft];
    $('#card-wrap').hidden = !ac;
    if (ac) {
      $('#card').innerHTML = Object.keys(ac.cards).map((c) => `<option>${esc(c)}</option>`).join('');
      if (!ac.cards[state.card]) state.card = Object.keys(ac.cards)[0];
      $('#card').value = state.card;
      const c = ac.cards[state.card];
      $('#card-info').textContent = `Swung ${c.swung} · valid to ${c.expires}`;
    }
    setv('#taxi-min', state.taxiMin);
    if (!$('#model').options.length) $('#model').innerHTML = Object.entries(Weather.MODELS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
    $('#model').value = state.model;
    setv('#variation', Math.abs(state.variation));
    $('#variation-ew').value = state.variation < 0 ? 'W' : 'E';
    setv('#field-radius', state.fieldRadius);
    setv('#fuel-flow', state.fuelFlow);
    setv('#fuel-extra', state.fuelExtra);
    renderTitle();
    if (state.waypoints.length > 1) $('#btn-open-windy').href = Nav.windyUrl(state.waypoints, state.date, Math.floor((Nav.parseClock(state.blockStart) || 720) / 60));
  }

  function renderTitle() {
    const t = $('#title');
    if (t !== document.activeElement) t.value = titleOf(state);
    document.title = `${titleOf(state)} · Navlog`;
  }

  // Short status chips; details live in the tooltip.
  function renderBar() {
    const chips = [];
    const c = lastCalc;
    if (c && c.nLegs) {
      if (wx.status === 'loading') chips.push(['', 'Winds…', 'Loading winds']);
      else if (wx.status === 'error') chips.push(['err', 'Winds ✗', `${wx.msg}. Type the wind on the sheet or change date/model.`]);
      else if (wx.status === 'ok') {
        const missing = c.rows.map((r, i) => (r.windMissing && isFinite(c.legs[i].alt) ? i + 1 : null)).filter(Boolean);
        if (missing.length) chips.push(['err', `No wind: leg ${missing.join(',')}`, 'The forecast has no data for that time; calm wind is used. Type the wind on the sheet or change the model.']);
        else chips.push(['ok', 'Winds ✓', wx.msg]);
      }
      c.rows.forEach((r, i) => { if (!isFinite(r.gs) && isFinite(c.legs[i].tas)) chips.push(['err', `Leg ${i + 1}: no solution`, 'Crosswind exceeds TAS']); });
    }
    const card = currentCard();
    const left = cardDaysLeft(card);
    if (card && left < 0) chips.push(['err', 'Compass card expired', `${registration()} ${state.card}: expired ${card.expires}`]);
    else if (card && left <= 90) chips.push(['warn', `Card exp. ${card.expires}`, `${registration()} ${state.card}: ${left} days left — schedule a compass swing`]);
    if (state.aircraft === 'OTHER') chips.push(['', 'No DEV card', 'Type DEV per leg on the sheet']);
    document.body.dataset.wx = wx.status;
    $('#chips').innerHTML = chips.map(([k, t, tip]) => `<span class="chip ${k}" title="${esc(tip)}">${esc(t)}</span>`).join('');
    $('#block-start').classList.toggle('empty-req', !!(c && c.nLegs && !c.bsSet));
    fit();
  }

  // ------------------------------------------------------------------ refresh
  function refresh(forceStruct) {
    calc();
    buildSheets(forceStruct);
    fillInputs();
    renderBar();
    save();
  }

  // ------------------------------------------------------------------ route loading
  // Load a route from a Windy URL. Names, altitudes and TAS typed earlier are kept for waypoints
  // and legs that did not move (so editing the route on Windy and re-pasting keeps your work).
  function loadRoute(text, quiet) {
    const r = Nav.parseWindyUrl(text);
    $('#windy-url').classList.toggle('invalid', !r && !!String(text).trim());
    if (!r) return false;
    const n = r.points.length;
    const old = state.waypoints;
    const same = (a, b) => Nav.distanceNm(a, b) < 0.1;
    const legKey = (a, b) => `${a.lat.toFixed(4)},${a.lon.toFixed(4)}>${b.lat.toFixed(4)},${b.lon.toFixed(4)}`;
    const oldLegs = new Map();
    for (let i = 0; i < old.length - 1; i++) {
      const v = {};
      for (const f of ['alt', 'tas']) if (state.ov[`L${i}.${f}`] !== undefined) v[f] = state.ov[`L${i}.${f}`];
      oldLegs.set(legKey(old[i], old[i + 1]), v);
    }
    const sameCount = old.length === n;
    const oldOv = state.ov;
    const usedOld = new Set();
    state.waypoints = r.points.map((p, i) => {
      // prefer the same position in the list, otherwise any unused old waypoint at the same spot
      let j = old[i] && same(old[i], p) && !usedOld.has(i) ? i : old.findIndex((w, k) => !usedOld.has(k) && same(w, p));
      if (j >= 0) { usedOld.add(j); return { lat: p.lat, lon: p.lon, name: old[j].name }; }
      return { lat: p.lat, lon: p.lon, name: autoName(p, i, n) };
    });
    // leg overrides: keep alt/TAS for unchanged legs (by endpoints); with an unchanged leg count also keep them by index
    const ov = {};
    for (const [k, v] of Object.entries(oldOv)) if (!/^L\d+\./.test(k)) ov[k] = v;
    for (let i = 0; i < n - 1; i++) {
      const kept = oldLegs.get(legKey(state.waypoints[i], state.waypoints[i + 1])) || (sameCount ? { alt: oldOv[`L${i}.alt`], tas: oldOv[`L${i}.tas`] } : {});
      for (const f of ['alt', 'tas']) if (kept[f] !== undefined) ov[`L${i}.${f}`] = kept[f];
    }
    state.ov = ov;
    state.windyUrl = text.trim();
    if (r.date) state.date = r.date;
    if (r.hour !== null && !state.blockStart) state.blockStart = `${String(r.hour).padStart(2, '0')}:00Z`;
    state.termHidden = [];
    $('#windy-url').title = `${n} waypoints, ${n - 1} legs`;
    renderControls();
    refresh(true);
    scheduleWx(true);
    if ($('#route-dialog').open) $('#route-dialog').close();
    return true;
  }

  // ------------------------------------------------------------------ events
  function onKeyInput(el) {
    const k = el.dataset.key;
    const v = el.value;
    if (k === 'H.blockstart') { state.blockStart = v; $('#block-start').value = v; scheduleWx(); refresh(); return; }
    if (k === 'H.date') { if (isIsoDate(v.trim())) { state.date = v.trim(); $('#date').value = state.date; scheduleWx(); refresh(); } return; }
    if (k === 'H.aircraft') { const reg = v.trim().toUpperCase(); if (AIRCRAFT[reg]) state.aircraft = reg; else { state.aircraft = 'OTHER'; state.aircraftOther = reg; } renderControls(); refresh(); return; }
    if (k === 'dep' || k === 'arr' || /^cp\d+$/.test(k)) {
      const idx = k === 'dep' ? 0 : k === 'arr' ? state.waypoints.length - 1 : +k.slice(2) + 1;
      if (state.waypoints[idx]) state.waypoints[idx].name = v;
      refresh();
      return;
    }
    if (v.trim() === '') delete state.ov[k]; else state.ov[k] = v;
    el.classList.toggle('user', v.trim() !== '');
    if (/^L\d+\.(alt|tas)$/.test(k)) document.querySelectorAll(`[data-key="${k}"]`).forEach((o) => { if (o !== el) o.value = v; });
    refresh();
  }

  function bind() {
    document.addEventListener('input', (e) => { if (e.target.dataset.key) onKeyInput(e.target); });
    // UTC clock cells are written HH:MMZ (typed 0930, 9:30 or 09:30Z all become 09:30Z)
    const ZKEYS = /^(H\.(takeoff|blockend|blockstart)|L\d+\.(eta|ata))$/;
    document.addEventListener('focusout', (e) => {
      const el = e.target;
      if (el.dataset && el.dataset.key && ZKEYS.test(el.dataset.key) && has(el.dataset.key)) {
        const m = Nav.parseClock(state.ov[el.dataset.key]);
        if (isFinite(m)) { state.ov[el.dataset.key] = Nav.fmtClock(m) + 'Z'; save(); }
      }
      if ((el.id === 'block-start' || (el.dataset && el.dataset.key === 'H.blockstart')) && isFinite(Nav.parseClock(el.value))) { state.blockStart = Nav.fmtClock(Nav.parseClock(el.value)) + 'Z'; $('#block-start').value = state.blockStart; save(); refresh(); }
      if (el.dataset && el.dataset.key) fillInputs();
    });
    let justFocused = null;
    document.addEventListener('focusin', (e) => {
      const el = e.target;
      if ((el.tagName === 'INPUT' || el.closest('.cpn')) && el.closest('.sheet')) { el.select(); justFocused = el; }
    });
    // keep the selection made on focus (the mouseup of the same click would otherwise collapse it)
    document.addEventListener('mouseup', (e) => { if (justFocused && e.target === justFocused) e.preventDefault(); justFocused = null; });

    // Enter commits the typed value (leaves the cell); Notes keeps Enter for new lines
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
      const el = e.target;
      if (!(el.matches && el.matches('input, textarea')) || el.dataset.key === 'notes' || el.type === 'file' || el.closest('dialog, #login')) return;
      e.preventDefault();
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
    });

    // undo / redo (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y)
    document.addEventListener('keydown', (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo(); }
    });
    document.addEventListener('click', (e) => {
      const t = e.target;
      if (t.dataset.delRow) {
        const id = t.dataset.delRow;
        if (state.termManual.includes(id)) state.termManual = state.termManual.filter((x) => x !== id);
        else state.termHidden.push(id);
        for (const k of Object.keys(state.ov)) if (k.startsWith(`T.${id}.`)) delete state.ov[k];
        refresh(true);
      } else if (t.dataset.act === 'add-row') {
        state.termManual.push('m' + Date.now().toString(36));
        refresh(true);
      }
    });
    $('#btn-restore-rows').onclick = () => { state.termHidden = []; refresh(true); };
    $('#btn-settings').onclick = () => { renderControls(); $('#settings').showModal(); };
    $('#btn-route').onclick = () => openRouteDialog();
    $('#pg-prev').onclick = () => { const n = document.querySelectorAll('#sheet > .sheet').length; page = (page + n - 1) % n; showPage(); };
    $('#pg-next').onclick = () => { const n = document.querySelectorAll('#sheet > .sheet').length; page = (page + 1) % n; showPage(); };
    window.addEventListener('resize', () => { fit(); fitTerminalText(); });
    // re-fit text for the printed page size (and back for the screen)
    matchMedia('print').addEventListener('change', () => fitTerminalText());
    window.addEventListener('beforeprint', () => fitTerminalText());
    window.addEventListener('afterprint', () => fitTerminalText());
    // OK / Enter applies the link; a pasted valid link applies straight away
    $('#route-dialog').addEventListener('submit', (e) => {
      if (e.submitter && e.submitter.value === 'cancel') return;
      e.preventDefault();
      applyRouteLink($('#windy-url').value, true);
    });
    // load as soon as the box holds a valid route that differs from the current one (typed or pasted)
    let urlTimer = null;
    $('#windy-url').addEventListener('input', (e) => {
      const v = e.target.value;
      if (currentId) { state.windyUrl = v; save(); }
      clearTimeout(urlTimer);
      urlTimer = setTimeout(() => loadIfNew(v), 400);
    });
    function loadIfNew(v) { applyRouteLink(v, false); }
    // explicit: OK / Enter (always applies, even the same route); implicit: as typed or pasted (only when it changed)
    function applyRouteLink(v, explicit) {
      const r = Nav.parseWindyUrl(v);
      const hint = $('#route-hint');
      $('#windy-url').classList.toggle('invalid', !r && !!v.trim());
      hint.classList.toggle('err', !r && !!v.trim());
      hint.textContent = r ? `${r.points.length} waypoints` : v.trim() ? 'This isn’t a Windy route-planner link. In Windy, open the route planner, click your waypoints and copy the address.' : '';
      if (!r) return;
      if (!currentId) { newFlightFromWindy(v); return; }
      const cur = state.waypoints;
      const unchanged = r.points.length === cur.length && r.points.every((p, i) => Nav.distanceNm(p, cur[i]) < 0.01);
      if (!unchanged) loadRoute(v, true);
      else if (explicit) $('#route-dialog').close();
    }
    $('#btn-reverse').onclick = () => {
      state.waypoints.reverse();
      const n = state.waypoints.length - 1;
      const alts = Array.from({ length: n }, (_, i) => state.ov[`L${i}.alt`]);
      const tas = Array.from({ length: n }, (_, i) => state.ov[`L${i}.tas`]);
      for (const k of Object.keys(state.ov)) if (/^L\d+\./.test(k)) delete state.ov[k];
      alts.reverse().forEach((v, i) => { if (v !== undefined) state.ov[`L${i}.alt`] = v; });
      tas.reverse().forEach((v, i) => { if (v !== undefined) state.ov[`L${i}.tas`] = v; });
      renderControls(); refresh(true); scheduleWx(true);
    };
    $('#date').oninput = (e) => {
      const v = e.target.value.trim();
      const ok = isIsoDate(v);
      e.target.classList.toggle('invalid', !ok && v !== '');
      if (ok && v !== state.date) { state.date = v; refresh(); scheduleWx(); }
    };
    $('#block-start').oninput = (e) => {
      let v = e.target.value.trim();
      if (/^\d{4}$/.test(v)) v = v.slice(0, 2) + ':' + v.slice(2);
      state.blockStart = v; refresh(); scheduleWx();
    };
    $('#aircraft').onchange = (e) => { state.aircraft = e.target.value; renderControls(); refresh(); if (e.target.value === 'OTHER') $('#aircraft-other').focus(); };
    $('#aircraft-other').oninput = (e) => { state.aircraftOther = e.target.value; refresh(); };
    $('#card').onchange = (e) => { state.card = e.target.value; renderControls(); refresh(); };
    $('#taxi-min').oninput = (e) => { state.taxiMin = num(e.target.value) || 0; refresh(); };
    $('#model').onchange = (e) => { state.model = e.target.value; refresh(); scheduleWx(); };
    const setVar = () => { const n = Math.abs(num($('#variation').value) || 0); state.variation = $('#variation-ew').value === 'W' ? -n : n; refresh(); };
    $('#variation').oninput = setVar;
    $('#variation-ew').onchange = setVar;
    $('#field-radius').oninput = (e) => { state.fieldRadius = num(e.target.value); refresh(); };
    $('#fuel-flow').oninput = (e) => { state.fuelFlow = num(e.target.value) || 30; refresh(true); };
    $('#fuel-extra').oninput = (e) => { state.fuelExtra = num(e.target.value) || 0; refresh(); };
    $('#btn-winds').onclick = () => { Weather.clearCache(); scheduleWx(true); };
    $('#btn-print').onclick = () => window.print();
    $('#title').addEventListener('input', (e) => { state.title = e.target.value.trim() === autoTitle(state) ? '' : e.target.value; save(); });
    $('#title').addEventListener('focusout', () => renderTitle());
    bindMenus();
  }

  // ------------------------------------------------------------------ calendar for date fields
  // Clicking a date field opens a month view; typing YYYY-MM-DD keeps working.
  const cal = { target: null, y: 0, m: 0 };
  function openCalendar(el) {
    cal.target = el;
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(el.value) ? el.value : (state.date || new Date().toISOString().slice(0, 10));
    cal.y = +iso.slice(0, 4); cal.m = +iso.slice(5, 7) - 1;
    renderCalendar();
    const box = $('#cal'), r = el.getBoundingClientRect();
    box.hidden = false;
    box.style.left = `${Math.max(8, Math.min(r.left, innerWidth - box.offsetWidth - 8))}px`;
    box.style.top = `${r.bottom + 6 + box.offsetHeight > innerHeight ? r.top - box.offsetHeight - 6 : r.bottom + 6}px`;
  }
  function closeCalendar() { $('#cal').hidden = true; cal.target = null; }
  function renderCalendar() {
    const first = new Date(Date.UTC(cal.y, cal.m, 1));
    $('#cal-title').textContent = first.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const sel = cal.target && cal.target.value, today = new Date().toISOString().slice(0, 10);
    const start = new Date(first); start.setUTCDate(1 - ((first.getUTCDay() + 6) % 7));     // weeks start on Monday
    let html = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => `<span class="dow">${d}</span>`).join('');
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setUTCDate(start.getUTCDate() + i);
      const iso = d.toISOString().slice(0, 10);
      html += `<button type="button" data-date="${iso}" class="${d.getUTCMonth() !== cal.m ? 'out' : ''} ${iso === today ? 'today' : ''} ${iso === sel ? 'sel' : ''}">${d.getUTCDate()}</button>`;
    }
    $('#cal-grid').innerHTML = html;
  }
  function pickDate(iso) {
    const el = cal.target;
    closeCalendar();
    if (!el) return;
    el.value = iso;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.blur();
  }
  function bindCalendar() {
    const isDate = (el) => el && (el.id === 'date' || (el.dataset && el.dataset.key === 'H.date'));
    document.addEventListener('mousedown', (e) => {
      if (isDate(e.target)) { if (cal.target !== e.target) openCalendar(e.target); }
      else if (!e.target.closest('#cal')) closeCalendar();
    });
    document.addEventListener('focusin', (e) => { if (isDate(e.target) && cal.target !== e.target) openCalendar(e.target); });
    document.addEventListener('keydown', (e) => {
      if (!cal.target) return;
      if (e.key === 'Escape' || e.key === 'Tab') closeCalendar();
    });
    document.addEventListener('input', (e) => { if (cal.target && e.target === cal.target && /^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) { cal.y = +e.target.value.slice(0, 4); cal.m = +e.target.value.slice(5, 7) - 1; renderCalendar(); } });
    $('#cal').addEventListener('mousedown', (e) => e.preventDefault());   // keep focus in the field
    $('#cal').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.date) pickDate(b.dataset.date);
      else if (b.dataset.step) { cal.m += +b.dataset.step; if (cal.m < 0) { cal.m = 11; cal.y--; } if (cal.m > 11) { cal.m = 0; cal.y++; } renderCalendar(); }
      else if (b.id === 'cal-today') pickDate(new Date().toISOString().slice(0, 10));
    });
  }

  // ------------------------------------------------------------------ menus
  function closeMenus() {
    document.querySelectorAll('.menu').forEach((m) => { m.hidden = true; });
    document.querySelectorAll('.menu-btn.open').forEach((b) => b.classList.remove('open'));
  }
  function openMenu(btn) {
    closeMenus();
    const m = document.querySelector(`.menu[data-menu="${btn.dataset.menu}"]`);
    if (btn.dataset.menu === 'edit') {
      $('#btn-undo').disabled = !history.past.length;
      $('#btn-redo').disabled = !history.future.length;
      $('#btn-restore-rows').hidden = !state.termHidden.length;
    }
    m.hidden = false; btn.classList.add('open');
  }
  function toast(text, action, onAction) {
    const t = $('#toast');
    $('#toast-text').textContent = text;
    $('#toast-action').textContent = action || '';
    $('#toast-action').hidden = !action;
    $('#toast-action').onclick = () => { t.hidden = true; onAction && onAction(); };
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 6000);
  }
  function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function fileName(st) { return `${titleOf(st).replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-') || 'flight'}-${st.date || ''}.navlog.json`; }

  function bindMenus() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.menu-btn');
      if (btn) { const open = btn.classList.contains('open'); closeMenus(); if (!open) openMenu(btn); return; }
      if (e.target.closest('.menu > button, .menu > a') || !e.target.closest('.menu')) closeMenus();
      if (!e.target.closest('#row-menu, .more')) $('#row-menu').hidden = true;
    });
    document.querySelectorAll('.menu-btn').forEach((b) => b.addEventListener('mouseenter', () => {
      if (document.querySelector('.menu-btn.open') && !b.classList.contains('open')) openMenu(b);
    }));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMenus(); $('#row-menu').hidden = true; } });
    $('#file-import').addEventListener('change', () => closeMenus());

    $('#btn-new').onclick = () => newFlight();
    $('#btn-copy').onclick = () => copyFlight(state, currentId);
    $('#btn-print-menu').onclick = () => window.print();
    $('#btn-undo').onclick = () => undo();
    $('#btn-redo').onclick = () => redo();
    $('#btn-export').onclick = () => download(fileName(state), JSON.stringify(state, null, 1));
    $('#file-import').onchange = async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      let data;
      try { data = JSON.parse(await f.text()); } catch (err) { toast('Not a Navlog file'); return; }
      const st = Object.assign(structuredClone(DEFAULTS), data);
      const id = await Store.create(st, summaryOf(st, null));
      location.hash = `#/f/${id}`;
    };
    $('#btn-delete').onclick = () => trash(currentId, titleOf(state), true);
    $('#btn-clear-edits').onclick = () => {
      for (const k of Object.keys(state.ov)) if (!/^L\d+\.(alt|tas)$/.test(k)) delete state.ov[k];
      state.termHidden = []; state.termManual = [];
      refresh(true);
      toast('Your edits were cleared', 'Undo', () => undo());
    };

    // home
    $('#new-blank').onclick = () => newFlight();
    $('#new-windy').onclick = () => openRouteDialog();
    $('#search').addEventListener('input', () => renderHome(false));
    $('#flight-list').addEventListener('click', (e) => {
      const more = e.target.closest('.more');
      if (more) {
        e.preventDefault(); e.stopPropagation();
        const m = $('#row-menu');
        m.dataset.id = more.dataset.id;
        const r = more.getBoundingClientRect();
        m.hidden = false;
        m.style.left = `${Math.min(r.right - m.offsetWidth, innerWidth - m.offsetWidth - 8)}px`;
        m.style.top = `${Math.min(r.bottom + 4, innerHeight - m.offsetHeight - 8)}px`;
      }
    });
    $('#row-menu').addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const id = $('#row-menu').dataset.id;
      $('#row-menu').hidden = true;
      const row = homeRows.find((r) => r.id === id);
      const name = row ? row.summary.title : '';
      if (b.dataset.act === 'open') location.hash = `#/f/${id}`;
      else if (b.dataset.act === 'tab') window.open(`#/f/${id}`, '_blank');
      else if (b.dataset.act === 'rename') {
        const f = await Store.get(id);
        const nm = await askName(name);
        if (nm === null) return;
        f.data.title = nm.trim() === autoTitle(f.data) ? '' : nm;
        Store.save(id, f.data, Object.assign({}, f.summary, { title: titleOf(Object.assign(structuredClone(DEFAULTS), f.data)) }));
        renderHome(true);
      } else if (b.dataset.act === 'copy') {
        const f = await Store.get(id);
        await copyFlight(Object.assign(structuredClone(DEFAULTS), f.data), id, true, f.summary);
      } else if (b.dataset.act === 'delete') trash(id, name, false);
    });
    Store.onStatus(renderSaveState);
    document.addEventListener('click', async (e) => {
      const av = e.target.closest('.avatar');
      document.querySelectorAll('.account-menu').forEach((m) => { if (!av || !m.parentElement.contains(av)) m.hidden = true; });
      if (av) { const m = av.parentElement.querySelector('.account-menu'); m.hidden = !m.hidden; }
      if (e.target.closest('.sign-out')) { await fetch('api/logout', { method: 'POST' }); location.reload(); }
    });
  }

  function askName(current) {
    return new Promise((resolve) => {
      const d = $('#rename-dialog');
      $('#rename-input').value = current;
      d.returnValue = '';
      d.onclose = () => resolve(d.returnValue === 'ok' ? $('#rename-input').value : null);
      d.showModal();
      $('#rename-input').select();
    });
  }
  function renderAccount(user) {
    document.querySelectorAll('.account').forEach((el) => {
      el.hidden = !user;
      if (!user) return;
      const initial = (user.name || user.email || '?').trim()[0].toUpperCase();
      el.innerHTML = `<button class="avatar" title="${esc(user.name || '')}\n${esc(user.email || '')}">${user.picture ? `<img src="${esc(user.picture)}" alt="" referrerpolicy="no-referrer">` : `<span>${esc(initial)}</span>`}</button>
        <div class="menu account-menu" hidden><div class="who"><b>${esc(user.name || '')}</b><span>${esc(user.email || '')}</span></div><hr><button class="sign-out"><span>Sign out</span></button></div>`;
    });
  }
  function renderSaveState(s) {
    const el = $('#save-state');
    el.textContent = s === 'saving' ? 'Saving…' : s === 'offline' ? 'Offline · saved on this device' : 'Saved';
    el.classList.toggle('offline', s === 'offline');
  }
  function openRouteDialog() {
    $('#windy-url').value = currentId ? (state.windyUrl || '') : '';
    $('#windy-url').classList.remove('invalid');
    $('#route-hint').textContent = ''; $('#route-hint').classList.remove('err');
    $('#route-ok').textContent = currentId ? 'Change route' : 'Create flight';
    $('#route-dialog').showModal();
    $('#windy-url').select();
  }

  // ------------------------------------------------------------------ flights
  async function newFlight(fromState) {
    const st = fromState || blankFlight();
    const id = await Store.create(st, summaryOf(st, null));
    location.hash = `#/f/${id}`;
    return id;
  }
  let creatingFromWindy = false;
  async function newFlightFromWindy(url) {
    if (creatingFromWindy) return;
    creatingFromWindy = true;
    try {
      if ($('#route-dialog').open) $('#route-dialog').close();
      const id = await newFlight();
      await openFlight(id);
      loadRoute(url);
    } finally { creatingFromWindy = false; }
  }
  async function copyFlight(st, fromId, stayHome, fromSummary) {
    const c = structuredClone(st);
    c.title = `Copy of ${titleOf(st)}`;
    // the copy keeps the original's totals for the list until it is opened
    const id = await Store.create(c, Object.assign({}, fromSummary || summaryOf(st, lastCalc), { title: c.title }));
    if (stayHome) { renderHome(true); toast('Copy made', 'Open', () => { location.hash = `#/f/${id}`; }); } else location.hash = `#/f/${id}`;
  }
  async function trash(id, name, leave) {
    await Store.remove(id);
    if (leave) location.hash = '#/';
    else renderHome(true);
    toast(`“${name}” moved to trash`, 'Undo', async () => { await Store.restore(id); if (leave) location.hash = `#/f/${id}`; else renderHome(true); });
  }

  let opening = null;
  async function openFlight(id) {
    if (currentId === id && !$('#flight').hidden) return;
    if (opening && opening.id === id) return opening.p;
    const p = (async () => {
      const f = await Store.get(id);
      if (!f || f.deleted) { location.replace('#/'); toast('That flight was not found'); return; }
      currentId = id;
      state = Object.assign(structuredClone(DEFAULTS), f.data);
      lastSaved = JSON.stringify([state, f.summary]);
      history.past = []; history.future = []; history.last = null; history.key = null;
      wx = { sig: '', raw: null, status: 'idle', msg: '', fetchedAt: null };
      page = 0;
      $('#home').hidden = true;
      $('#flight').hidden = false;
      renderSaveState(Store.status);
      renderControls();
      refresh(true);
      scheduleWx(true);
    })();
    opening = { id, p };
    try { await p; } finally { opening = null; }
  }

  // ------------------------------------------------------------------ home
  let homeRows = [];
  const fmtHm = (m) => (m == null ? '' : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`);
  function thumb(route) {
    if (!route || route.length < 2) return '<svg class="thumb" viewBox="0 0 64 44"></svg>';
    const lat = route.map((p) => p[0]), lon = route.map((p) => p[1]);
    const k = Math.cos(((Math.min(...lat) + Math.max(...lat)) / 2) * Math.PI / 180);
    const w = Math.max(1e-3, (Math.max(...lon) - Math.min(...lon)) * k), h = Math.max(1e-3, Math.max(...lat) - Math.min(...lat));
    const sc = Math.min(52 / w, 32 / h);
    const pts = route.map(([la, lo]) => [6 + ((lo - Math.min(...lon)) * k) * sc + (52 - w * sc) / 2, 38 - (la - Math.min(...lat)) * sc - (32 - h * sc) / 2]);
    const d = pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ');
    return `<svg class="thumb" viewBox="0 0 64 44"><polyline points="${d}" fill="none" stroke="#1f5fbf" stroke-width="1.6" stroke-linejoin="round"/>${pts.map((p) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="1.6" fill="#1f5fbf"/>`).join('')}</svg>`;
  }
  async function renderHome(reload) {
    if (reload !== false) {
      try { homeRows = await Store.list(); } catch (e) { if (e.auth) return showLogin(); homeRows = []; }
    }
    const q = $('#search').value.trim().toLowerCase();
    const rows = homeRows.filter((r) => !q || [r.summary.title, r.summary.date, r.summary.aircraft].join(' ').toLowerCase().includes(q));
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = rows.filter((r) => (r.summary.date || '') >= today).sort((a, b) => (a.summary.date || '').localeCompare(b.summary.date || ''));
    const past = rows.filter((r) => (r.summary.date || '') < today);
    const row = (r) => `<a class="frow" href="#/f/${esc(r.id)}" data-id="${esc(r.id)}">${thumb(r.summary.route)}
      <span><div class="ft">${esc(r.summary.title || 'Untitled flight')}</div><div class="sub">${esc(r.summary.aircraft || '')}</div></span>
      <span class="col">${esc(r.summary.date || '')}</span><span class="col">${r.summary.ete != null ? fmtHm(r.summary.ete) + ' · ' + r.summary.dist + ' NM' : ''}</span>
      <span class="col">${r.summary.fuel != null ? r.summary.fuel + ' L' : ''}</span>
      <button class="more" data-id="${esc(r.id)}" title="More" aria-label="More">⋮</button></a>`;
    $('#flight-list').innerHTML = (upcoming.length ? `<div class="group-label">Upcoming</div>${upcoming.map(row).join('')}` : '') +
      (past.length ? `<div class="group-label">${upcoming.length ? 'Earlier' : 'Recent'}</div>${past.map(row).join('')}` : '');
    $('#empty').hidden = rows.length > 0;
    $('#empty').textContent = q ? 'No matching flights.' : 'No flights yet.';
  }
  function showHome() {
    currentId = null;
    $('#flight').hidden = true;
    $('#home').hidden = false;
    document.title = 'Navlog';
    renderHome(true);
  }
  // Sign in with Google (Google Identity Services); the server checks the token and the allowed account.
  let googleClientId = null;
  function showLogin() {
    $('#login').hidden = false;
    if (showLogin.loaded || !googleClientId) return;
    showLogin.loaded = true;
    const sc = document.createElement('script');
    sc.src = 'https://accounts.google.com/gsi/client';
    sc.async = true;
    sc.onload = () => {
      google.accounts.id.initialize({
        client_id: googleClientId,
        auto_select: true,
        callback: async ({ credential }) => {
          try {
            const r = await Store.login(credential);
            renderAccount(r && r.user);
            $('#login').hidden = true;
            route();
          } catch (err) {
            $('#login-error').textContent = err.status === 403 ? 'This Google account can’t open these flights.' : 'Sign-in failed. Try again.';
            $('#login-error').hidden = false;
          }
        },
      });
      google.accounts.id.renderButton($('#google-button'), { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', width: 260 });
      google.accounts.id.prompt();
    };
    document.head.appendChild(sc);
  }

  // ------------------------------------------------------------------ router
  async function route() {
    const h = location.hash;
    try {
      if (h === '#/new') { const id = await Store.create(blankFlight(), summaryOf(blankFlight(), null)); location.replace(`#/f/${id}`); return; }
      const m = h.match(/^#\/f\/([\w-]+)$/);
      if (m) await openFlight(m[1]);
      else showHome();
    } catch (e) { if (e.auth) showLogin(); else throw e; }
    finally { document.body.classList.remove('loading'); }
  }

  // ------------------------------------------------------------------ init
  $('#data-note').textContent = `Aerodromes, airspace and frequencies: Greek eAIP ${AIP.airac}. VFR points and routes: eAIP VFR charts and open flightmaps. Winds: Open-Meteo.`;
  bind();
  bindCalendar();
  window.addEventListener('hashchange', route);
  (async () => {
    // one-time migration of the single flight kept by the first version
    try {
      const old = localStorage.getItem('navlog.v1');
      if (old) {
        const st = Object.assign(structuredClone(DEFAULTS), JSON.parse(old));
        if (st.waypoints.length) await Store.create(st, summaryOf(st, null));
        localStorage.removeItem('navlog.v1');
      }
    } catch (e) { /* keep it for next time */ }
    const sess = await Store.session();
    googleClientId = sess.googleClientId || null;
    renderAccount(sess.user);
    if (googleClientId && !sess.authed) { document.body.classList.remove('loading'); showLogin(); return; }
    route();
  })();
})();
