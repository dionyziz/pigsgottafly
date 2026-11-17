// Independent reference implementation of the nav-log rules, written from the specification
// (not imported from the app), used to check every cell the app produces.
const R = 3440.065;
const rad = (d) => (d * Math.PI) / 180,
  deg = (r) => (r * 180) / Math.PI;
const n360 = (d) => ((d % 360) + 360) % 360;

// Compass swing reports, transcribed again here from the PDFs (For -> Steer).
export const CARDS = {
  'SX-ASV': {
    'Magnetic compass': {
      expires: '2028-02-05',
      swung: '2026-02-05',
      steer: [2, 31, 62, 92, 121, 148, 181, 211, 239, 268, 298, 329],
    },
  },
  'SX-ASG': {
    'Magnetic compass': {
      expires: '2027-02-06',
      swung: '2025-02-06',
      steer: [1, 32, 62, 93, 122, 152, 181, 212, 241, 272, 303, 331],
    },
    'GMU (G1000 heading)': {
      expires: '2027-02-06',
      swung: '2025-02-06',
      steer: [0, 30, 59, 89, 120, 150, 179, 210, 242, 271, 300, 330],
    },
  },
};

export function haversineNm(a, b) {
  const x =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
// initial course via vector method (different formulation from the app's)
export function course(a, b) {
  const v = (p) => [
    Math.cos(rad(p.lat)) * Math.cos(rad(p.lon)),
    Math.cos(rad(p.lat)) * Math.sin(rad(p.lon)),
    Math.sin(rad(p.lat)),
  ];
  const A = v(a),
    B = v(b);
  const north = [
    -Math.sin(rad(a.lat)) * Math.cos(rad(a.lon)),
    -Math.sin(rad(a.lat)) * Math.sin(rad(a.lon)),
    Math.cos(rad(a.lat)),
  ];
  const east = [-Math.sin(rad(a.lon)), Math.cos(rad(a.lon)), 0];
  const d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
  const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  return n360(deg(Math.atan2(dot(d, east), dot(d, north))));
}
export function midpoint(a, b) {
  const v = (p) => [
    Math.cos(rad(p.lat)) * Math.cos(rad(p.lon)),
    Math.cos(rad(p.lat)) * Math.sin(rad(p.lon)),
    Math.sin(rad(p.lat)),
  ];
  const A = v(a),
    B = v(b),
    M = [A[0] + B[0], A[1] + B[1], A[2] + B[2]];
  return { lat: deg(Math.atan2(M[2], Math.hypot(M[0], M[1]))), lon: deg(Math.atan2(M[1], M[0])) };
}
export function dev(card, mh) {
  const h = n360(mh);
  const i = Math.floor(h / 30),
    f = (h - 30 * i) / 30;
  const d = (k) => {
    const s = card.steer[k % 12],
      fr = (k % 12) * 30;
    let x = s - fr;
    if (x > 180) x -= 360;
    if (x < -180) x += 360;
    return x;
  };
  return d(i) * (1 - f) + d(i + 1) * f;
}
export const hdg = (d) => {
  const r = n360(Math.round(d));
  return String(r === 0 ? 360 : r).padStart(3, '0');
};
export const signed = (d) => (d > 0 ? '+' + d : d < 0 ? '\u2212' + -d : '0');
export const hmm = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
/** Navlog leg times (ETE/ATE columns): '00:10', '01:44'. */
export const legTime = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// legs: [{a,b,alt,tas,wd,ws}] (wd/ws as displayed integers) ; returns expected written cells per leg + totals
export function navlog(legs, { variation = 5, card = null, flow = 30, extra = 4 } = {}) {
  const rows = legs.map((L) => {
    // TC at the leg midpoint (as read off a VFR chart): the course from the midpoint to the end.
    const tc = Math.round(course(midpoint(L.a, L.b), L.b));
    const dist = Math.round(haversineNm(L.a, L.b));
    const awa = rad(L.wd - tc);
    const wcaExact = deg(Math.asin((L.ws * Math.sin(awa)) / L.tas));
    const wca = Math.round(wcaExact);
    const th = n360(tc + wca);
    const mh = n360(th - Math.round(variation));
    const dv = card ? Math.round(dev(card, mh)) : null;
    const ch = card ? n360(mh + dv) : null;
    const gs = Math.round(L.tas * Math.cos(rad(wcaExact)) - L.ws * Math.cos(awa));
    const min = (dist / gs) * 60;
    const ete = Math.round(min);
    const fuel = Math.ceil(min * (flow / 60) - 1e-9);
    return { tc, dist, wca, th, mh, dev: dv, ch, gs, min, ete, fuel };
  });
  rows.forEach((r, i) => {
    r.rem = rows.slice(i + 1).reduce((s, x) => s + x.dist, 0);
    r.ate = rows.slice(i + 1).reduce((s, x) => s + x.ete, 0);
  });
  const trip = rows.reduce((s, r) => s + r.fuel, 0);
  return {
    rows,
    totals: {
      dist: rows.reduce((s, r) => s + r.dist, 0),
      ete: rows.reduce((s, r) => s + r.ete, 0),
      trip,
      fuel: trip + extra,
    },
    cells: rows.map((r) => ({
      tc: hdg(r.tc),
      wca: signed(r.wca),
      th: hdg(r.th),
      var: signed(-Math.round(variation)),
      mh: hdg(r.mh),
      dev: r.dev === null ? '' : r.dev === 0 ? '0' : signed(r.dev),
      ch: r.ch === null ? '' : hdg(r.ch),
      dist: String(r.dist),
      rem: String(r.rem),
      gs: String(r.gs),
      ete: legTime(r.ete),
      ate: legTime(r.ate),
      fuel: String(r.fuel),
    })),
  };
}

// Sunset via the "sunrise equation" (Wikipedia formulation), UTC minutes — independent of the app's NOAA code.
export function sunsetMinutes(dateIso, lat, lon) {
  const jd0 = Date.parse(dateIso + 'T12:00:00Z') / 86400000 + 2440587.5;
  const n = Math.ceil(jd0 - 2451545.0 + 0.0008);
  const Js = n - lon / 360;
  const M = n360(357.5291 + 0.98560028 * Js);
  const C = 1.9148 * Math.sin(rad(M)) + 0.02 * Math.sin(rad(2 * M)) + 0.0003 * Math.sin(rad(3 * M));
  const lam = n360(M + C + 180 + 102.9372);
  const Jt = 2451545.0 + Js + 0.0053 * Math.sin(rad(M)) - 0.0069 * Math.sin(rad(2 * lam));
  const sd = Math.sin(rad(lam)) * Math.sin(rad(23.4397));
  const cosw = (Math.sin(rad(-0.833)) - Math.sin(rad(lat)) * sd) / (Math.cos(rad(lat)) * Math.cos(Math.asin(sd)));
  const Jset = Jt + deg(Math.acos(cosw)) / 360;
  return ((Jset + 0.5) % 1) * 1440;
}

// ---------------------------------------------------------------- Open-Meteo mock
// windFn({level, z, hour, lat, lon}) -> {dir, spd, temp}; `hour`: hours since `epochMs` (default: 00:00Z of
// the request's start_date, which the app may set a day early)
export const LEVELS = { 1000: 110, 925: 760, 850: 1460, 700: 3010, 600: 4200 };
export const SURFACE_DEFAULT = { qnh: 1013.4, temp: 15, dew: 8, dir: 200, spd: 7, low: 0, mid: 0, high: 0 };
export function openMeteoResponder(
  windFn,
  { nullAll = false, status = 200, reason = '', surfaceFn = null, epochMs = null } = {},
) {
  return (url) => {
    if (status !== 200) return { status, body: { error: true, reason } };
    const q = url.searchParams;
    const lats = q.get('latitude').split(',').map(Number),
      lons = q.get('longitude').split(',').map(Number);
    const start = Date.parse(q.get('start_date') + 'T00:00:00Z'),
      d1 = Date.parse(q.get('end_date') + 'T00:00:00Z');
    const d0 = epochMs ?? start;
    const vars = q.get('hourly').split(',');
    const out = lats.map((lat, li) => {
      const time = [];
      for (let t = start; t < d1 + 86400000; t += 3600000) time.push(new Date(t).toISOString().slice(0, 16));
      const hourly = { time };
      for (const v of vars) {
        const m = v.match(/^(wind_speed|wind_direction|temperature|geopotential_height)_(\d+)hPa$/);
        if (!m) {
          // surface field
          hourly[v] = time.map((t) => {
            if (nullAll) return null;
            const w = {
              ...SURFACE_DEFAULT,
              ...(surfaceFn || (() => ({})))({ hour: (Date.parse(t + 'Z') - d0) / 3600000, lat, lon: lons[li] }),
            };
            return {
              pressure_msl: w.qnh,
              temperature_2m: w.temp,
              dew_point_2m: w.dew,
              wind_speed_10m: w.spd,
              wind_direction_10m: w.dir,
              cloud_cover_low: w.low,
              cloud_cover_mid: w.mid,
              cloud_cover_high: w.high,
            }[v];
          });
          continue;
        }
        const lvl = +m[2];
        hourly[v] = time.map((t) => {
          if (nullAll || !(lvl in LEVELS)) return null; // like ECMWF: only some levels
          const w = windFn({
            level: lvl,
            z: LEVELS[lvl],
            hour: (Date.parse(t + 'Z') - d0) / 3600000,
            lat,
            lon: lons[li],
          });
          return { wind_speed: w.spd, wind_direction: w.dir, temperature: w.temp, geopotential_height: LEVELS[lvl] }[
            m[1]
          ];
        });
      }
      return { latitude: lat, longitude: lons[li], hourly };
    });
    return { status: 200, body: out.length === 1 ? out[0] : out };
  };
}
// u/v interpolation in height, as a meteorologist would do it — used to predict the displayed wind
export function windAt(windFn, altFt, hour, lat = 0, lon = 0) {
  const z = altFt * 0.3048;
  const lv = Object.entries(LEVELS)
    .map(([l, h]) => ({ h, ...windFn({ level: +l, z: h, hour, lat, lon }) }))
    .sort((a, b) => a.h - b.h);
  const uv = (w) => ({ u: -w.spd * Math.sin(rad(w.dir)), v: -w.spd * Math.cos(rad(w.dir)), t: w.temp });
  let a = lv[0],
    b = lv[0],
    f = 0;
  if (z >= lv[lv.length - 1].h) {
    a = b = lv[lv.length - 1];
  } else if (z > lv[0].h) {
    for (let k = 0; k < lv.length - 1; k++)
      if (z >= lv[k].h && z <= lv[k + 1].h) {
        a = lv[k];
        b = lv[k + 1];
        f = (z - a.h) / (b.h - a.h);
      }
  }
  const A = uv(a),
    B = uv(b);
  const u = A.u + (B.u - A.u) * f,
    v = A.v + (B.v - A.v) * f;
  return { dir: n360(deg(Math.atan2(-u, -v))), spd: Math.hypot(u, v), temp: A.t + (B.t - A.t) * f };
}
