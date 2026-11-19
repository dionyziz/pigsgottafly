// The NOTAM briefing export: the server's briefing for the saved flight (GET
// /api/flights/:id/notams) laid out for print. Pure: no I/O, no DOM.
import { fmtNotamTime, notamLimits, notamSubject, notamValidity, notamWhere } from '../../../data/notams';
import type { FlightDoc } from '../../../shared';
import type { Notam, NotamBriefing } from '../../../shared/briefing';

export interface BriefingRow {
  key: string;
  where: string;
  subject: string;
  validity: string;
  limits: string;
  schedule: string | null;
  text: string;
  raw: string;
  /** Why it is shown (route position, aerodrome role) or hidden. */
  reasons: string;
  leg: string | null;
}

export interface BriefingModel {
  title: string;
  date: string;
  route: string;
  /** Block start − margin … block stop + margin. */
  window: string;
  /** 'below 4500 ft · 10 NM either side of the route'. */
  filter: string;
  locations: string;
  source: string;
  /** 'ok' with the lists, else a message explaining why there is no list. */
  status: NotamBriefing['status'] | 'loading';
  message: string | null;
  relevant: BriefingRow[];
  /** NOTAMs filtered out (not listed). */
  hiddenCount: number;
}

function row(n: Notam, legName: (i: number) => string): BriefingRow {
  return {
    key: n.key,
    where: notamWhere(n),
    subject: notamSubject(n),
    validity: notamValidity(n),
    limits: notamLimits(n),
    schedule: n.schedule,
    text: n.text,
    raw: n.raw,
    reasons: n.reasons.join(' · '),
    leg: n.legIndex !== null ? legName(n.legIndex) : null,
  };
}

export function briefingModel(input: { doc: FlightDoc; title: string; briefing: NotamBriefing | null }): BriefingModel {
  const { doc, title, briefing: b } = input;
  const route = doc.route.map((p) => p.name).join(' – ');
  const legName = (i: number) => {
    const a = doc.route[i],
      z = doc.route[i + 1];
    return a && z ? `leg ${i + 1} ${a.name} – ${z.name}` : `leg ${i + 1}`;
  };
  const base = { title, date: doc.date, route };
  if (!b) {
    return {
      ...base,
      window: '',
      filter: '',
      locations: '',
      source: '',
      status: 'loading',
      message: null,
      relevant: [],
      hiddenCount: 0,
    };
  }
  const window = `${fmtNotamTime(b.window.from)} – ${fmtNotamTime(b.window.to)} (block start − ${b.params.marginMin} min … block stop + ${b.params.marginMin} min)`;
  const filter = `lower limit at or below ${Math.round(b.params.maxAltFt)} ft · within ${b.params.corridorNm} NM of the route`;
  const source =
    b.status === 'ok' && b.fetched
      ? `${b.source === 'autorouter' ? 'autorouter (EAD)' : (b.source ?? '')}, fetched ${fmtNotamTime(b.fetched)}`
      : '';
  const ok = b.status === 'ok';
  return {
    ...base,
    window,
    filter,
    source,
    locations: b.locations.join(' '),
    status: b.status,
    message: b.message,
    relevant: ok ? b.notams.filter((n) => n.relevant).map((n) => row(n, legName)) : [],
    hiddenCount: ok ? b.notams.filter((n) => !n.relevant).length : 0,
  };
}
