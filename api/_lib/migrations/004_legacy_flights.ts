// Migration 004: converts v2 flights (legacy_flights, renamed by 001) into v3 flights.
//
// v2 kept one JSON document per flight (js/app.js DEFAULTS):
//   { title, date, blockStart ('0930' | '09:30'), aircraft ('SX-ASV' | 'SX-ASG' | 'OTHER'), aircraftOther,
//     card, taxiMin, model, variation, fieldRadius, fuelFlow, fuelExtra, windyUrl,
//     waypoints: [{lat, lon, name}], ov: {'L0.alt': '3000', 'L0.tas': …, 'L0.wd', 'L0.ws', 'L0.temp', …},
//     termManual, termHidden }
// Route points named after an aerodrome (≤ 1 NM) or a VFR reporting point (≤ 0.5 NM, same name)
// become references to the reference data; the rest become named custom points. The legacy table is
// left in place (read-only) as a backup.
import type { Queryable } from '../db.js';
import type { FlightDoc, FlightOptions, LegOverride, PersonDetails, RoutePoint, WindModel } from '../../../src/shared/types.js';
import { DEFAULT_FLIGHT_OPTIONS, DEFAULT_SETTINGS, EMPTY_SUMMARY, autoTitle } from '../../../src/shared/constants.js';
import { distanceNm, parseClock, fmtClock } from '../../../src/calc/nav.js';

const num = (v: unknown): number => {
  if (v === undefined || v === null || String(v).trim() === '') return NaN;
  const n = parseFloat(String(v).replace(',', '.').replace(/[−–]/g, '-'));
  return isFinite(n) ? n : NaN;
};

export async function convertLegacyFlights(q: Queryable): Promise<void> {
  const exists = await q.query(`SELECT to_regclass('public.legacy_flights') IS NOT NULL AS ok`);
  if (!exists[0]?.ok) return;
  const rows = await q.query('SELECT * FROM legacy_flights ORDER BY created');
  if (!rows.length) return;
  const [cur] = await q.query(`SELECT id FROM ref_airac WHERE current`);
  const airac = cur?.id ?? '';
  const ads = await q.query<{ id: string; icao: string | null; name: string; lat: number; lon: number }>(`SELECT id, icao, name, lat, lon FROM ref_aerodromes WHERE airac = $1`, [airac]);
  const vfr = await q.query<{ id: string; name: string; lat: number; lon: number }>(`SELECT id, name, lat, lon FROM ref_waypoints WHERE airac = $1`, [airac]);

  for (const r of rows) {
    const d = (r.data || {}) as Record<string, any>;
    const [pilot] = await q.query('SELECT * FROM pilots WHERE id = $1', [r.owner]);
    if (!pilot) continue;
    const settings = { ...DEFAULT_SETTINGS, ...(pilot.settings || {}) };

    const route: RoutePoint[] = (Array.isArray(d.waypoints) ? d.waypoints : [])
      .filter((w: any) => isFinite(w?.lat) && isFinite(w?.lon))
      .map((w: any, i: number): RoutePoint => {
        const p = { lat: +w.lat, lon: +w.lon };
        const name = String(w.name || '').trim();
        const ad = ads.find((a) => distanceNm(p, a) <= 1 && (!name || name === a.icao || a.name.includes(name) || name.includes(a.name) || distanceNm(p, a) <= 0.3));
        if (ad) return { uid: `m${i}`, kind: 'aerodrome', refId: ad.id, name: name || ad.icao || ad.name, ...p };
        const v = vfr.find((x) => x.name === name && distanceNm(p, x) <= 0.5);
        if (v) return { uid: `m${i}`, kind: 'vfr', refId: v.id, name, ...p };
        return { uid: `m${i}`, kind: 'custom', refId: null, name: name || `WP${i}`, ...p };
      });

    const legOverrides: Record<string, LegOverride> = {};
    const ov = (d.ov || {}) as Record<string, string>;
    for (let i = 0; i + 1 < route.length; i++) {
      const o: LegOverride = {};
      const get = (k: string) => num(ov[`L${i}.${k}`]);
      if (isFinite(get('alt'))) o.altFt = get('alt');
      if (isFinite(get('tas'))) o.tasKt = get('tas');
      if (isFinite(get('wd'))) o.windDirDeg = get('wd');
      if (isFinite(get('ws'))) o.windKt = get('ws');
      if (isFinite(get('temp'))) o.tempC = get('temp');
      if (Object.keys(o).length) legOverrides[`${route[i].uid}>${route[i + 1].uid}`] = o;
    }

    const reg = d.aircraft === 'OTHER' ? String(d.aircraftOther || '').toUpperCase() : String(d.aircraft || '');
    const [ac] = reg ? await q.query('SELECT id FROM aircraft WHERE pilot_id = $1 AND registration = $2', [r.owner, reg]) : [];
    const block = parseClock(d.blockStart);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(d.date || '') ? d.date : new Date(Number(r.created)).toISOString().slice(0, 10);
    const models: WindModel[] = ['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless', 'best_match'];
    const options: FlightOptions = {
      ...DEFAULT_FLIGHT_OPTIONS,
      windModel: models.includes(d.model) ? d.model : settings.windModel,
      compassCard: typeof d.card === 'string' && d.card ? d.card : null,
    };
    const s = (r.summary || {}) as Record<string, any>;
    const summary = {
      ...EMPTY_SUMMARY,
      title: (d.title || '').trim() || s.title || autoTitle(route),
      date,
      blockOff: isFinite(block) ? fmtClock(block) : '',
      aircraft: reg,
      route: route.map((p) => [+p.lat.toFixed(3), +p.lon.toFixed(3)] as [number, number]),
      from: route[0]?.name ?? '',
      to: route.length > 1 ? route[route.length - 1].name : '',
      distNm: s.dist ?? null,
      eteMin: s.ete ?? null,
      fuelL: s.fuel ?? null,
    };
    const doc: FlightDoc = {
      title: String(d.title || '').trim(),
      date,
      blockOff: isFinite(block) ? fmtClock(block) : '',
      aircraftId: ac?.id ?? null,
      taxiOutMin: isFinite(num(d.taxiMin)) ? num(d.taxiMin) : settings.taxiOutMin,
      taxiInMin: settings.taxiInMin,
      fobL: null,
      route,
      legOverrides,
      atc: null,
      crew: [],
      baggageKg: {},
      options,
      summary,
    };
    await q.query(
      `INSERT INTO flights (id, pilot_id, title, date, block_off, aircraft_id, taxi_out_min, taxi_in_min, fob_l, route, leg_overrides,
         atc, baggage_kg, options, summary, version, created, updated, opened, deleted)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, $9::jsonb, $10::jsonb, NULL, '{}'::jsonb, $11::jsonb, $12::jsonb, $13, $14, $15, $16, $17)
       ON CONFLICT (id) DO NOTHING`,
      [r.id, r.owner, doc.title, doc.date, doc.blockOff, doc.aircraftId, doc.taxiOutMin === null ? null : Math.round(doc.taxiOutMin), doc.taxiInMin === null ? null : Math.round(doc.taxiInMin),
        JSON.stringify(route), JSON.stringify(legOverrides), JSON.stringify(options), JSON.stringify(summary),
        Number(r.version) || 1, Number(r.created), Number(r.updated), Number(r.opened) || 0, !!r.deleted],
    );
    const pic: PersonDetails = {
      fullName: pilot.full_name || pilot.name || '', phone: pilot.phone || '', dateOfBirth: pilot.date_of_birth ?? null,
      weightKg: pilot.weight_kg ?? null, idNumber: pilot.id_number || '', idType: pilot.id_type || '',
      nationality: pilot.nationality || '', relation: pilot.relation || '',
    };
    await q.query(
      `INSERT INTO flight_crew (flight_id, pilot_id, position, role, passenger_id, seat, snapshot)
       VALUES ($1, $2, 0, 'PIC', NULL, 'front-left', $3::jsonb) ON CONFLICT DO NOTHING`,
      [r.id, r.owner, JSON.stringify(pic)],
    );
  }
}
