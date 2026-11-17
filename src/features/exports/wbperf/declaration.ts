// The W&B and performance sheets as WbPerfContent (src/shared/declarations.ts): what the export page
// shows, as printed text plus the chart geometry, for the server to render to PDF and e-mail to the
// aircraft's operator. Pure: built from the sheet models.
import {
  type PerfBlockContent,
  type WbPerfContent,
  wbPerfContentOf,
  type WbPerfRow,
} from '../../../shared/declarations';
import type { PerfBlock, PerfSheetModel } from '../performance/model';
import { fmtArm, fmtCg, fmtKg, fmtMoment, type WbLine, type WbSheetModel } from '../wb/model';

function rows(l: WbLine): WbPerfRow[] {
  const arm = l.kind === 'total' || l.kind === 'empty' ? fmtCg(l.armM) : fmtArm(l.armM);
  const kind = l.kind === 'total' ? 'total' : l.kind === 'burn' ? 'burn' : 'line';
  return [
    { kind, label: l.label, note: l.note, mass: fmtKg(l.massKg), arm, moment: fmtMoment(l.momentKgM), over: l.over },
    ...l.people.map((p): WbPerfRow => ({
      kind: 'person',
      label: `${p.role} · ${p.name}`,
      note: p.seat,
      mass: p.massKg == null ? 'weight?' : fmtKg(p.massKg),
      arm: '',
      moment: '',
      over: false,
    })),
  ];
}

const tick = (ok: boolean) => (ok ? 'within' : 'OUTSIDE');

function block(b: PerfBlock): PerfBlockContent {
  return {
    title: b.title,
    aerodrome: b.aerodrome,
    time: b.time,
    rows: b.rows.map((r) => ({ label: r.label, value: r.value, note: r.note, status: r.status })),
    verdict: b.verdict,
    verdictText: b.verdictText,
    weather: b.weatherSource,
    metar: b.rawMetar,
  };
}

/** The chart points as the sheet draws them, in flight order: zero fuel, take-off, stops, landing. */
function points(m: WbSheetModel): WbPerfContent['wb']['chart']['points'] {
  const to = m.checks.find((c) => c.phase === 'takeoff');
  const ldg = m.checks.find((c) => c.phase === 'landing');
  const out: WbPerfContent['wb']['chart']['points'] = [];
  if (m.zeroFuel && to) out.push({ label: 'ZFW', moment: m.zeroFuel.momentKgM, mass: m.zeroFuel.massKg, ok: null });
  if (to) out.push({ label: 'T/O', moment: to.point.momentKgM, mass: to.point.massKg, ok: to.ok });
  m.checks
    .filter((c) => c.phase === 'stop')
    .forEach((c) =>
      out.push({ label: c.label.replace(/^Stop /, ''), moment: c.point.momentKgM, mass: c.point.massKg, ok: c.ok }),
    );
  if (ldg) out.push({ label: 'LDG', moment: ldg.point.momentKgM, mass: ldg.point.massKg, ok: ldg.ok });
  return out;
}

export function wbPerfContent(wb: WbSheetModel, perf: PerfSheetModel): WbPerfContent {
  const stops = wb.checks.some((c) => c.phase === 'stop');
  return wbPerfContentOf({
    registration: wb.registration,
    makeModel: wb.makeModel,
    operator: wb.operator,
    date: wb.date,
    pilot: wb.pilot,
    route: wb.route,
    category: wb.categoryLabel,
    wb: {
      verdict: wb.verdict,
      verdictText: wb.verdictText,
      rows: wb.lines.flatMap(rows),
      totals: wb.totals.flatMap(rows),
      checks: wb.checks.map((c) => ({
        label: c.label,
        ok: c.ok,
        text: `${fmtKg(c.point.massKg)} kg · CG ${fmtCg(c.point.armM)} m · ${fmtMoment(c.point.momentKgM)} kg·m`,
        categories: [
          `Normal: ${tick(c.normal.inEnvelope && c.normal.massOk)}`,
          ...(c.utility ? [`Utility: ${tick(c.utility.inEnvelope && c.utility.massOk)}`] : []),
        ].join(' · '),
      })),
      chart: {
        envelopes: wb.envelopes.map((e) => ({ label: e.label, outline: e.outline, cgOutline: e.cgOutline })),
        points: points(wb),
      },
      limits: wb.limits,
      weighing: wb.weighing,
      note: `Arm of a total = centre of gravity, m aft of the datum${wb.datum ? ` (${wb.datum.toLowerCase()})` : ''}. Take-off with the fuel on board at block start; landing after the taxi allowance and trip fuel${stops ? '; each stop: one more taxi allowance, no refuelling' : ''}.`,
    },
    perf: {
      verdict: perf.verdict,
      verdictText: perf.verdictText,
      pages: perf.pages.map((pg) => ({
        label: pg.label,
        takeoff: block(pg.takeoff),
        landing: block(pg.landing),
        speeds: [
          pg.speeds.vsKt != null || pg.speeds.vsoKt != null
            ? `Stall IAS (power off, wings level, MTOW): flaps up ${pg.speeds.vsKt ?? '–'} kt, landing flaps ${pg.speeds.vsoKt ?? '–'} kt.`
            : '',
          perf.crosswindLimits.takeoff != null || perf.crosswindLimits.landing != null
            ? `Crosswind limits: take-off ${perf.crosswindLimits.takeoff ?? '–'} kt, landing ${perf.crosswindLimits.landing ?? '–'} kt.`
            : '',
        ]
          .filter(Boolean)
          .join(' '),
      })),
      factors: perf.conditionTable,
      slopeRule: perf.slopeRule,
      notes: [
        ...perf.conditionNotes,
        'Distances: AFM tables at the density altitude, interpolated in mass; headwind −10 % per 5 kt, tailwind +10 % per 2 kt; then × condition × safety factor. Required distances rounded up to the metre.',
      ],
    },
  });
}

/** SHA-256 (base64url) of wbPerfText(content), as the server records a sent version. */
export async function sha256Url(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  let s = '';
  for (const b of d) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
