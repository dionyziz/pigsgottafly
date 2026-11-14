// Pure navigation helpers. Works in the browser (window.Nav) and in Node (module.exports).
(function (root) {
  'use strict';
  const R_NM = 3440.065; // mean Earth radius in NM
  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;
  const norm360 = (d) => ((d % 360) + 360) % 360;
  const norm180 = (d) => { d = norm360(d); return d > 180 ? d - 360 : d; };

  // ---------- geodesy ----------
  function distanceNm(a, b) {
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  // Initial great-circle true course a -> b, degrees 0..360
  function trueCourse(a, b) {
    const la1 = rad(a.lat), la2 = rad(b.lat), dl = rad(b.lon - a.lon);
    const y = Math.sin(dl) * Math.cos(la2);
    const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dl);
    return norm360(deg(Math.atan2(y, x)));
  }
  function midpoint(a, b) {
    const la1 = rad(a.lat), lo1 = rad(a.lon), la2 = rad(b.lat), dl = rad(b.lon - a.lon);
    const bx = Math.cos(la2) * Math.cos(dl), by = Math.cos(la2) * Math.sin(dl);
    const la = Math.atan2(Math.sin(la1) + Math.sin(la2), Math.sqrt((Math.cos(la1) + bx) ** 2 + by ** 2));
    const lo = lo1 + Math.atan2(by, Math.cos(la1) + bx);
    return { lat: deg(la), lon: deg(lo) };
  }

  // Local flat projection (NM) around a reference latitude — adequate for leg-scale geometry.
  function proj(p, lat0) { return { x: p.lon * 60 * Math.cos(rad(lat0)), y: p.lat * 60 }; }

  function pointSegDistNm(p, a, b) {
    const lat0 = (a.lat + b.lat + p.lat) / 3;
    const P = proj(p, lat0), A = proj(a, lat0), B = proj(b, lat0);
    const dx = B.x - A.x, dy = B.y - A.y, L2 = dx * dx + dy * dy;
    let t = L2 ? ((P.x - A.x) * dx + (P.y - A.y) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    return { dist: Math.hypot(P.x - (A.x + t * dx), P.y - (A.y + t * dy)), t };
  }

  function pointInPolygon(p, poly) { // poly: [[lat,lon],...]
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const yi = poly[i][0], xi = poly[i][1], yj = poly[j][0], xj = poly[j][1];
      if ((yi > p.lat) !== (yj > p.lat) && p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function segIntersect(p1, p2, p3, p4) {
    const d = (a, b, c) => (c.lon - a.lon) * (b.lat - a.lat) - (b.lon - a.lon) * (c.lat - a.lat);
    const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  }
  function segmentEntersPolygon(a, b, poly) {
    if (pointInPolygon(a, poly) || pointInPolygon(b, poly)) return true;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      if (segIntersect(a, b, { lat: poly[j][0], lon: poly[j][1] }, { lat: poly[i][0], lon: poly[i][1] })) return true;
    }
    return false;
  }

  // "1000 FT AGL" -> 1000 (surface taken as MSL: conservative), "FL 155" -> 15500, "UNL" -> Infinity
  function parseLevelFt(s) {
    if (!s) return NaN;
    s = String(s).toUpperCase().trim();
    if (s === 'UNL') return Infinity;
    if (s === 'SFC' || s === 'GND') return 0;
    let m = s.match(/^FL\s*(\d+)/); if (m) return +m[1] * 100;
    m = s.match(/^(\d+)\s*FT/); if (m) return +m[1];
    return NaN;
  }

  // ---------- Windy URL ----------
  // https://www.windy.com/route-planner/vfr/37.98,23.36;38.06,23.55?2026-11-15-09
  // also /distance/vfr/..., raw "lat,lon;lat,lon", and the query-only map-position suffixes.
  function parseWindyUrl(text) {
    if (!text) return null;
    text = String(text).trim();
    let path = text, query = '';
    const q = text.indexOf('?');
    if (q >= 0) { path = text.slice(0, q); query = text.slice(q + 1); }
    let seg = null;
    const m = path.match(/(?:route-planner|distance)\/(?:[a-z]+\/)?([-0-9.,;]+)/i);
    if (m) seg = m[1];
    else if (/^[-0-9.,;\s]+$/.test(path) && path.includes(';')) seg = path.replace(/\s+/g, '');
    if (!seg) return null;
    const pts = seg.split(';').filter(Boolean).map((s) => {
      const [lat, lon] = s.split(',').map(Number);
      return { lat, lon };
    }).filter((p) => isFinite(p.lat) && isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180);
    if (pts.length < 2) return null;
    let date = null, hour = null;
    const dm = query.match(/(\d{4})-(\d{2})-(\d{2})-(\d{2})/);
    if (dm) { date = `${dm[1]}-${dm[2]}-${dm[3]}`; hour = +dm[4]; }
    return { points: pts, date, hour };
  }
  function windyUrl(points, date, hourUtc) {
    const s = points.map((p) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`).join(';');
    let u = `https://www.windy.com/route-planner/vfr/${s}`;
    if (date) u += `?${date}-${String(hourUtc ?? 12).padStart(2, '0')}`;
    return u;
  }

  // ---------- wind triangle ----------
  // tc, wd (direction wind blows FROM, true), ws (kt), tas (kt)
  function windTriangle(tc, tas, wd, ws) {
    if (!(tas > 0)) return null;
    if (!isFinite(wd) || !isFinite(ws) || ws === 0) return { wca: 0, gs: tas };
    const a = rad(wd - tc);
    const x = (ws * Math.sin(a)) / tas;
    if (Math.abs(x) > 1) return null; // wind stronger than TAS across track
    const wca = deg(Math.asin(x));
    const gs = tas * Math.cos(rad(wca)) - ws * Math.cos(a);
    return { wca, gs };
  }

  // ---------- compass deviation ----------
  // card: [[for, steer], ...] with for = magnetic heading wanted, steer = compass heading to fly.
  function deviation(card, mh) {
    if (!card || !card.length) return null;
    const pts = card.map(([f, s]) => [norm360(f), norm180(s - f)]).sort((a, b) => a[0] - b[0]);
    const h = norm360(mh);
    for (let i = 0; i < pts.length; i++) {
      const [f0, d0] = pts[i];
      const [f1r, d1] = pts[(i + 1) % pts.length];
      const f1 = i + 1 < pts.length ? f1r : f1r + 360;
      const hh = h < f0 ? h + 360 : h;
      if (hh >= f0 && hh <= f1) return d0 + ((d1 - d0) * (hh - f0)) / (f1 - f0);
    }
    return pts[0][1];
  }

  // ---------- sunset (NOAA) ----------
  // Returns minutes after 00:00 UTC of the given date (YYYY-MM-DD), or null (polar).
  function sunsetUtcMinutes(dateStr, lat, lon) {
    const [Y, M, D] = dateStr.split('-').map(Number);
    const jd = Date.UTC(Y, M - 1, D) / 86400000 + 2440587.5; // 00:00 UTC
    function calc(t) { // t = Julian centuries
      const L0 = norm360(280.46646 + t * (36000.76983 + t * 0.0003032));
      const Mn = 357.52911 + t * (35999.05029 - 0.0001537 * t);
      const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
      const C = Math.sin(rad(Mn)) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
        Math.sin(rad(2 * Mn)) * (0.019993 - 0.000101 * t) + Math.sin(rad(3 * Mn)) * 0.000289;
      const trueLong = L0 + C;
      const omega = 125.04 - 1934.136 * t;
      const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(rad(omega));
      const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
      const eps = eps0 + 0.00256 * Math.cos(rad(omega));
      const decl = deg(Math.asin(Math.sin(rad(eps)) * Math.sin(rad(lambda))));
      const y = Math.tan(rad(eps / 2)) ** 2;
      const eqt = 4 * deg(y * Math.sin(2 * rad(L0)) - 2 * e * Math.sin(rad(Mn)) +
        4 * e * y * Math.sin(rad(Mn)) * Math.cos(2 * rad(L0)) - 0.5 * y * y * Math.sin(4 * rad(L0)) -
        1.25 * e * e * Math.sin(2 * rad(Mn)));
      return { decl, eqt };
    }
    let minutes = 720 - 4 * lon; // first guess: solar noon
    for (let k = 0; k < 3; k++) {
      const t = (jd + minutes / 1440 - 2451545) / 36525;
      const { decl, eqt } = calc(t);
      const cosH = (Math.cos(rad(90.833)) / (Math.cos(rad(lat)) * Math.cos(rad(decl)))) - Math.tan(rad(lat)) * Math.tan(rad(decl));
      if (cosH < -1 || cosH > 1) return null;
      const H = deg(Math.acos(cosH));
      minutes = 720 - 4 * (lon - H) - eqt;
    }
    return minutes;
  }

  // ---------- formatting ----------
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const fmtHdg = (d) => (isFinite(d) ? pad(norm360(Math.round(d)) || 360, 3) : '');
  // U+2212 minus: as wide as '+', so signed numbers line up
  const fmtSigned = (d) => (isFinite(d) ? (Math.round(d) > 0 ? '+' : Math.round(d) < 0 ? '\u2212' : '') + Math.abs(Math.round(d)) : '');
  const fmtHmm = (min) => (isFinite(min) ? `${Math.floor(min / 60)}:${pad(Math.round(min % 60))}` : '');
  function fmtClock(min) {
    if (!isFinite(min)) return '';
    const m = ((Math.round(min) % 1440) + 1440) % 1440;
    return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  }
  function parseClock(s) { // "0930", "09:30" -> minutes
    const m = String(s || '').trim().toUpperCase().match(/^(\d{1,2}):?(\d{2})\s*Z?$/);
    if (!m || +m[1] > 23 || +m[2] > 59) return NaN;
    return +m[1] * 60 + +m[2];
  }

  // ---------- the nav log computation ----------
  // legs: [{tc, dist, tas, wd, ws}] (tc true, dist NM); opts: {variation (E positive), card, fuelPerHour}
  // Rounding follows the paper workflow: each written value is rounded, and later columns are
  // derived from the written (rounded) values so the sheet can be checked by hand.
  function computeLeg(leg, opts) {
    const out = {};
    out.tc = Math.round(leg.tc);
    out.dist = Math.round(leg.dist);
    const wt = windTriangle(out.tc, leg.tas, leg.wd, leg.ws);
    if (!wt) return out;
    out.wca = Math.round(wt.wca);
    out.th = norm360(out.tc + out.wca);
    out.var = -Math.round(opts.variation);             // "-E +W": 5°E -> -5
    out.mh = norm360(out.th + out.var);
    if (opts.card) {
      out.dev = Math.round(deviation(opts.card, out.mh));
      out.ch = norm360(out.mh + out.dev);
    } else if (isFinite(leg.devManual)) {
      out.dev = Math.round(leg.devManual);
      out.ch = norm360(out.mh + out.dev);
    }
    out.gs = Math.round(wt.gs);
    if (out.gs > 0) {
      out.minutesExact = (out.dist / out.gs) * 60;
      out.ete = Math.round(out.minutesExact);
      out.fuel = Math.ceil(out.minutesExact * (opts.fuelPerHour / 60) - 1e-9);
    }
    return out;
  }

  function summarize(rows, extraFuel) {
    const n = rows.length;
    let remD = 0, remT = 0;
    for (let i = n - 1; i >= 0; i--) {
      rows[i].distRem = remD;
      rows[i].ateRem = remT;
      remD += rows[i].dist || 0;
      remT += rows[i].ete || 0;
    }
    const totals = {
      dist: rows.reduce((s, r) => s + (r.dist || 0), 0),
      ete: rows.reduce((s, r) => s + (r.ete || 0), 0),
      tripFuel: rows.reduce((s, r) => s + (r.fuel || 0), 0),
    };
    totals.fuel = totals.tripFuel + extraFuel;
    return totals;
  }

  const api = {
    distanceNm, trueCourse, midpoint, pointSegDistNm, pointInPolygon, segmentEntersPolygon, parseLevelFt,
    parseWindyUrl, windyUrl, windTriangle, deviation, sunsetUtcMinutes, computeLeg, summarize,
    fmtHdg, fmtSigned, fmtHmm, fmtClock, parseClock, norm360, norm180,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Nav = api;
})(typeof window !== 'undefined' ? window : globalThis);
