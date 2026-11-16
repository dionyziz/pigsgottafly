// Generated forecast data in Open-Meteo's response format, for local runs (npm run dev / npm start)
// so that development never spends the Open-Meteo request limit: a smooth, plausible field over
// Greece (winds veering and strengthening with height, ISA-like temperatures, some low cloud).
// OPEN_METEO_LIVE=1 makes a local run use the real Open-Meteo instead.
const LEVEL_Z: Record<number, number> = {
  1000: 110,
  975: 320,
  950: 540,
  925: 760,
  900: 990,
  850: 1460,
  800: 1950,
  700: 3010,
  600: 4200,
};
const RUN_EVERY_MS = 6 * 3600e3;

function value(v: string, lat: number, lon: number, tMs: number): number | null {
  const hour = tMs / 3600e3;
  const diurnal = Math.sin((((hour % 24) - 9) / 24) * 2 * Math.PI);
  const wave = Math.sin(lat * 1.7 + hour / 17) + Math.cos(lon * 1.3 - hour / 23);
  const lvl = /_(\d+)hPa$/.exec(v);
  if (lvl) {
    const p = +lvl[1],
      z = LEVEL_Z[p];
    if (v.startsWith('geopotential_height')) return z + Math.round(wave * 15);
    if (v.startsWith('wind_speed')) return Math.round((6 + z / 250 + wave * 3) * 10) / 10;
    if (v.startsWith('wind_direction')) return Math.round((300 + z / 60 + wave * 20 + 360) % 360);
    if (v.startsWith('temperature')) return Math.round((16 + diurnal * 3 - z * 0.0065 + wave) * 10) / 10;
    if (v.startsWith('cloud_cover'))
      return z < 1500 ? Math.max(0, Math.round(30 + wave * 25)) : Math.max(0, Math.round(10 + wave * 10));
  }
  switch (v) {
    case 'pressure_msl':
      return Math.round((1015 + wave * 3) * 10) / 10;
    case 'surface_pressure':
      return Math.round((1003 + wave * 3) * 10) / 10;
    case 'temperature_2m':
      return Math.round((16 + diurnal * 5 + wave) * 10) / 10;
    case 'dew_point_2m':
      return Math.round((8 + wave) * 10) / 10;
    case 'wind_speed_10m':
      return Math.round((6 + wave * 2) * 10) / 10;
    case 'wind_direction_10m':
      return Math.round((330 + wave * 25 + 360) % 360);
    case 'cloud_cover_low':
      return Math.max(0, Math.round(20 + wave * 20));
    case 'cloud_cover_mid':
      return Math.max(0, Math.round(10 + wave * 10));
    case 'cloud_cover_high':
      return Math.max(0, Math.round(15 + wave * 15));
    case 'weather_code':
      return wave > 1.2 ? 3 : wave > 0 ? 2 : 1;
    case 'cape':
      return Math.max(0, Math.round(wave * 40));
    case 'visibility':
      return 24000;
    default:
      return null;
  }
}

/** A fetch() that answers Open-Meteo forecast and meta.json URLs with generated data. */
export function syntheticOpenMeteo(now: () => number = Date.now): typeof fetch {
  return async (input: RequestInfo | URL) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (url.pathname.endsWith('/meta.json')) {
      const run = Math.floor((now() - 5 * 3600e3) / RUN_EVERY_MS) * RUN_EVERY_MS;
      return json({ last_run_initialisation_time: run / 1000, last_run_availability_time: (run + 5 * 3600e3) / 1000 });
    }
    const q = url.searchParams;
    const lats = (q.get('latitude') || '').split(',').map(Number),
      lons = (q.get('longitude') || '').split(',').map(Number);
    const vars = (q.get('hourly') || '').split(',').filter(Boolean);
    const d0 = Date.parse(q.get('start_date') + 'T00:00:00Z'),
      d1 = Date.parse(q.get('end_date') + 'T00:00:00Z');
    if (!isFinite(d0) || !isFinite(d1) || !lats.length) return json({ error: true, reason: 'bad request' }, 400);
    const out = lats.map((lat, i) => {
      const lon = lons[i];
      const time: string[] = [];
      for (let t = d0; t < d1 + 86400e3; t += 3600e3) time.push(new Date(t).toISOString().slice(0, 16));
      const hourly: Record<string, unknown[]> = { time };
      for (const v of vars) hourly[v] = time.map((t) => value(v, lat, lon, Date.parse(t + 'Z')));
      return { latitude: lat, longitude: lon, elevation: 50, hourly };
    });
    return json(out.length === 1 ? out[0] : out);
  };
}
