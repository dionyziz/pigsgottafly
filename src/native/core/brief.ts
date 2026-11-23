// The Brief stage as the website's editor shows it: the METAR box (MetarSection), the aerodrome
// hours (AerodromeSection, AerodromeHours) and the take-off and landing cards (PerformanceSection),
// worked out from what computeFlight returned so the flight is not computed twice.
import { clockZ } from '../../calc';
import type { PerfVerdictResult } from '../../calc/perfVerdict';
import {
  groupNotams,
  hasNotamArea,
  notamLimits,
  notamSourcesLine,
  notamSubject,
  notamValidity,
  notamWhere,
  onlyFromAutorouter,
  visibleNotams,
} from '../../data/notams';
import type { StationReports } from '../../data/weatherMetar';
import { adDayInfo, fmtAdDay } from '../../features/editor/adDay';
import { AD_ROLE, type AdCheck } from '../../features/editor/panels/aerodromeChecks';
import { calcAdEffects, type EndpointCalc, type StopCalc } from '../../features/editor/panels/flightCalc';
import { metarBoxShown, metarStations, metarWhere } from '../../features/editor/panels/metarStations';
import {
  endpointTid,
  endpointTitle,
  endpointVerdict,
  reasonText,
  weatherText,
} from '../../features/editor/panels/performance';
import { type Aircraft, type Flight, type FlightOptions, requestOf } from '../../shared';
import type { Notam, NotamBriefing } from '../../shared/briefing';
import { fmtClock, fmtClockMs } from '../../shared/format';
import { arg, type CoreRef, fin, type Json, nowOf, plain, refOf } from './shared';

/** The part of computeFlight's answer the Brief reads. */
interface Computed {
  departure: EndpointCalc;
  arrival: EndpointCalc;
  stops: StopCalc[];
  aerodromeChecks: AdCheck[];
  times: { dayMs: number | null };
  weather: { metar: { stations: Record<string, StationReports> } | null } | null;
}

export interface BriefInput {
  /** computeFlight's answer for this flight. */
  computed: Computed;
  flight: Pick<Flight, 'date' | 'route' | 'options'>;
  aircraft?: Pick<Aircraft, 'massBalance' | 'performance'> | null;
  notams?: NotamBriefing | null;
  ref?: CoreRef | null;
  now?: number;
  /** The NOTAM list shows the hidden ones too ("Show all"). */
  showAll?: boolean;
}

type Tone = 'ok' | 'warn' | 'danger';

function metarBox(
  c: Computed,
  flight: BriefInput['flight'],
  aerodromes: Parameters<typeof metarStations>[2],
  now: number,
) {
  const shown = metarBoxShown(flight.date, c.departure.timeMs ?? NaN, c.arrival.timeMs ?? NaN, now);
  const stations = metarStations(
    [c.departure.aerodrome, ...c.stops.map((s) => s.aerodrome), c.arrival.aerodrome],
    flight.route,
    aerodromes,
  );
  const reports = c.weather?.metar?.stations ?? {};
  const rows = !shown
    ? []
    : stations.flatMap((s) => {
        const r = reports[s.icao];
        const metar = r?.metar && !r.metar.nil ? r.metar : null;
        const taf = r?.taf ?? null;
        if (!metar && !taf && s.role === 'area') return [];
        return [
          {
            icao: s.icao,
            role: s.role,
            where: metarWhere(s, stations),
            name: s.aerodrome.name,
            metar: metar?.raw ?? null,
            taf: taf?.raw ?? null,
            observedMs: metar ? (r.observedMs ?? null) : null,
          },
        ];
      });
  // the website hides the box when no station has a report
  return { shown, rows: rows.some((x) => x.metar || x.taf) ? rows : [] };
}

function statusChip(c: AdCheck): { tone: Tone; text: string; detail: string } | null {
  if (!fin(c.fromMs)) return null;
  const { status, limits } = c.ad;
  if (status === 'closed')
    return { tone: 'danger', text: `Closed ${clockZ(c.ad.at)}Z`, detail: `${c.ad.why} (${c.ad.source})` };
  if (limits.length)
    return { tone: 'warn', text: 'Limited', detail: limits.map((l) => `NOTAM ${l.key}: ${l.summary}`).join('\n') };
  if (status === 'open') return { tone: 'ok', text: 'Open', detail: `${c.ad.why} (${c.ad.source})` };
  return null;
}

function aerodromeHours(
  c: Computed,
  flight: BriefInput['flight'],
  notams: NotamBriefing | null,
  now: number,
) {
  const effects = calcAdEffects(notams);
  const items = (c.aerodromeChecks ?? []).map((ck) => {
    const a = ck.aerodrome;
    const info = adDayInfo(a, flight.date, effects, now);
    const h = a.hours;
    const timed = fin(ck.fromMs);
    const partial = !!h && [h.ad, h.ats, h.handling].some((f) => f?.parsed.partial);
    const day = (d: typeof info.ad) => (d ? { text: d.text, notams: d.notams } : null);
    return {
      id: `${ck.role}-${ck.pointIndex}`,
      role: ck.role,
      title: `${AD_ROLE[ck.role]} ${a.icao || a.name}`,
      icao: a.icao ?? a.id,
      name: a.name,
      closed: ck.ad.status === 'closed' && timed,
      chip: statusChip(ck),
      when: timed ? `${ck.when}${ck.ad.notam ? ` · NOTAM ${ck.ad.notam}` : ''}` : null,
      timeNotSet: !timed,
      hours:
        h && info.ad
          ? {
              day: fmtAdDay(info.day),
              ad: day(info.ad),
              ats: day(info.ats),
              handling: day(info.handling),
              customs: h.customs ? (h.customs.parsed.partial ? h.customs.text : h.customs.parsed.label) : null,
              notams: info.notams.map((n) => ({ key: n.key, summary: n.summary, text: n.partial ? n.text : null })),
              source: h.source,
              // text the parser could not represent exactly: shown as printed
              aip: partial
                ? [
                    { label: 'AD', text: h.ad.text },
                    ...(h.ats ? [{ label: 'ATS', text: h.ats.text }] : []),
                    { label: 'Handling', text: h.handling.text },
                    ...(h.customs ? [{ label: 'Customs', text: h.customs.text }] : []),
                    ...(h.remarks ? [{ label: 'Remarks', text: h.remarks }] : []),
                  ]
                : [],
              notes: partial ? h.ad.parsed.notes : [],
            }
          : null,
    };
  });
  return { closed: items.filter((x) => x.closed).length, items };
}

function notamItem(n: Notam) {
  return {
    key: n.key,
    where: notamWhere(n),
    autorouter: onlyFromAutorouter(n),
    leg: n.legIndex !== null ? n.legIndex + 1 : null,
    subject: notamSubject(n),
    validity: notamValidity(n),
    limits: notamLimits(n),
    schedule: n.schedule ?? null,
    text: n.text,
    reasons: n.reasons,
    relevant: n.relevant,
    raw: n.raw,
    /** It has an area of its own the map can show. */
    area: hasNotamArea(n),
  };
}

function notamList(
  b: NotamBriefing | null,
  flight: BriefInput['flight'],
  ref: ReturnType<typeof refOf>,
  showAll: boolean,
) {
  if (!b) return null;
  // the departure and the destination always have their group, even with no NOTAM
  const route = flight.route;
  const icaoOf = (p: (typeof route)[number] | undefined) =>
    p?.kind === 'aerodrome' ? (ref.find(p.refId ?? p.name)?.icao ?? null) : null;
  const always = [icaoOf(route[0]), icaoOf(route[route.length - 1])].filter((x): x is string => !!x);
  const ok = b.status === 'ok';
  const src = notamSourcesLine(b);
  const count = b.notams.length;
  const meta = ok
    ? `${count} NOTAM${count === 1 ? '' : 's'}${src.from ? ` from ${src.from}` : ''}${src.failed.length ? ` (${src.failed.join(', ')})` : ''}, fetched ${b.fetched ? fmtClockMs(b.fetched, { z: true }) : ''} · below ${Math.round(b.params.maxAltFt)} ft, ${b.params.corridorNm} NM either side`
    : null;
  return {
    ok,
    message: b.message,
    meta,
    relevantCount: b.relevantCount,
    hiddenCount: b.hiddenCount,
    groups: ok
      ? groupNotams(visibleNotams(b, showAll), always).map((g) => ({
          icao: g.icao,
          name: g.icao ? (ref.find(g.icao)?.name ?? '') : '',
          notams: g.notams.map(notamItem),
        }))
      : [],
  };
}

const m = (x: number | null | undefined) => (x == null || !isFinite(x) ? '–' : `${Math.round(x)} m`);

function verdictLabel(v: PerfVerdictResult): string {
  return v.verdict === 'pass' ? 'Fits' : v.verdict === 'fail' ? 'No-go' : 'Check';
}

function endpoint(e: EndpointCalc, i: BriefInput, ref: ReturnType<typeof refOf>, dayMs: number) {
  const to = e.phase === 'takeoff';
  const ad = e.aerodrome;
  const options: Partial<FlightOptions> = i.flight.options ?? {};
  const stopKind = e.stopKind ?? 'stop';
  const stopReq = e.stopUid ? requestOf(options.aerodromeRequests, e.stopUid, stopKind) : undefined;
  const runwayValue = e.stopUid
    ? ((to ? stopReq?.takeoffRunway : stopReq?.landingRunway) ?? null)
    : ((to ? options.departureRunway : options.arrivalRunway) ?? null);
  const surfaceValue = e.stopUid
    ? (stopReq?.surface ?? null)
    : ((to ? options.departureSurface : options.arrivalSurface) ?? null);
  const aircraft = i.aircraft ?? null;
  const p = e.perf;
  const v = endpointVerdict(e, aircraft);
  const extrap = v.extrapolated ? 'extrapolated beyond the AFM table' : null;
  const showVerdict = !!(p || v.overMass);
  const runway = p?.runway?.designator ?? runwayValue;
  const dist = p?.distances
    ? `${to ? 'TODR/TODA' : 'LDR/LDA'} ${Math.round(p.distances.requiredTotalM)}/${p.availableTotalM != null ? Math.round(p.availableTotalM) : '–'} m`
    : null;
  const timeMin = fin(e.timeMs) && fin(dayMs) ? (e.timeMs - dayMs) / 60000 : NaN;
  const over = (req: number, avail: number | null): Tone | null =>
    avail != null && req > avail ? 'danger' : extrap ? 'warn' : null;
  const distances = !p?.distances
    ? []
    : to
      ? [
          {
            key: 'tor',
            label: 'TORR / TORA',
            text: `${m(p.distances.requiredGroundM)} / ${m(p.availableGroundM)}`,
            tone: over(p.distances.requiredGroundM, p.availableGroundM),
            sub: null,
          },
          {
            key: 'tod',
            label: 'TODR / TODA',
            text: `${m(p.distances.requiredTotalM)} / ${m(p.availableTotalM)}`,
            tone: over(p.distances.requiredTotalM, p.availableTotalM),
            sub: extrap,
          },
        ]
      : [
          {
            key: 'ld',
            label: 'LDR / LDA',
            text: `${m(p.distances.requiredTotalM)} / ${m(p.availableTotalM)}`,
            tone: over(p.distances.requiredTotalM, p.availableTotalM),
            sub: extrap,
          },
        ];
  return {
    tid: endpointTid(e),
    phase: e.phase,
    title: endpointTitle(e),
    stopUid: e.stopUid ?? null,
    stopKind: e.stopUid ? stopKind : null,
    aerodrome: !!ad,
    icao: ad?.icao ?? '',
    name: ad?.name ?? '',
    verdict: showVerdict ? v.verdict : null,
    verdictLabel: showVerdict ? verdictLabel(v) : null,
    verdictText: v.text,
    reason: showVerdict && v.verdict !== 'pass' ? reasonText(v) : null,
    summary: [showVerdict ? verdictLabel(v) : null, runway ? `RWY ${runway}` : null, dist].filter(Boolean).join(' · '),
    time: fin(timeMin) ? `${fmtClock(timeMin, { fallback: '--:--' })}Z` : null,
    conditions: e.surface ? (e.surface.source === 'metar' ? e.surface.label : 'forecast') : null,
    weather: weatherText(e),
    metar: e.reports?.metar?.raw ?? null,
    runway: runwayValue,
    runwayAuto: p?.runway && !runwayValue ? p.runway.designator : null,
    runways: ad
      ? ref.runwaysOf(ad.id).map((r) => ({
          value: r.designator,
          label: `${r.designator}${r.surface ? ` · ${r.surface}` : ''}`,
        }))
      : [],
    surface: surfaceValue,
    surfaces: Object.keys(aircraft?.performance?.factors.runwayCondition ?? {}),
    components: p
      ? {
          text: `${p.wind.headwindKt >= 0 ? 'H' : 'T'} ${Math.abs(p.wind.headwindKt).toFixed(0)} · X ${p.wind.crosswindKt.toFixed(0)}${p.wind.crossFrom}${p.crosswindGustKt != null ? ` G${p.crosswindGustKt.toFixed(0)}` : ''} kt`,
          sub: p.variableWind ? 'variable: full crosswind' : null,
          tone: !p.crosswindOk || p.tailwind ? 'danger' : null,
        }
      : null,
    paDa: p
      ? {
          text: `${Math.round(p.pressureAltFt)} / ${Math.round(p.densityAltFt)} ft`,
          sub: `ISA ${p.isaDevC >= 0 ? '+' : ''}${p.isaDevC.toFixed(0)}°C`,
        }
      : null,
    mass:
      p && e.massKg != null
        ? {
            text: `${e.massKg.toFixed(0)} kg`,
            sub: v.overMass
              ? `above ${v.overMass.limitName} ${v.overMass.limitKg} kg`
              : e.massSource === 'mtow'
                ? e.massReason === 'weight-missing'
                  ? 'MTOW (weight missing)'
                  : 'MTOW (no W&B)'
                : null,
            tone: v.overMass ? 'danger' : e.massReason === 'weight-missing' ? 'warn' : null,
          }
        : null,
    distances,
    noAircraft: !aircraft,
  };
}

function performance(c: Computed, i: BriefInput, ref: ReturnType<typeof refOf>) {
  const dayMs = c.times?.dayMs ?? NaN;
  const all = [c.departure, ...c.stops.flatMap((x) => [x.landing, x.takeoff]), c.arrival];
  const ends = [
    ...(c.departure.aerodrome ? [c.departure] : []),
    ...c.stops.flatMap((x) => (x.aerodrome ? [x.landing, x.takeoff] : [])),
    ...(c.arrival.aerodrome ? [c.arrival] : []),
  ];
  return {
    has: !!(c.departure.aerodrome || c.arrival.aerodrome),
    noGo: all.some((e) => e.aerodrome && endpointVerdict(e, i.aircraft ?? null).verdict === 'fail'),
    endpoints: ends.map((e) => endpoint(e, i, ref, dayMs ?? NaN)),
  };
}

/**
 * The Brief's sections from computeFlight's answer: `metar` (the METAR box: shown from 6 h before
 * take-off, its stations with a report), `aerodromes` (each aerodrome's status at the planned time and
 * its hours that day) and `performance` (each take-off and landing with its verdict, the runway and
 * surface choices and the figures) and `notams` (the briefing's list by group, as NotamSection).
 */
export function brief(input: Json<BriefInput>) {
  const i = arg(input);
  const ref = refOf(i.ref);
  const now = nowOf(i.now);
  const c = i.computed;
  return plain({
    metar: metarBox(c, i.flight, ref.bundle.aerodromes, now),
    aerodromes: aerodromeHours(c, i.flight, i.notams ?? null, now),
    performance: performance(c, i, ref),
    notams: notamList(i.notams ?? null, i.flight, ref, !!i.showAll),
  });
}
