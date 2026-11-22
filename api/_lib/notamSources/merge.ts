// Merging what several sources returned into one list of NOTAMs.
//
// Identity: series + number + year (A1234/26) of the same issuing office. The office is not always
// given, so two records with the same number are the same NOTAM when their Q-line FIRs agree, or,
// when either lacks a FIR, when their locations (item A + FIR) overlap.
// Of the records of one NOTAM, the most complete is kept (a start time, Q-line coordinates, the FIR,
// the Q code, items F/G, the ICAO text; ties: the source listed first in NOTAM_SOURCES), and what it
// lacks is filled in from the others.
// Replacement chains: a NOTAMR supersedes the NOTAM it names and a NOTAMC removes it (the NOTAMC itself
// stays, the briefing lists it as hidden), so A replaced by B replaced by C leaves only C.
import type { NotamSource, RawNotam } from './types.js';
import { notamKey } from './types.js';

export interface MergedNotam {
  notam: RawNotam;
  /** Every source that returned it, in priority order. */
  sources: NotamSource[];
}

const idOf = (n: RawNotam): string | null =>
  n.series && n.number !== null && n.year !== null
    ? notamKey({ series: n.series, number: n.number, year: n.year })
    : null;

const places = (n: RawNotam) => new Set([...n.itemA, ...(n.fir ? [n.fir] : [])]);

/** Two records of the same number are the same NOTAM (same office). */
function sameOffice(a: RawNotam, b: RawNotam): boolean {
  if (a.fir && b.fir) return a.fir === b.fir;
  const pa = places(a);
  const pb = places(b);
  // a record with no location at all is a number alone: trust it
  if (!pa.size || !pb.size) return true;
  for (const p of pa) if (pb.has(p)) return true;
  return false;
}

function score(n: RawNotam): number {
  return (
    (n.from !== null ? 64 : 0) +
    (n.center ? 32 : 0) +
    (n.fir ? 16 : 0) +
    (n.code23 && n.code45 ? 8 : 0) +
    (n.itemE ? 4 : 0) +
    (n.itemF || n.itemG ? 2 : 0) +
    (n.raw ? 1 : 0)
  );
}

/** The best record, with the fields it lacks taken from the others (best first). */
function combine(records: RawNotam[], rank: (s: NotamSource) => number): MergedNotam {
  const sorted = [...records].sort((a, b) => score(b) - score(a) || rank(a.source) - rank(b.source));
  const out: RawNotam = { ...sorted[0], itemA: [...sorted[0].itemA] };
  for (const r of sorted.slice(1)) {
    if (!out.center && r.center) [out.center, out.radiusNm] = [r.center, r.radiusNm];
    if (out.radiusNm === null && r.radiusNm !== null && out.center) out.radiusNm = r.radiusNm;
    for (const k of [
      'fir',
      'code23',
      'code45',
      'traffic',
      'purpose',
      'scope',
      'lowerFl',
      'upperFl',
      'itemD',
      'itemE',
      'itemF',
      'itemG',
      'raw',
    ] as const)
      if (out[k] === null && r[k] !== null) (out as unknown as Record<string, unknown>)[k] = r[k];
    if (out.from === null && r.from !== null) [out.from, out.to, out.estimated] = [r.from, r.to, r.estimated];
    if (out.type === 'N' && r.type !== 'N' && r.refers) [out.type, out.refers] = [r.type, r.refers];
    for (const a of r.itemA) if (!out.itemA.includes(a)) out.itemA.push(a);
  }
  const sources = [...new Set(sorted.map((r) => r.source))].sort((a, b) => rank(a) - rank(b));
  return { notam: out, sources };
}

/**
 * De-duplicates and resolves replacement chains. `priority`: the sources in NOTAM_SOURCES order
 * (earlier wins a tie). Records without a NOTAM number are kept as they are.
 */
export function mergeNotams(all: RawNotam[], priority: NotamSource[]): MergedNotam[] {
  const rank = (s: NotamSource) => {
    const i = priority.indexOf(s);
    return i < 0 ? priority.length : i;
  };
  const byId = new Map<string, RawNotam[][]>();
  const loose: MergedNotam[] = [];
  for (const n of all) {
    const id = idOf(n);
    if (!id) {
      loose.push({ notam: n, sources: [n.source] });
      continue;
    }
    const groups = byId.get(id) ?? [];
    const g = groups.find((grp) => grp.some((x) => sameOffice(x, n)));
    if (g) g.push(n);
    else groups.push([n]);
    byId.set(id, groups);
  }
  const merged = [...byId.values()].flat().map((g) => combine(g, rank));

  // superseded: named by a NOTAMR/C of the same office
  const gone = new Set<MergedNotam>();
  for (const m of merged) {
    const ref = m.notam.type !== 'N' ? m.notam.refers : null;
    if (!ref) continue;
    const target = notamKey(ref);
    for (const o of merged) if (o !== m && idOf(o.notam) === target && sameOffice(o.notam, m.notam)) gone.add(o);
  }
  return [...merged.filter((m) => !gone.has(m)), ...loose];
}
