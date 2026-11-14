// Winds/temperature aloft from Open-Meteo (free, no key; ECMWF / GFS / ICON models — the same
// model families Windy displays). Values are interpolated in height (geopotential) and time.
(function (root) {
  'use strict';
  const LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600];
  const SURFACE = ['pressure_msl', 'temperature_2m', 'dew_point_2m', 'wind_speed_10m', 'wind_direction_10m', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high'];
  const MODELS = {
    ecmwf_ifs025: 'ECMWF IFS 0.25° (Windy default)',
    gfs_seamless: 'GFS',
    icon_seamless: 'ICON',
    best_match: 'Open-Meteo best match',
  };

  function buildUrl(points, dateFrom, dateTo, model) {
    const vars = [];
    for (const l of LEVELS) vars.push(`wind_speed_${l}hPa`, `wind_direction_${l}hPa`, `temperature_${l}hPa`, `geopotential_height_${l}hPa`);
    vars.push(...SURFACE);
    const p = new URLSearchParams({
      latitude: points.map((x) => x.lat.toFixed(4)).join(','),
      longitude: points.map((x) => x.lon.toFixed(4)).join(','),
      hourly: vars.join(','),
      wind_speed_unit: 'kn',
      timezone: 'GMT',
      start_date: dateFrom,
      end_date: dateTo,
      models: model || 'ecmwf_ifs025',
    });
    return `https://api.open-meteo.com/v1/forecast?${p}`;
  }

  // One location's hourly response -> value at (altitude ft MSL, time ms UTC)
  function sampleAt(hourly, altFt, timeMs) {
    const times = hourly.time.map((t) => Date.parse(t.endsWith('Z') ? t : t + 'Z'));
    let i = times.findIndex((t) => t > timeMs) - 1;
    if (i < 0) i = timeMs < times[0] ? 0 : times.length - 2;
    i = Math.max(0, Math.min(times.length - 2, i));
    const f = Math.max(0, Math.min(1, (timeMs - times[i]) / (times[i + 1] - times[i])));
    const a = atHeight(hourly, i, altFt), b = atHeight(hourly, i + 1, altFt);
    if (!a || !b) return a || b;
    const mix = (x, y) => x + (y - x) * f;
    const u = mix(a.u, b.u), v = mix(a.v, b.v);
    return toDirSpd(u, v, mix(a.temp, b.temp));
  }

  function atHeight(h, idx, altFt) {
    const altM = altFt * 0.3048;
    const lv = [];
    for (const l of LEVELS) {
      const z = h[`geopotential_height_${l}hPa`]?.[idx], ws = h[`wind_speed_${l}hPa`]?.[idx],
        wd = h[`wind_direction_${l}hPa`]?.[idx], t = h[`temperature_${l}hPa`]?.[idx];
      if ([z, ws, wd, t].every((x) => x !== null && x !== undefined && isFinite(x))) {
        const r = (wd * Math.PI) / 180; // direction wind comes FROM
        lv.push({ z, u: -ws * Math.sin(r), v: -ws * Math.cos(r), temp: t });
      }
    }
    if (!lv.length) return null;
    lv.sort((a, b) => a.z - b.z);
    if (altM <= lv[0].z) return lv[0];
    if (altM >= lv[lv.length - 1].z) return lv[lv.length - 1];
    for (let k = 0; k < lv.length - 1; k++) {
      const a = lv[k], b = lv[k + 1];
      if (altM >= a.z && altM <= b.z) {
        const f = (altM - a.z) / (b.z - a.z);
        return { u: a.u + (b.u - a.u) * f, v: a.v + (b.v - a.v) * f, temp: a.temp + (b.temp - a.temp) * f };
      }
    }
    return null;
  }

  function toDirSpd(u, v, temp) {
    const spd = Math.hypot(u, v);
    const dir = ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360;
    return { dir, spd, temp };
  }

  // Surface conditions at a time: temperature, dewpoint, wind (u/v interpolated), cloud cover by layer.
  function sampleSurface(hourly, timeMs) {
    const times = hourly.time.map((t) => Date.parse(t.endsWith('Z') ? t : t + 'Z'));
    let i = Math.max(0, Math.min(times.length - 2, times.findIndex((t) => t > timeMs) - 1));
    if (timeMs >= times[times.length - 1]) i = times.length - 2;
    const f = Math.max(0, Math.min(1, (timeMs - times[i]) / (times[i + 1] - times[i])));
    const at = (k) => {
      const a = hourly[k]?.[i], b = hourly[k]?.[i + 1];
      if (a == null && b == null) return NaN;
      if (a == null) return b; if (b == null) return a;
      return a + (b - a) * f;
    };
    const uv = (j) => { const ws = hourly.wind_speed_10m?.[j], wd = hourly.wind_direction_10m?.[j]; if (ws == null || wd == null) return null; const r = (wd * Math.PI) / 180; return { u: -ws * Math.sin(r), v: -ws * Math.cos(r) }; };
    const A = uv(i), B = uv(i + 1);
    let wind = null;
    if (A || B) { const a = A || B, b = B || A; const w = toDirSpd(a.u + (b.u - a.u) * f, a.v + (b.v - a.v) * f, 0); wind = { dir: w.dir, spd: w.spd }; }
    const out = { qnh: at('pressure_msl'), temp: at('temperature_2m'), dew: at('dew_point_2m'), wind, low: at('cloud_cover_low'), mid: at('cloud_cover_mid'), high: at('cloud_cover_high') };
    return isFinite(out.temp) || wind ? out : null;
  }

  // METAR-style strings
  const two = (t) => (Math.round(t) < 0 ? 'M' : '') + String(Math.abs(Math.round(t))).padStart(2, '0');
  function fmtQnh(s) { return s && isFinite(s.qnh) ? String(Math.round(s.qnh)) : ''; }
  function fmtTempDew(s) { return s && isFinite(s.temp) ? `${two(s.temp)}/${isFinite(s.dew) ? two(s.dew) : '//'}` : ''; }
  // METAR wind group: direction to 10 degrees + speed in knots, e.g. 23004KT; calm 00000KT
  function fmtWind(s) {
    if (!s || !s.wind) return '';
    const spd = Math.round(s.wind.spd);
    if (spd < 1) return '00000KT';
    const dir = Math.round(s.wind.dir / 10) * 10 % 360 || 360;
    return `${String(dir).padStart(3, '0')}${String(spd).padStart(2, '0')}KT`;
  }
  // Most relevant cloud group: lowest layer of >= 1 okta below 5000 ft (base estimated from the
  // temperature/dewpoint spread, ~400 ft per degree), else NSC when there is any cloud, else SKC.
  function fmtSky(s) {
    if (!s || !isFinite(s.low)) return '';
    const okta = (pct) => Math.round((pct || 0) / 12.5);
    const code = (o) => (o <= 2 ? 'FEW' : o <= 4 ? 'SCT' : o <= 7 ? 'BKN' : 'OVC');
    if (okta(s.low) >= 1 && isFinite(s.temp) && isFinite(s.dew)) {
      const base = Math.max(100, Math.min(6500, Math.round(((s.temp - s.dew) * 400) / 100) * 100));
      if (base < 5000) return `${code(okta(s.low))}${String(base / 100).padStart(3, '0')}`;
    }
    return (s.low || 0) + (s.mid || 0) + (s.high || 0) > 0 ? 'NSC' : 'SKC';
  }

  const cache = new Map();
  async function fetchPoints(points, dateFrom, dateTo, model) {
    const url = buildUrl(points, dateFrom, dateTo, model);
    if (cache.has(url)) return cache.get(url);
    const res = await fetch(url);
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error((body && body.reason) || `Open-Meteo HTTP ${res.status}`);
    const arr = Array.isArray(body) ? body : [body];
    cache.set(url, arr);
    return arr;
  }

  const clearCache = () => cache.clear();
  const api = { LEVELS, MODELS, SURFACE, buildUrl, sampleAt, sampleSurface, fmtQnh, fmtTempDew, fmtWind, fmtSky, fetchPoints, clearCache };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Weather = api;
})(typeof window !== 'undefined' ? window : globalThis);
