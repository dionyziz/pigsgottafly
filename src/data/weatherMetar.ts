// METAR/TAF: decoding of the raw reports (pure), and the client fetch through our proxy
// GET /api/weather/metar (api/_lib/routes/weather.ts → aviationweather.gov).
//
// The decoder reads what planning needs: report time, surface wind (true; VRB, gusts, variable
// sector, MPS/KMH converted to kt), visibility/CAVOK, cloud layers, temperature/dewpoint and QNH
// (Q hPa, or A inHg converted). Trend groups (NOSIG/BECMG/TEMPO) and remarks are not decoded, so a
// trend's wind is never mistaken for the observed one. TAFs are decoded down to their validity
// period; the raw text is shown to the pilot as it is.
import type { MetarTafResponse } from '../shared';
import { api } from './api';

export interface MetarWind {
  /** Direction the wind blows FROM, degrees TRUE; null when variable (VRB) or unknown. */
  dirDeg: number | null;
  speedKt: number;
  gustKt: number | null;
  /** Variable sector (e.g. 010V070), degrees true. */
  varFrom: number | null;
  varTo: number | null;
  /** VRB in the report. */
  variable: boolean;
  calm: boolean;
}

export interface MetarCloud {
  cover: 'FEW' | 'SCT' | 'BKN' | 'OVC' | 'VV';
  /** Base, ft above aerodrome level; null when '///'. */
  baseFt: number | null;
  type: 'CB' | 'TCU' | null;
}

export interface ParsedMetar {
  raw: string;
  type: 'METAR' | 'SPECI';
  station: string;
  /** Observation time, epoch ms (null if the time group is missing or unreadable). */
  timeMs: number | null;
  auto: boolean;
  /** 'METAR LGXX 151320Z NIL': no report. */
  nil: boolean;
  wind: MetarWind | null;
  cavok: boolean;
  /** Prevailing visibility, m (9999 = 10 km or more); null if not reported. */
  visibilityM: number | null;
  clouds: MetarCloud[];
  /** NSC, NCD, SKC, CLR (or CAVOK) when no cloud layers are reported. */
  skyClear: string | null;
  /** Present weather groups as written (e.g. '-RA', 'TSRA', 'BR'). */
  weather: string[];
  tempC: number | null;
  dewC: number | null;
  qnhHpa: number | null;
}

export interface ParsedTaf {
  raw: string;
  station: string;
  /** Issue time, epoch ms. */
  issuedMs: number | null;
  validFromMs: number | null;
  validToMs: number | null;
  amended: boolean;
  corrected: boolean;
}

const KMH_TO_KT = 1 / 1.852;
const MPS_TO_KT = 3600 / 1852;
const INHG_TO_HPA = 33.8639;

/**
 * Resolves a day/hour/minute group (no month or year) to epoch ms: the latest such instant not
 * later than the reference time plus 2 days (reports are never from the future, TAF validity ends
 * at most ~30 h after issue). Handles month and year boundaries.
 */
export function resolveDayTime(day: number, hour: number, minute: number, refMs: number): number | null {
  if (!(day >= 1 && day <= 31 && hour >= 0 && hour <= 24 && minute >= 0 && minute <= 59)) return null;
  const ref = new Date(refMs);
  const limit = refMs + 2 * 86400000;
  for (let back = -1; back <= 2; back++) {
    const y = ref.getUTCFullYear(), m = ref.getUTCMonth() - back;
    const first = new Date(Date.UTC(y, m, 1));
    // the day must exist in that month (e.g. 31 in a 30-day month is skipped)
    const daysInMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    if (day > daysInMonth) continue;
    const t = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), day, hour, minute);
    if (t <= limit) return t;
  }
  return null;
}

const WIND_RE = /^(\d{3}|VRB|\/\/\/)(\d{2,3}|\/\/)(?:G(\d{2,3}))?(KT|MPS|KMH)$/;
const TEMP_RE = /^(M?\d{2}|\/\/)\/(M?\d{2}|\/\/)?$/;
const CLOUD_RE = /^(FEW|SCT|BKN|OVC|VV)(\d{3}|\/\/\/)(CB|TCU|\/\/\/)?$/;
const WX_RE = /^(?:[-+]|VC)?(?:MI|BC|PR|DR|BL|SH|TS|FZ)?(?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PO|SQ|FC|SS|DS)+$|^(?:[-+]|VC)?(?:TS|SH)$/;
const TREND = new Set(['NOSIG', 'BECMG', 'TEMPO', 'RMK']);

const tempOf = (s: string | undefined): number | null => (s && s !== '//' ? (s.startsWith('M') ? -Number(s.slice(1)) : Number(s)) : null);

function parseWind(tok: string): MetarWind | null {
  const m = WIND_RE.exec(tok);
  if (!m) return null;
  if (m[1] === '///' || m[2] === '//') return null;
  const k = m[4] === 'MPS' ? MPS_TO_KT : m[4] === 'KMH' ? KMH_TO_KT : 1;
  const speedKt = Math.round(Number(m[2]) * k);
  const gustKt = m[3] ? Math.round(Number(m[3]) * k) : null;
  const variable = m[1] === 'VRB';
  const dir = variable ? null : Number(m[1]) % 360;
  const calm = !variable && Number(m[1]) === 0 && speedKt === 0;
  return { dirDeg: calm ? null : dir === 0 ? 360 : dir, speedKt, gustKt, varFrom: null, varTo: null, variable, calm };
}

/**
 * Decodes a raw METAR/SPECI. Never throws: unreadable groups are skipped.
 * @param refMs reference time for the day/time group (e.g. when it was fetched); default now.
 */
export function parseMetar(raw: string, refMs: number = Date.now()): ParsedMetar {
  const out: ParsedMetar = {
    raw: raw.trim(), type: 'METAR', station: '', timeMs: null, auto: false, nil: false, wind: null, cavok: false,
    visibilityM: null, clouds: [], skyClear: null, weather: [], tempC: null, dewC: null, qnhHpa: null,
  };
  const toks = out.raw.replace(/=$/, '').split(/\s+/).filter(Boolean);
  let i = 0;
  if (toks[i] === 'METAR' || toks[i] === 'SPECI') out.type = toks[i++] as 'METAR' | 'SPECI';
  if (toks[i] === 'COR') i++;
  if (toks[i] && /^[A-Z][A-Z0-9]{3}$/.test(toks[i])) out.station = toks[i++];
  const tm = toks[i] && /^(\d{2})(\d{2})(\d{2})Z$/.exec(toks[i]);
  if (tm) {
    out.timeMs = resolveDayTime(Number(tm[1]), Number(tm[2]), Number(tm[3]), refMs);
    i++;
  }
  for (; i < toks.length; i++) {
    const t = toks[i];
    if (TREND.has(t)) break;
    if (t === 'NIL') { out.nil = true; break; }
    if (t === 'AUTO') { out.auto = true; continue; }
    if (t === 'COR') continue;
    if (!out.wind) {
      const w = parseWind(t);
      if (w) { out.wind = w; continue; }
    }
    const vs = /^(\d{3})V(\d{3})$/.exec(t);
    if (vs && out.wind) { out.wind.varFrom = Number(vs[1]); out.wind.varTo = Number(vs[2]); continue; }
    if (t === 'CAVOK') { out.cavok = true; out.visibilityM = 9999; out.skyClear = 'CAVOK'; continue; }
    if (/^\d{4}$/.test(t) && out.visibilityM === null) { out.visibilityM = Number(t); continue; }
    if (/^\d{4}(N|NE|E|SE|S|SW|W|NW|NDV)$/.test(t)) { if (out.visibilityM === null) out.visibilityM = Number(t.slice(0, 4)); continue; }
    const sm = /^(P|M)?(\d+)(?:\/(\d+))?SM$/.exec(t);
    if (sm && out.visibilityM === null) {
      const miles = sm[3] ? Number(sm[2]) / Number(sm[3]) : Number(sm[2]);
      out.visibilityM = Math.min(9999, Math.round(miles * 1609.344));
      continue;
    }
    if (/^R\d{2}[LCR]?\//.test(t)) continue; // RVR
    const cl = CLOUD_RE.exec(t);
    if (cl) {
      out.clouds.push({
        cover: cl[1] as MetarCloud['cover'],
        baseFt: cl[2] === '///' ? null : Number(cl[2]) * 100,
        type: cl[3] === 'CB' || cl[3] === 'TCU' ? cl[3] : null,
      });
      continue;
    }
    if (t === 'NSC' || t === 'NCD' || t === 'SKC' || t === 'CLR') { out.skyClear = t; continue; }
    const tp = TEMP_RE.exec(t);
    if (tp && out.tempC === null) { out.tempC = tempOf(tp[1]); out.dewC = tempOf(tp[2]); continue; }
    const q = /^Q(\d{3,4})$/.exec(t);
    if (q) { out.qnhHpa = Number(q[1]); continue; }
    const a = /^A(\d{4})$/.exec(t);
    if (a) { out.qnhHpa = Math.round((Number(a[1]) / 100) * INHG_TO_HPA * 10) / 10; continue; }
    if (/^RE/.test(t) || /^WS$/.test(t)) break; // recent weather / wind shear: end of the main body
    if (WX_RE.test(t)) { out.weather.push(t); continue; }
  }
  return out;
}

/** Decodes a raw TAF down to its header: station, issue time and validity period. */
export function parseTaf(raw: string, refMs: number = Date.now()): ParsedTaf {
  const out: ParsedTaf = { raw: raw.trim(), station: '', issuedMs: null, validFromMs: null, validToMs: null, amended: false, corrected: false };
  const toks = out.raw.split(/\s+/).filter(Boolean);
  let i = 0;
  if (toks[i] === 'TAF') i++;
  while (toks[i] === 'AMD' || toks[i] === 'COR') { if (toks[i] === 'AMD') out.amended = true; else out.corrected = true; i++; }
  if (toks[i] && /^[A-Z][A-Z0-9]{3}$/.test(toks[i])) out.station = toks[i++];
  const it = toks[i] && /^(\d{2})(\d{2})(\d{2})Z$/.exec(toks[i]);
  if (it) { out.issuedMs = resolveDayTime(Number(it[1]), Number(it[2]), Number(it[3]), refMs); i++; }
  const vp = toks[i] && /^(\d{2})(\d{2})\/(\d{2})(\d{2})$/.exec(toks[i]);
  if (vp) {
    const base = out.issuedMs ?? refMs;
    out.validFromMs = resolveDayTime(Number(vp[1]), Number(vp[2]), 0, base + 86400000);
    // the end is after the start: resolve against the start (+ up to 30 h)
    out.validToMs = out.validFromMs === null ? null : resolveDayTime(Number(vp[3]), Number(vp[4]), 0, out.validFromMs);
    if (out.validToMs !== null && out.validFromMs !== null && out.validToMs <= out.validFromMs) {
      out.validToMs = resolveDayTime(Number(vp[3]), Number(vp[4]), 0, out.validFromMs + 2 * 86400000);
    }
  }
  return out;
}

/** True when the TAF's validity period covers the time. */
export const tafCovers = (taf: ParsedTaf | null, timeMs: number): boolean =>
  !!taf && taf.validFromMs !== null && taf.validToMs !== null && timeMs >= taf.validFromMs && timeMs <= taf.validToMs;

/** METAR-style wind group of a decoded wind, e.g. '05009KT', 'VRB03KT', '27015G25KT', '00000KT'. */
export function fmtMetarWind(w: MetarWind | null): string {
  if (!w) return '';
  if (w.calm) return '00000KT';
  const spd = String(w.speedKt).padStart(2, '0');
  const g = w.gustKt !== null ? `G${String(w.gustKt).padStart(2, '0')}` : '';
  return `${w.dirDeg === null ? 'VRB' : String(w.dirDeg).padStart(3, '0')}${spd}${g}KT`;
}

// ---- client: fetch through the proxy -----------------------------------------------------------

export interface StationReports {
  metar: ParsedMetar | null;
  taf: ParsedTaf | null;
  /** Observation time of the METAR, epoch ms (from the provider, else decoded). */
  observedMs: number | null;
}

export interface MetarTafResult {
  status: 'ok' | 'error';
  /** For display: e.g. 'aviationweather.gov, fetched 13:36Z', or the error. */
  message: string;
  source: 'aviationweather.gov';
  /** When the proxy fetched the reports, epoch ms. */
  fetchedMs: number | null;
  /** Keyed by ICAO; aerodromes without reports are absent. */
  stations: Record<string, StationReports>;
}

const hhmmZ = (ms: number) => new Date(ms).toISOString().slice(11, 16) + 'Z';

/** Builds the decoded result from a proxy response (pure; exported for tests). */
export function decodeMetarTafResponse(r: MetarTafResponse): MetarTafResult {
  const stations: Record<string, StationReports> = {};
  for (const [icao, s] of Object.entries(r.stations || {})) {
    const ref = s.observed ?? r.fetched;
    const metar = s.metar ? parseMetar(s.metar, ref) : null;
    const taf = s.taf ? parseTaf(s.taf, r.fetched) : null;
    stations[icao] = { metar, taf, observedMs: s.observed ?? metar?.timeMs ?? null };
  }
  return { status: 'ok', message: `aviationweather.gov, fetched ${hhmmZ(r.fetched)}`, source: 'aviationweather.gov', fetchedMs: r.fetched, stations };
}

const ICAO_RE = /^[A-Z]{4}$/;
/** Aerodromes per request to GET /api/weather/metar (api/_lib/routes/weather.ts MAX_IDS). */
export const METAR_MAX_IDS = 6;
const metarCache = new Map<string, { at: number; p: Promise<MetarTafResult> }>();
/** Client cache lifetime; the proxy caches too. */
export const METAR_CLIENT_TTL_MS = 2 * 60 * 1000;

/**
 * METAR and TAF of the aerodromes (ICAO codes; others are ignored). Never rejects: on failure the
 * result has status 'error' and no stations, so callers fall back to the forecast.
 */
export function fetchMetarTaf(icaos: string[], opts: { force?: boolean; now?: () => number } = {}): Promise<MetarTafResult> {
  const now = opts.now || Date.now;
  const ids = [...new Set(icaos.map((x) => (x || '').trim().toUpperCase()).filter((x) => ICAO_RE.test(x)))].sort();
  if (!ids.length) return Promise.resolve({ status: 'ok', message: '', source: 'aviationweather.gov', fetchedMs: null, stations: {} });
  const key = ids.join(',');
  const hit = metarCache.get(key);
  if (hit && !opts.force && now() - hit.at < METAR_CLIENT_TTL_MS) return hit.p;
  // the proxy takes METAR_MAX_IDS aerodromes per request
  const groups: string[][] = [];
  for (let i = 0; i < ids.length; i += METAR_MAX_IDS) groups.push(ids.slice(i, i + METAR_MAX_IDS));
  const p = Promise.all(groups.map((g) => api.weather.metar(g)))
    .then((rs) => decodeMetarTafResponse({ stations: Object.assign({}, ...rs.map((r) => r.stations)), fetched: Math.min(...rs.map((r) => r.fetched)) }))
    .catch((e: unknown): MetarTafResult => {
      metarCache.delete(key);
      const msg = (e as { offline?: boolean })?.offline ? 'offline' : String((e as Error)?.message || e);
      return { status: 'error', message: `METAR/TAF unavailable (${msg})`, source: 'aviationweather.gov', fetchedMs: null, stations: {} };
    });
  metarCache.set(key, { at: now(), p });
  return p;
}
export const clearMetarCache = () => metarCache.clear();
