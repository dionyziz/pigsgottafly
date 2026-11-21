// The W&B and performance sheets as WbPerfContent (src/shared/declarations.ts): what the export page
// draws (../wb/WbExport.tsx, ../performance/PerformanceExport.tsx), as printed text plus the chart
// and runway diagram geometry. The page draws its sheets from it and sends the same content to the
// aircraft's operator, which the server prints with the same sheets. Pure: built from the sheet models.
import {
  type PerfBlockContent,
  type WbPerfChart,
  type WbPerfContent,
  wbPerfContentOf,
  type WbPerfRow,
} from '../../../shared/declarations';
import type { PerfBlock, PerfSheetModel } from '../performance/model';
import { fmtArm, fmtCg, fmtKg, fmtMoment, type WbLine, type WbSheetModel } from '../wb/model';

function rows(l: WbLine): WbPerfRow[] {
  return [
    {
      kind: l.kind,
      key: l.key,
      label: l.label,
      note: l.note,
      mass: fmtKg(l.massKg),
      arm: l.kind === 'total' || l.kind === 'empty' ? fmtCg(l.armM) : fmtArm(l.armM),
      moment: fmtMoment(l.momentKgM),
      over: l.over,
      need: false,
    },
    ...l.people.map((p): WbPerfRow => ({
      kind: 'person',
      key: '',
      label: `${p.role} · ${p.name}`,
      note: p.seat,
      mass: p.massKg == null ? 'weight?' : fmtKg(p.massKg),
      arm: '',
      moment: '',
      over: false,
      need: p.massKg == null,
    })),
  ];
}

function block(b: PerfBlock): PerfBlockContent {
  return {
    phase: b.phase,
    title: b.title,
    aerodrome: b.aerodrome,
    time: b.time,
    rows: b.rows.map((r) => ({ key: r.key, label: r.label, value: r.value, note: r.note, status: r.status })),
    verdict: b.verdict,
    verdictText: b.verdictText,
    weather: b.weatherSource,
    metar: b.rawMetar,
    diagram: b.diagram && {
      runway: b.diagram.runway,
      reciprocal: b.diagram.reciprocal,
      runwayHdgMag: b.diagram.runwayHdgMag,
      windFromMag: b.diagram.windFromMag,
      headwindKt: b.diagram.headwindKt,
      crosswindKt: b.diagram.crosswindKt,
      crossFrom: b.diagram.crossFrom,
    },
  };
}

/** The chart points in the sheet's drawing order: zero fuel, landing, the stops, take-off (on top). */
function points(m: WbSheetModel): WbPerfChart['points'] {
  const to = m.checks.find((c) => c.phase === 'takeoff');
  const ldg = m.checks.find((c) => c.phase === 'landing');
  const out: WbPerfChart['points'] = [];
  if (m.zeroFuel && to)
    out.push({ key: 'zerofuel', label: 'ZFW', moment: m.zeroFuel.momentKgM, mass: m.zeroFuel.massKg, ok: null });
  if (ldg) out.push({ key: 'landing', label: 'LDG', moment: ldg.point.momentKgM, mass: ldg.point.massKg, ok: ldg.ok });
  m.checks
    .filter((c) => c.phase === 'stop')
    .forEach((c, i) =>
      out.push({
        key: `stop${i}`,
        label: c.label.replace(/^Stop /, ''),
        moment: c.point.momentKgM,
        mass: c.point.massKg,
        ok: c.ok,
      }),
    );
  if (to) out.push({ key: 'takeoff', label: 'T/O', moment: to.point.momentKgM, mass: to.point.massKg, ok: to.ok });
  return out;
}

const inside = (k: { inEnvelope: boolean; massOk: boolean }) => k.inEnvelope && k.massOk;

function wbPart(wb: WbSheetModel): WbPerfContent['wb'] {
  const stops = wb.checks.some((c) => c.phase === 'stop');
  return {
    verdict: wb.verdict,
    verdictText: wb.verdictText,
    rows: wb.lines.flatMap(rows),
    totals: wb.totals.flatMap(rows),
    checks: wb.checks.map((c) => ({
      phase: c.phase,
      label: c.label,
      ok: c.ok,
      text: `${fmtKg(c.point.massKg)} kg · CG ${fmtCg(c.point.armM)} m · ${fmtMoment(c.point.momentKgM)} kg·m`,
      categories: [
        { label: 'Normal', ok: inside(c.normal) },
        ...(c.utility ? [{ label: 'Utility', ok: inside(c.utility) }] : []),
      ],
    })),
    chart: {
      envelopes: wb.envelopes.map((e) => ({
        category: e.category,
        label: e.label,
        outline: e.outline,
        cgOutline: e.cgOutline,
      })),
      points: points(wb),
    },
    limits: wb.limits,
    weighing: wb.weighing,
    note: `Arm of a total = centre of gravity, m aft of the datum${wb.datum ? ` (${wb.datum.toLowerCase()})` : ''}. Take-off with the fuel on board at block start; landing after the taxi allowance and trip fuel${stops ? '; each stop: one more taxi allowance, no refuelling, the take-off there with the fuel it landed with' : ''}.`,
  };
}

function perfPart(perf: PerfSheetModel): WbPerfContent['perf'] {
  return {
    verdict: perf.verdict,
    verdictText: perf.verdictText,
    pages: perf.pages.map((pg) => ({
      label: pg.label,
      takeoff: block(pg.takeoff),
      landing: block(pg.landing),
      stall: { vsKt: pg.speeds.vsKt, vsoKt: pg.speeds.vsoKt },
      speedsSource: pg.speeds.source,
    })),
    factors: perf.conditionTable,
    slopeRule: perf.slopeRule,
    crosswind: perf.crosswindLimits,
    notes: perf.conditionNotes,
  };
}

/** The sheets as drawn and sent (normalized as the server takes them). A sheet left out (null) is empty. */
export function wbPerfContent(wb: WbSheetModel | null, perf: PerfSheetModel | null): WbPerfContent {
  const head = wb ?? perf;
  return wbPerfContentOf({
    registration: head?.registration,
    makeModel: head?.makeModel,
    operator: wb?.operator,
    date: head?.date,
    pilot: head?.pilot,
    route: wb?.route,
    category: wb?.categoryLabel,
    wb: wb && wbPart(wb),
    perf: perf && perfPart(perf),
  });
}

/** SHA-256 (base64url) of wbPerfText(content), as the server records a sent version. */
export async function sha256Url(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  let s = '';
  for (const b of d) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
