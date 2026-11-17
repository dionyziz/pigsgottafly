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
//
// ATC / terminal information: a v2 flight whose list the pilot never touched gets atc = null (the
// v3 list is generated, as v2 generated its rows). A flight with edits (termHidden, termManual or
// `T.<row>.field|elev|rwy|freq` overrides) gets the v3 generated list (at the v2 altitude overrides,
// otherwise the v3 default altitudes) with the edits applied: see legacyAtc().
//
// Not carried over, because v3 has no per-flight equivalent (the values stay in legacy_flights):
//   - `L<i>.ete`, `.gs`, `.wca`, `.dev`, `.fuel`, `.dist` typed over the computed navlog cells (v3
//     computes them; altitude, TAS, wind and temperature overrides are converted);
//   - fuelFlow / fuelExtra (v3 takes the burn rate and the start-up/taxi allowance from the
//     aircraft; v2's defaults, 30 L/h and 4 L, are the seeded values);
//   - variation (v3 uses the World Magnetic Model) and the Windy URL (dropped).
//
// Every converted value is kept within what PUT /flights accepts (api/_lib/flightDoc.ts and
// routes/flights.ts checkDoc), because the editor saves the whole document back: one value it
// refuses (e.g. a v2 altitude override typed as 999999) would make every save of the flight fail.
// Out-of-range numbers are dropped (the computed value applies), over-long texts are cut, and the
// result is checked with the same validators (fitLegacyDoc).
import type { Queryable } from '../db.js';
import type { AtcEntry, FlightDoc, FlightOptions, LegOverride, PersonDetails, RoutePoint, WindModel } from '../../../src/shared/types.js';
import type { RefAerodrome, RefAirspace, RefFis, RefVfrPoint, RefVfrRoute } from '../../../src/shared/ref.js';
import { DEFAULT_FLIGHT_OPTIONS, DEFAULT_SETTINGS, EMPTY_SUMMARY } from '../../../src/shared/constants.js';

import { distanceNm, parseClock, fmtClock } from '../../../src/calc/nav.js';
import { defaultAltitudes } from '../../../src/calc/altitudes.js';
import { atcInput, generateAtcList } from '../../../src/data/atc.js';
import { LEG_OVERRIDE_LIMITS, MAX_ROUTE_POINTS, checkAtc, checkLegOverrides, checkOptions, checkRoute, checkSummary } from '../flightDoc.js';

/** The automatic title of the time: the route's distinct consecutive names joined by arrows. */
function legacyTitle(route: { name: string }[]): string {
  const names = route.map((p) => p.name).filter((n, i, a) => n && n !== a[i - 1]);
  if (names.length > 1) return names.join(' → ');
  if (names.length === 1 && route.length > 1 && route[0].name === route[route.length - 1].name)
    return `${names[0]} → ${names[0]}`;
  return 'Untitled flight';
}


const FREQ = /\b1[1-3]\d\.\d{1,3}\b/g;
const TERM_CELL = /^T\.(.+)\.(field|elev|rwy|freq)$/;

/**
 * v2 terminal-information edits applied to the v3 generated list. Returns null when the v2 flight
 * has no such edits (the editor then generates the list itself).
 *
 * v2 row ids: 'ad-<aerodrome id>' (departure, en route) and 'ad-<id>-arr' (destination), 'dep' /
 * 'arr' (route end not at an aerodrome), 'as-<TMA name, non-word runs → ->', 'fis', and 'm…' for
 * rows added by hand. A v2 row is one aerodrome / airspace / FIS with all its units; the v3 list has
 * one entry per unit, so a v2 row maps to every v3 entry of that group:
 *   - hidden row → its entries are removed;
 *   - edited frequency text → the group's entries are replaced by ONE entry holding the v2 text
 *     (first frequency primary, the others backups, the full text in the remark when it has labels);
 *     it keeps the first entry's sourceKey, so "regenerate" can still restore the generated units;
 *   - edited name → the group heading (and the callsign of a replaced entry);
 *   - edited elevation / runways (not in the v3 ATC list) → added to the first entry's remark;
 *   - a row added by hand → a custom entry (sourceKey null) at the end; empty ones are dropped;
 *   - edits to a row v3 does not generate (e.g. 'dep') → a custom entry with the edited cells.
 */
export function legacyAtc(d: Record<string, any>, generated: AtcEntry[], aerodromes: Pick<RefAerodrome, 'id' | 'icao'>[]): AtcEntry[] | null {
  const ov = (d.ov || {}) as Record<string, unknown>;
  const hidden: string[] = Array.isArray(d.termHidden) ? d.termHidden.map(String) : [];
  const manual: string[] = Array.isArray(d.termManual) ? d.termManual.map(String) : [];
  const cells = new Map<string, Partial<Record<'field' | 'elev' | 'rwy' | 'freq', string>>>();
  for (const [k, v] of Object.entries(ov)) {
    const m = TERM_CELL.exec(k);
    if (!m || v === undefined || v === null || String(v).trim() === '') continue;
    if (!cells.has(m[1])) cells.set(m[1], {});
    cells.get(m[1])![m[2] as 'field'] = String(v).trim();
  }
  if (!hidden.length && !manual.length && !cells.size) return null;

  const groupOf = (id: string): ((e: AtcEntry) => boolean) | null => {
    const ad = /^ad-(.+?)(-arr)?$/.exec(id);
    if (ad) {
      const a = aerodromes.find((x) => x.id === ad[1] || x.icao === ad[1]);
      const key = `ad:${a ? a.icao ?? a.id : ad[1]}`;
      return (e) => e.sourceKey === key || !!e.sourceKey?.startsWith(key + ':');
    }
    if (id.startsWith('as-')) {
      const name = id.slice(3);
      return (e) => e.role === 'airspace' && e.group.replace(/\W+/g, '-') === name;
    }
    if (id === 'fis') return (e) => e.role === 'fis';
    return null;
  };
  const freqEntry = (base: Omit<AtcEntry, 'primary' | 'backups' | 'remark'>, c: Partial<Record<'field' | 'elev' | 'rwy' | 'freq', string>>, remark: string): AtcEntry => {
    const text = c.freq ?? '';
    const freqs = text.match(FREQ) ?? [];
    const extra = [
      /[A-Za-z]/.test(text) || (!freqs.length && text) ? text : '',
      c.elev ? `ELEV ${c.elev}` : '',
      c.rwy ? `RWY ${c.rwy}` : '',
    ];
    return { ...base, primary: freqs[0] ?? '', backups: freqs.slice(1), remark: [remark, ...extra].filter(Boolean).join('; ') };
  };

  let out = generated.map((e) => ({ ...e, backups: [...e.backups] }));
  for (const id of hidden) {
    const f = groupOf(id);
    if (f) out = out.filter((e) => !f(e));
  }
  const custom: AtcEntry[] = [];
  for (const [id, c] of cells) {
    if (manual.includes(id) || hidden.includes(id)) continue;
    const f = groupOf(id);
    const idx = f ? out.findIndex(f) : -1;
    if (idx < 0) {
      // a row v3 does not generate (or no longer generates): keep what the pilot typed
      custom.push(freqEntry({ id: `v2-${id}`, role: 'custom', group: c.field ?? 'ATC', callsign: c.field ?? '', service: '', sourceKey: null }, c, 'From the v2 navlog'));
      continue;
    }
    const first = out[idx];
    const group = c.field ?? first.group;
    if (c.freq !== undefined) {
      const one = freqEntry({ id: first.id, role: first.role, group, callsign: c.field ?? first.callsign, service: '', sourceKey: first.sourceKey }, c, 'Edited in the v2 navlog');
      out = [...out.slice(0, idx), one, ...out.slice(idx + 1).filter((e) => !f!(e))];
    } else {
      out = out.map((e) => (f!(e) ? { ...e, group } : e));
      const extra = [c.elev ? `ELEV ${c.elev}` : '', c.rwy ? `RWY ${c.rwy}` : ''].filter(Boolean);
      if (extra.length) out[idx] = { ...out[idx], remark: [out[idx].remark, ...extra].filter(Boolean).join('; ') };
    }
  }
  for (const id of manual) {
    const c = cells.get(id);
    if (!c || !Object.keys(c).length) continue;
    custom.push(freqEntry({ id: `v2-${id}`, role: 'custom', group: c.field ?? 'ATC', callsign: c.field ?? '', service: '', sourceKey: null }, c, ''));
  }
  return [...out, ...custom];
}

const num = (v: unknown): number => {
  if (v === undefined || v === null || String(v).trim() === '') return NaN;
  const n = parseFloat(String(v).replace(',', '.').replace(/[−–]/g, '-'));
  return isFinite(n) ? n : NaN;
};

const V2_OVERRIDE_CELLS: [string, keyof LegOverride][] = [['alt', 'altFt'], ['tas', 'tasKt'], ['wd', 'windDirDeg'], ['ws', 'windKt'], ['temp', 'tempC']];

/**
 * v2 per-leg cells (`L<i>.alt|tas|wd|ws|temp`) → v3 leg overrides keyed '<uid>><uid>'. A value
 * outside LEG_OVERRIDE_LIMITS (what PUT /flights accepts) is dropped: the computed value applies.
 */
export function legacyLegOverrides(ov: Record<string, unknown>, route: Pick<RoutePoint, 'uid'>[]): Record<string, LegOverride> {
  const out: Record<string, LegOverride> = {};
  for (let i = 0; i + 1 < route.length; i++) {
    const o: LegOverride = {};
    for (const [cell, field] of V2_OVERRIDE_CELLS) {
      const n = num(ov[`L${i}.${cell}`]);
      const [min, max] = LEG_OVERRIDE_LIMITS[field];
      if (isFinite(n) && n >= min && n <= max) o[field] = n;
    }
    if (Object.keys(o).length) out[`${route[i].uid}>${route[i + 1].uid}`] = o;
  }
  return out;
}

const cut = (s: unknown, max: number): string => String(s ?? '').trim().slice(0, max).trim();
const optRange = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === 'number' ? v : num(v);
  return isFinite(n) && n >= min && n <= max ? n : null;
};
const validDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'));
/** Runs a PUT validator; on a refusal, the fallback (logged: it means a gap in fitLegacyDoc). */
const passes = <T>(what: string, check: () => T, fallback: T): T => {
  try {
    return check();
  } catch (e) {
    console.warn(`migration 004: converted ${what} refused by the PUT checks (${(e as Error).message}); using the fallback`);
    return fallback;
  }
};

/**
 * Brings a converted v2 flight within what PUT /flights accepts, so that the editor (which saves
 * the whole document) can save it. Mirrors routes/flights.ts checkDoc and the flightDoc.ts checks:
 * numbers out of range → not set, texts cut to their maximum length, then each sub-document is run
 * through its validator (a refusal there falls back to an empty value instead of failing the run).
 */
export function fitLegacyDoc(doc: FlightDoc, fallbackTaxiMin: number | null): FlightDoc {
  const route = doc.route
    .filter((p) => p.lat >= -90 && p.lat <= 90 && p.lon >= -180 && p.lon <= 180)
    .slice(0, MAX_ROUTE_POINTS)
    .map((p) => ({ ...p, uid: cut(p.uid, 40), refId: p.refId === null ? null : cut(p.refId, 100), name: cut(p.name, 60) }));
  const uids = new Set(route.map((p) => p.uid));
  // overrides of legs whose points were dropped above no longer apply
  const legOverrides = Object.fromEntries(Object.entries(doc.legOverrides).filter(([k]) => k.split('>').every((u) => uids.has(u))));
  const atc = doc.atc === null ? null : doc.atc.slice(0, 200).map((e) => ({
    ...e, id: cut(e.id, 100), group: cut(e.group, 200), callsign: cut(e.callsign, 100), service: cut(e.service, 50),
    primary: cut(e.primary, 20), backups: e.backups.slice(0, 10).map((b) => cut(b, 20)), remark: cut(e.remark, 500),
    sourceKey: e.sourceKey === null ? null : cut(e.sourceKey, 200),
  }));
  const s = doc.summary;
  const summary = {
    ...s, title: cut(s.title, 300), date: validDate(s.date) ? s.date : '', blockOff: cut(s.blockOff, 5), aircraft: cut(s.aircraft, 20),
    route: s.route.filter(([la, lo]) => la >= -90 && la <= 90 && lo >= -180 && lo <= 180).slice(0, MAX_ROUTE_POINTS),
    from: cut(s.from, 60), to: cut(s.to, 60),
    distNm: optRange(s.distNm, 0, 1e5), eteMin: optRange(s.eteMin, 0, 1e5), fuelL: optRange(s.fuelL, 0, 1e5),
  } as FlightDoc['summary'];
  const options = { ...doc.options, compassCard: doc.options.compassCard === null ? null : cut(doc.options.compassCard, 100) || null };
  const taxi = (v: number | null) => (v === null ? null : optRange(v, 0, 600) ?? optRange(fallbackTaxiMin, 0, 600));
  return {
    ...doc,
    title: cut(doc.title, 200),
    blockOff: /^([01]\d|2[0-3]):[0-5]\d$/.test(doc.blockOff) ? doc.blockOff : '',
    taxiOutMin: taxi(doc.taxiOutMin),
    taxiInMin: taxi(doc.taxiInMin),
    route: passes('route', () => checkRoute(route), []),
    legOverrides: passes('leg overrides', () => checkLegOverrides(legOverrides), {}),
    atc: passes('ATC list', () => checkAtc(atc), null),
    options: passes('options', () => checkOptions(options), { ...DEFAULT_FLIGHT_OPTIONS }),
    summary: passes('summary', () => checkSummary(summary), { ...EMPTY_SUMMARY }),
  };
}

export async function convertLegacyFlights(q: Queryable): Promise<void> {
  const exists = await q.query(`SELECT to_regclass('public.legacy_flights') IS NOT NULL AS ok`);
  if (!exists[0]?.ok) return;
  const rows = await q.query('SELECT * FROM legacy_flights ORDER BY created');
  if (!rows.length) return;
  const [cur] = await q.query(`SELECT id FROM ref_airac WHERE current`);
  const airac = cur?.id ?? '';
  const ads = await q.query<{ id: string; icao: string | null; name: string; lat: number; lon: number }>(`SELECT id, icao, name, lat, lon FROM ref_aerodromes WHERE airac = $1`, [airac]);
  const vfr = await q.query<{ id: string; name: string; lat: number; lon: number }>(`SELECT id, name, lat, lon FROM ref_waypoints WHERE airac = $1`, [airac]);
  // full reference documents, loaded only if some flight has ATC edits to convert
  let refDocs: { aerodromes: RefAerodrome[]; airspaces: RefAirspace[]; fis: RefFis | null; vfrPoints: RefVfrPoint[]; vfrRoutes: RefVfrRoute[] } | null = null;
  const loadRef = async () => {
    if (refDocs) return refDocs;
    const docs = async <T>(table: string) => (await q.query<{ doc: T }>(`SELECT doc FROM ${table} WHERE airac = $1 ORDER BY id`, [airac])).map((r) => r.doc);
    const [fis] = await q.query<{ doc: RefFis }>(`SELECT doc FROM ref_fis WHERE airac = $1`, [airac]);
    refDocs = {
      aerodromes: await docs<RefAerodrome>('ref_aerodromes'), airspaces: await docs<RefAirspace>('ref_airspaces'), fis: fis?.doc ?? null,
      vfrPoints: await docs<RefVfrPoint>('ref_waypoints'), vfrRoutes: await docs<RefVfrRoute>('ref_vfr_routes'),
    };
    return refDocs;
  };

  for (const r of rows) {
    const d = (r.data || {}) as Record<string, any>;
    const [pilot] = await q.query('SELECT * FROM pilots WHERE id = $1', [r.owner]);
    if (!pilot) continue;
    const settings = { ...DEFAULT_SETTINGS, ...(pilot.settings || {}) };

    const route: RoutePoint[] = (Array.isArray(d.waypoints) ? d.waypoints : [])
      .filter((w: any) => w && typeof w === 'object' && Math.abs(num(w.lat)) <= 90 && Math.abs(num(w.lon)) <= 180)
      .map((w: any, i: number): RoutePoint => {
        const p = { lat: num(w.lat), lon: num(w.lon) };
        const name = String(w.name || '').trim();
        const ad = ads.find((a) => distanceNm(p, a) <= 1 && (!name || name === a.icao || a.name.includes(name) || name.includes(a.name) || distanceNm(p, a) <= 0.3));
        if (ad) return { uid: `m${i}`, kind: 'aerodrome', refId: ad.id, name: name || ad.icao || ad.name, ...p };
        const v = vfr.find((x) => x.name === name && distanceNm(p, x) <= 0.5);
        if (v) return { uid: `m${i}`, kind: 'vfr', refId: v.id, name, ...p };
        return { uid: `m${i}`, kind: 'custom', refId: null, name: name || `WP${i}`, ...p };
      });

    const ov = (d.ov && typeof d.ov === 'object' ? d.ov : {}) as Record<string, unknown>;
    const legOverrides = legacyLegOverrides(ov, route);

    // ATC list: only materialised when the v2 list was edited (see legacyAtc)
    let atc: AtcEntry[] | null = null;
    if (legacyAtc(d, [], ads) !== null) {
      const ref = await loadRef();
      let generated: AtcEntry[] = [];
      if (ref.fis) {
        const alts = defaultAltitudes(route, ref, route.slice(1).map((_, i) => legOverrides[`${route[i].uid}>${route[i + 1].uid}`]?.altFt))
          .map((x, i) => legOverrides[`${route[i].uid}>${route[i + 1].uid}`]?.altFt ?? x.altFt);
        const radius = isFinite(num(d.fieldRadius)) && num(d.fieldRadius) >= 0 ? num(d.fieldRadius) : settings.enrouteAerodromeRadiusNm;
        generated = generateAtcList(atcInput(route, alts, { aerodromes: ref.aerodromes, airspaces: ref.airspaces, fis: ref.fis }, radius));
      }
      atc = legacyAtc(d, generated, ref.aerodromes);
    }

    const reg = d.aircraft === 'OTHER' ? String(d.aircraftOther || '').toUpperCase() : String(d.aircraft || '');
    const [ac] = reg ? await q.query('SELECT id FROM aircraft WHERE pilot_id = $1 AND registration = $2', [r.owner, reg]) : [];
    const block = parseClock(d.blockStart);
    const created = new Date(Number(r.created));
    const date = validDate(d.date) ? d.date : (isNaN(created.getTime()) ? new Date() : created).toISOString().slice(0, 10);
    const models: WindModel[] = ['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless', 'best_match'];
    const options: FlightOptions = {
      ...DEFAULT_FLIGHT_OPTIONS,
      windModel: models.includes(d.model) ? d.model : settings.windModel,
      compassCard: typeof d.card === 'string' && d.card ? d.card : null,
    };
    const s = (r.summary || {}) as Record<string, any>;
    const summary = {
      ...EMPTY_SUMMARY,
      title: (d.title || '').trim() || s.title || legacyTitle(route),
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
    const doc: FlightDoc = fitLegacyDoc({
      title: String(d.title || '').trim(),
      date,
      blockOff: isFinite(block) ? fmtClock(block) : '',
      aircraftId: ac?.id ?? null,
      taxiOutMin: isFinite(num(d.taxiMin)) ? num(d.taxiMin) : settings.taxiOutMin,
      taxiInMin: settings.taxiInMin,
      fobL: null,
      route,
      legOverrides,
      atc,
      crew: [],
      baggageKg: {},
      options,
      summary,
    }, settings.taxiOutMin ?? null);
    await q.query(
      `INSERT INTO flights (id, pilot_id, title, date, block_off, aircraft_id, taxi_out_min, taxi_in_min, fob_l, route, leg_overrides,
         atc, baggage_kg, options, summary, version, created, updated, opened, deleted)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, $9::jsonb, $10::jsonb, $18::jsonb, '{}'::jsonb, $11::jsonb, $12::jsonb, $13, $14, $15, $16, $17)
       ON CONFLICT (id) DO NOTHING`,
      [r.id, r.owner, doc.title, doc.date, doc.blockOff, doc.aircraftId, doc.taxiOutMin === null ? null : Math.round(doc.taxiOutMin), doc.taxiInMin === null ? null : Math.round(doc.taxiInMin),
        JSON.stringify(doc.route), JSON.stringify(doc.legOverrides), JSON.stringify(doc.options), JSON.stringify(doc.summary),
        Number(r.version) || 1, Number(r.created), Number(r.updated), Number(r.opened) || 0, !!r.deleted, doc.atc === null ? null : JSON.stringify(doc.atc)],
    );
    const pic: PersonDetails = {
      fullName: cut(pilot.full_name || pilot.name, 200), phone: cut(pilot.phone, 50), dateOfBirth: pilot.date_of_birth ?? null,
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
