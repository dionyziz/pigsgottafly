// Weather hazards along the route (PLAN-v3 "Weather hazards along the route"). Pure: the samples
// are fetched beforehand (src/data/hazardWeather.ts builds them from Open-Meteo, ECMWF IFS), and
// METAR/TAF are passed in decoded.
//
// For every leg, at its planned altitude and within ±1 h of the time it is flown, and for the
// departure/destination around take-off/landing:
//   - thunderstorms: model weather code 95–99 (danger); CAPE ≥ 1000 J/kg (convection possible,
//     warn); METAR/TAF TS or CB (danger).
//   - visibility below 10 km: model visibility (when the model has it; ECMWF on Open-Meteo does
//     not), fog weather codes 45/48 (danger: below the 5 km VFR minimum); METAR/TAF visibility.
//     Below 5 km is danger, 5–10 km warn.
//   - cloud: a layer of at least SCT (≥ 3 oktas, 37.5 %) whose base is below the planned altitude
//     plus the 1000 ft VFR vertical clearance. Bases are estimated from the cloud cover on the
//     pressure levels (base halfway between the first cloudy level and the clear level below it,
//     or the ground) and, when the low cloud cover is ≥ SCT, from the surface temperature–dewpoint
//     spread (≈ 400 ft/°C above ground); the lower estimate is used. BKN/OVC is danger, SCT warn.
//     The suggestion is the highest altitude keeping 1000 ft below the lowest base (100 ft steps),
//     given only when it is at least 500 ft above the ground.
//
// Corridor: the caller samples each leg every ~10 NM along it and ±5 NM either side (snapped to
// the model grid). Each hazard reports the stretch of the leg it affects (fractions 0–1), so the
// map can mark that stretch without naming the leg; the strip/export prefix the leg.
//
// Everything here is advisory (model guidance); the official briefing remains the pilot's job.
import { fmtClockMs } from '../shared/format.js';
import { fmtAltitude } from './nav.js';

/** Cloud cover on one pressure level. */
export interface HazardLevel {
  /** Geopotential height of the level, m MSL. */
  zM: number;
  /** Cloud cover on the level, %. */
  coverPct: number;
}

/** Model values at one place and one hour. Null = not available. */
export interface HazardSample {
  timeMs: number;
  /** WMO weather code (Open-Meteo weather_code). */
  weatherCode: number | null;
  capeJkg: number | null;
  visibilityM: number | null;
  /** Low cloud cover, %. */
  cloudLowPct: number | null;
  tempC: number | null;
  dewC: number | null;
  /** Model ground elevation, m. */
  elevM: number | null;
  levels: HazardLevel[];
}

/** One corridor sample point of a leg: its position along the leg and its hourly samples. */
export interface CorridorSeries {
  /** 0 = leg start, 1 = leg end. */
  frac: number;
  samples: HazardSample[];
}

export type HazardKind = 'ts' | 'vis' | 'cloud';
export type HazardLevelName = 'danger' | 'warn';

export interface Hazard {
  kind: HazardKind;
  level: HazardLevelName;
  /** Leg index, or the departure/destination aerodrome. */
  scope: { type: 'leg'; legIndex: number } | { type: 'departure' | 'destination' };
  /** Stretch of the leg affected (leg scope); 0..0 / 1..1 at the aerodromes. */
  fromFrac: number;
  toFrac: number;
  /** Without a leg reference, e.g. 'BKN 2800 ft · planned 3500 ft'. */
  text: string;
  /** Hours of the samples that triggered it, epoch ms. */
  timeFromMs: number;
  timeToMs: number;
  /** 'ECMWF IFS 0.25°, run 15 Nov 06Z' or 'METAR LGAV 151320Z' / 'TAF LGAV 151100Z'. */
  source: string;
  /** Cloud: lowest base, ft MSL, and the highest altitude keeping VFR clearance below it. */
  cloudBaseFt?: number;
  suggestedMaxAltFt?: number;
}

export const VFR_CLOUD_CLEARANCE_FT = 1000;
export const SCT_PCT = 37.5;
/** A suggested altitude must leave at least this height above the (model) ground (SERA.5005(f)). */
export const MIN_HEIGHT_FT = 500;
export const CAPE_WARN_JKG = 1000;
export const VIS_WARN_M = 10000;
export const VIS_VFR_MIN_M = 5000;
/** Samples within this long before the leg starts / after it ends count (±1 h). */
export const HAZARD_WINDOW_MS = 60 * 60 * 1000;

const M_TO_FT = 1 / 0.3048;
const fin = (x: unknown): x is number => typeof x === 'number' && isFinite(x);
const okta = (pct: number) => Math.round(pct / 12.5);
export const coverCode = (pct: number): 'FEW' | 'SCT' | 'BKN' | 'OVC' => {
  const o = okta(pct);
  return o <= 2 ? 'FEW' : o <= 4 ? 'SCT' : o <= 7 ? 'BKN' : 'OVC';
};
const COVER_RANK = { FEW: 1, SCT: 2, BKN: 3, OVC: 4, VV: 4 } as const;
const round100 = (ft: number) => Math.round(ft / 100) * 100;
const floor100 = (ft: number) => Math.floor(ft / 100) * 100;
const hhmm = (ms: number) => fmtClockMs(ms);
const timeRange = (a: number, b: number) => (a === b ? `${hhmm(a)}Z` : `${hhmm(a)}–${hhmm(b)}Z`);

/**
 * Lowest cloud layer of at least SCT in a model sample: estimated base (ft MSL) and the cover (%)
 * of the layer, or null when there is none below the highest level.
 */
export function modelCloudBase(s: HazardSample): { baseFt: number; coverPct: number; how: 'levels' | 'spread' } | null {
  const ground = fin(s.elevM) ? s.elevM : 0;
  const lv = s.levels.filter((l) => fin(l.zM) && fin(l.coverPct) && l.zM > ground).sort((a, b) => a.zM - b.zM);
  let fromLevels: { baseFt: number; coverPct: number } | null = null;
  for (let k = 0; k < lv.length; k++) {
    if (lv[k].coverPct < SCT_PCT) continue;
    const below = k > 0 ? lv[k - 1].zM : ground;
    // the layer's cover: the most along its contiguous cloudy levels
    let cover = lv[k].coverPct;
    for (let j = k + 1; j < lv.length && lv[j].coverPct >= SCT_PCT; j++) cover = Math.max(cover, lv[j].coverPct);
    fromLevels = { baseFt: ((below + lv[k].zM) / 2) * M_TO_FT, coverPct: cover };
    break;
  }
  let fromSpread: { baseFt: number; coverPct: number } | null = null;
  if (fin(s.cloudLowPct) && s.cloudLowPct >= SCT_PCT && fin(s.tempC) && fin(s.dewC)) {
    fromSpread = { baseFt: ground * M_TO_FT + Math.max(0, s.tempC - s.dewC) * 400, coverPct: s.cloudLowPct };
  }
  if (fromLevels && fromSpread) {
    const low = fromSpread.baseFt < fromLevels.baseFt ? fromSpread : fromLevels;
    return {
      baseFt: low.baseFt,
      coverPct: Math.max(fromLevels.coverPct, fromSpread.coverPct),
      how: low === fromSpread ? 'spread' : 'levels',
    };
  }
  if (fromLevels) return { ...fromLevels, how: 'levels' };
  if (fromSpread) return { ...fromSpread, how: 'spread' };
  return null;
}

interface Hit {
  kind: HazardKind;
  level: HazardLevelName;
  rank: number;
  frac: number;
  timeMs: number;
  text: string;
  baseFt?: number;
  cover?: string;
  groundFt?: number;
}

/** Hazards of one model sample at a planned altitude. */
function sampleHits(s: HazardSample, frac: number, altFt: number): Hit[] {
  const hits: Hit[] = [];
  const t = s.timeMs;
  const wc = s.weatherCode;
  if (fin(wc) && wc >= 95 && wc <= 99) {
    hits.push({
      kind: 'ts',
      level: 'danger',
      rank: 3,
      frac,
      timeMs: t,
      text: wc >= 96 ? 'Thunderstorm with hail forecast' : 'Thunderstorm forecast',
    });
  } else if (fin(s.capeJkg) && s.capeJkg >= CAPE_WARN_JKG) {
    hits.push({
      kind: 'ts',
      level: 'warn',
      rank: s.capeJkg,
      frac,
      timeMs: t,
      text: `CAPE ${Math.round(s.capeJkg / 100) * 100} J/kg: thunderstorms possible`,
    });
  }
  if (fin(wc) && (wc === 45 || wc === 48)) {
    hits.push({ kind: 'vis', level: 'danger', rank: 1e9, frac, timeMs: t, text: 'Fog forecast' });
  } else if (fin(s.visibilityM) && s.visibilityM < VIS_WARN_M) {
    const km = s.visibilityM / 1000;
    hits.push({
      kind: 'vis',
      level: s.visibilityM < VIS_VFR_MIN_M ? 'danger' : 'warn',
      rank: VIS_WARN_M - s.visibilityM,
      frac,
      timeMs: t,
      text: `Visibility ${km < 1 ? km.toFixed(1) : Math.floor(km)} km forecast`,
    });
  }
  if (fin(altFt)) {
    const c = modelCloudBase(s);
    if (c && c.baseFt < altFt + VFR_CLOUD_CLEARANCE_FT) {
      const code = coverCode(c.coverPct);
      hits.push({
        kind: 'cloud',
        level: COVER_RANK[code] >= 3 ? 'danger' : 'warn',
        rank: -c.baseFt,
        frac,
        timeMs: t,
        text: '',
        baseFt: c.baseFt,
        cover: code,
        groundFt: fin(s.elevM) ? s.elevM * M_TO_FT : 0,
      });
    }
  }
  return hits;
}

function aggregate(hits: Hit[], altFt: number, scope: Hazard['scope'], source: string, pad: number): Hazard[] {
  const out: Hazard[] = [];
  for (const kind of ['ts', 'vis', 'cloud'] as HazardKind[]) {
    const hs = hits.filter((h) => h.kind === kind);
    if (!hs.length) continue;
    const worst = hs.reduce((a, b) =>
      (b.level === 'danger' && a.level !== 'danger') || (b.level === a.level && b.rank > a.rank) ? b : a,
    );
    const fr = hs.map((h) => h.frac),
      tm = hs.map((h) => h.timeMs);
    const fromFrac = Math.max(0, Math.min(...fr) - pad),
      toFrac = Math.min(1, Math.max(...fr) + pad);
    const tFrom = Math.min(...tm),
      tTo = Math.max(...tm);
    let text = worst.text;
    const h: Hazard = {
      kind,
      level: worst.level,
      scope,
      fromFrac,
      toFrac,
      text,
      timeFromMs: tFrom,
      timeToMs: tTo,
      source,
    };
    if (kind === 'cloud') {
      // the lowest base and the most cover over the stretch
      const base = Math.min(...hs.map((x) => x.baseFt as number));
      const cover = hs
        .map((x) => x.cover as keyof typeof COVER_RANK)
        .reduce((a, b) => (COVER_RANK[b] > COVER_RANK[a] ? b : a));
      const ground = Math.max(...hs.map((x) => x.groundFt ?? 0));
      const maxAlt = floor100(base - VFR_CLOUD_CLEARANCE_FT);
      const usable = maxAlt >= ground + MIN_HEIGHT_FT;
      h.level = COVER_RANK[cover] >= 3 ? 'danger' : 'warn';
      h.cloudBaseFt = round100(base);
      if (usable) h.suggestedMaxAltFt = maxAlt;
      text =
        `${cover} ${round100(base)} ft · planned ${fmtAltitude(altFt, { unit: true })}` +
        (usable ? ` (highest VFR ≈ ${fmtAltitude(maxAlt, { unit: true })})` : ' (no VFR altitude below it)');
    }
    h.text = `${text}, ${timeRange(tFrom, tTo)}`;
    out.push(h);
  }
  return out;
}

/**
 * Hazards on one leg: every corridor point's samples within [startMs − 1 h, endMs + 1 h], at the
 * leg's planned altitude.
 * @param spacingFrac spacing of the corridor points as a fraction of the leg (marks half of it
 *   either side of the flagged points)
 */
export function legHazards(o: {
  legIndex: number;
  altFt: number;
  startMs: number;
  endMs: number;
  corridor: CorridorSeries[];
  source: string;
  spacingFrac?: number;
}): Hazard[] {
  if (!fin(o.startMs) || !fin(o.endMs)) return [];
  const lo = o.startMs - HAZARD_WINDOW_MS,
    hi = o.endMs + HAZARD_WINDOW_MS;
  const hits: Hit[] = [];
  for (const c of o.corridor)
    for (const s of c.samples) if (s.timeMs >= lo && s.timeMs <= hi) hits.push(...sampleHits(s, c.frac, o.altFt));
  return aggregate(hits, o.altFt, { type: 'leg', legIndex: o.legIndex }, o.source, (o.spacingFrac ?? 0) / 2);
}

/** Hazards at the departure/destination aerodrome from the model, ±1 h of the take-off/landing. */
export function aerodromeModelHazards(o: {
  end: 'departure' | 'destination';
  altFt: number;
  timeMs: number;
  samples: HazardSample[];
  source: string;
}): Hazard[] {
  if (!fin(o.timeMs)) return [];
  const frac = o.end === 'departure' ? 0 : 1;
  const hits: Hit[] = [];
  for (const s of o.samples)
    if (Math.abs(s.timeMs - o.timeMs) <= HAZARD_WINDOW_MS) hits.push(...sampleHits(s, frac, o.altFt));
  return aggregate(hits, o.altFt, { type: o.end }, o.source, 0);
}

// ---- METAR / TAF -------------------------------------------------------------------------------

/** What a report says about hazards (a METAR, or the union of a TAF's groups). */
export interface ReportHazardInput {
  /** 'METAR LGAV 151320Z', 'TAF LGAV 151100Z'. */
  label: string;
  /** Observation time (METAR) or the validity (TAF), epoch ms. */
  timeFromMs: number;
  timeToMs: number;
  /** Lowest visibility, m (9999 = 10 km or more); null = not reported (CAVOK counts as 9999). */
  visibilityM: number | null;
  /** Bases ft above the aerodrome. */
  clouds: { cover: 'FEW' | 'SCT' | 'BKN' | 'OVC' | 'VV'; baseFt: number | null; type: 'CB' | 'TCU' | null }[];
  /** Present/forecast weather groups ('TSRA', '-SHRA', 'BR'). */
  weather: string[];
}

const WX_TOKEN =
  /^(?:[-+]|VC)?(?:MI|BC|PR|DR|BL|SH|TS|FZ)?(?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PO|SQ|FC|SS|DS)+$|^(?:[-+]|VC)?(?:TS|SH)$/;
const CLOUD_TOKEN = /^(FEW|SCT|BKN|OVC|VV)(\d{3}|\/\/\/)(CB|TCU|\/\/\/)?$/;

/**
 * Reads a raw TAF for hazards: the lowest visibility, every cloud group and weather group, over
 * ALL its groups (BECMG, TEMPO, PROB included: conservative). The header (station, issue time,
 * validity) and change-group times are skipped.
 */
export function tafHazardContent(raw: string): {
  visibilityM: number | null;
  clouds: ReportHazardInput['clouds'];
  weather: string[];
} {
  const toks = raw.trim().split(/\s+/);
  let vis: number | null = null;
  const clouds: ReportHazardInput['clouds'] = [];
  const weather: string[] = [];
  for (const tok of toks) {
    if (tok === 'CAVOK') {
      vis = vis == null ? 9999 : Math.min(vis, 9999);
      continue;
    }
    if (/^\d{4}$/.test(tok)) {
      const v = Number(tok);
      vis = vis == null ? v : Math.min(vis, v);
      continue;
    }
    const sm = /^(\d{1,2})SM$/.exec(tok);
    if (sm) {
      const v = Math.round(Number(sm[1]) * 1609);
      vis = vis == null ? v : Math.min(vis, v);
      continue;
    }
    const c = CLOUD_TOKEN.exec(tok);
    if (c) {
      clouds.push({
        cover: c[1] as ReportHazardInput['clouds'][number]['cover'],
        baseFt: c[2] === '///' ? null : Number(c[2]) * 100,
        type: c[3] === 'CB' || c[3] === 'TCU' ? c[3] : null,
      });
      continue;
    }
    if (tok !== 'NSW' && WX_TOKEN.test(tok)) weather.push(tok);
  }
  return { visibilityM: vis, clouds, weather };
}

/** Hazards in a METAR or TAF at an aerodrome, against the planned altitude near it. */
export function reportHazards(
  r: ReportHazardInput,
  o: { end: 'departure' | 'destination'; elevFt: number; altFt: number },
): Hazard[] {
  const out: Hazard[] = [];
  const frac = o.end === 'departure' ? 0 : 1;
  const base = {
    scope: { type: o.end } as Hazard['scope'],
    fromFrac: frac,
    toFrac: frac,
    timeFromMs: r.timeFromMs,
    timeToMs: r.timeToMs,
    source: r.label,
  };
  const ts = r.weather.filter((w) => /TS/.test(w));
  const cb = r.clouds.filter((c) => c.type === 'CB');
  if (ts.length || cb.length) {
    const what = [
      ...new Set([
        ...ts,
        ...cb.map((c) => `${c.cover}${c.baseFt != null ? String(c.baseFt / 100).padStart(3, '0') : '///'}CB`),
      ]),
    ].join(' ');
    out.push({ ...base, kind: 'ts', level: 'danger', text: `Thunderstorm/CB in ${r.label.split(' ')[0]}: ${what}` });
  }
  const fog = r.weather.some((w) => /FG/.test(w) && !/^(MI|BC|PR|VC)/.test(w.replace(/^[-+]/, '')));
  if (r.visibilityM != null && r.visibilityM < VIS_WARN_M - 1) {
    const km = r.visibilityM / 1000;
    out.push({
      ...base,
      kind: 'vis',
      level: r.visibilityM < VIS_VFR_MIN_M ? 'danger' : 'warn',
      text: `Visibility ${km < 1 ? `${r.visibilityM} m` : `${Math.floor(km)} km`} in ${r.label.split(' ')[0]}${fog ? ' (fog)' : ''}`,
    });
  } else if (fog) {
    out.push({ ...base, kind: 'vis', level: 'danger', text: `Fog in ${r.label.split(' ')[0]}` });
  }
  if (fin(o.altFt)) {
    const layers = r.clouds
      .filter((c) => COVER_RANK[c.cover] >= 2 && c.baseFt != null)
      .map((c) => ({ cover: c.cover, baseMsl: (c.baseFt as number) + o.elevFt }))
      .filter((c) => c.baseMsl < o.altFt + VFR_CLOUD_CLEARANCE_FT)
      .sort((a, b) => a.baseMsl - b.baseMsl);
    if (layers.length) {
      const low = layers[0];
      const worst = layers.reduce((a, b) => (COVER_RANK[b.cover] > COVER_RANK[a.cover] ? b : a));
      const maxAlt = floor100(low.baseMsl - VFR_CLOUD_CLEARANCE_FT);
      const usable = maxAlt >= o.elevFt + MIN_HEIGHT_FT;
      out.push({
        ...base,
        kind: 'cloud',
        level: COVER_RANK[worst.cover] >= 3 ? 'danger' : 'warn',
        text:
          `${low.cover} ${round100(low.baseMsl)} ft in ${r.label.split(' ')[0]} · planned ${fmtAltitude(o.altFt, { unit: true })}` +
          (usable ? ` (highest VFR ≈ ${fmtAltitude(maxAlt, { unit: true })})` : ' (no VFR altitude below it)'),
        cloudBaseFt: round100(low.baseMsl),
        ...(usable ? { suggestedMaxAltFt: maxAlt } : {}),
      });
    }
  }
  return out;
}

/** 'Leg 2 KOROPI → LGSO' / 'Departure LGTT' prefix for list displays (strip, export). */
export function hazardWhere(
  h: Hazard,
  legName: (i: number) => string,
  endName: (e: 'departure' | 'destination') => string,
): string {
  return h.scope.type === 'leg'
    ? `Leg ${h.scope.legIndex + 1} ${legName(h.scope.legIndex)}`
    : `${h.scope.type === 'departure' ? 'Departure' : 'Destination'} ${endName(h.scope.type)}`;
}
