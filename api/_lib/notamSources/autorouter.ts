// autorouter as a NOTAM source (GET /notam, Eurocontrol EAD data; the client is api/_lib/autorouter.ts).
// Its licence is personal to the account: the source serves only the pilots on AUTOROUTER_PILOTS (the
// route context gives it a client only for them) and only their own flights, so what it returns is
// never shown to another pilot, not even on a flight shared with them.
import type { AutorouterClient, AutorouterNotamRow } from '../autorouter.js';
import { AutorouterError } from '../autorouter.js';
import { blankNotam, type NotamSourceDriver, NotamSourceError, type RawNotam } from './types.js';

/** autorouter's coordinate unit (Garmin): × 90 / 2^30 → degrees. */
const GARMIN = 90 / 2 ** 30;

const str = (v: unknown) => {
  const s = String(v ?? '').trim();
  return s ? s : null;
};
const num = (v: unknown) => (v !== null && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : null);

/** An autorouter row → RawNotam; null without a usable start time. */
export function fromAutorouterRow(r: AutorouterNotamRow): RawNotam | null {
  if (!r || typeof r !== 'object') return null;
  const from = Number(r.startvalidity) * 1000;
  if (!Number.isFinite(from)) return null;
  const endRaw = r.endvalidity;
  // autorouter writes PERM as a far-future 2^31-1 style value
  const to =
    endRaw === null || endRaw === undefined || !Number.isFinite(Number(endRaw)) || Number(endRaw) >= 2 ** 31 - 1
      ? null
      : Number(endRaw) * 1000;
  const hasPos = Number.isFinite(r.lat) && Number.isFinite(r.lon) && !(r.lat === 0 && r.lon === 0);
  const type = (['N', 'R', 'C'].includes(String(r.type)) ? r.type : 'N') as RawNotam['type'];
  const refNumber = num(r.referrednumber);
  return {
    ...blankNotam('autorouter'),
    sourceId: r.id !== undefined && r.id !== null ? String(r.id) : null,
    series: str(r.series)?.toUpperCase() ?? null,
    number: num(r.number),
    year: num(r.year),
    type,
    refers:
      type !== 'N' && r.referredseries && refNumber !== null
        ? { series: String(r.referredseries).toUpperCase(), number: refNumber, year: (num(r.referredyear) ?? 0) % 100 }
        : null,
    fir: str(r.fir)?.toUpperCase() ?? null,
    code23: str(r.code23)?.toUpperCase() ?? null,
    code45: str(r.code45)?.toUpperCase() ?? null,
    traffic: str(r.traffic),
    purpose: str(r.purpose),
    scope: str(r.scope),
    lowerFl: num(r.lower),
    upperFl: num(r.upper),
    center: hasPos ? { lat: +(Number(r.lat) * GARMIN).toFixed(5), lon: +(Number(r.lon) * GARMIN).toFixed(5) } : null,
    radiusNm: num(r.radius),
    itemA: (Array.isArray(r.itema) ? r.itema : []).map((x) => String(x).toUpperCase().trim()).filter(Boolean),
    from,
    to,
    estimated: !!(r.estimation && String(r.estimation).trim()),
    itemD: str(r.itemd),
    itemE: str(r.iteme),
    itemF: str(r.itemf),
    itemG: str(r.itemg),
  };
}

/** `client`: the request's autorouter client, null when the account is not for this pilot. */
export function autorouterNotamSource(client: AutorouterClient | null): NotamSourceDriver {
  return {
    id: 'autorouter',
    label: 'autorouter',
    timeoutMs: 25_000,
    availableFor: ({ pilotId, ownerId }) => !!client && pilotId === ownerId,
    async fetch({ locations, window }) {
      if (!client) throw new NotamSourceError('autorouter is not available');
      try {
        const rows = await client.notams(locations, window.from, window.to);
        return rows.map(fromAutorouterRow).filter((n): n is RawNotam => !!n);
      } catch (e) {
        throw e instanceof AutorouterError ? new NotamSourceError(e.message) : e;
      }
    },
  };
}
