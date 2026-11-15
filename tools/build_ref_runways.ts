// Runway reference data: joins what tools/parse_runways.py extracted from the eAIP (tools/runways.json:
// AD 2.12/2.13 and AD 1.6.N.12/13, as printed) onto the runway directions listed for each aerodrome in
// data/aip.js, and derives the few values the AIP leaves out, saying so in each record:
//
//  - headingTrueDeg: AIP TRUE BRG; if not published, the great-circle course from this threshold to the
//    opposite one when both threshold coordinates are published (headingTrueSource).
//  - headingMagDeg: true heading minus the aerodrome's published MAG VAR projected to the AIRAC date with its
//    published annual change; if the aerodrome publishes none (most CAT B), the nearest aerodrome's;
//    designator × 10 when the true heading is unknown (headingMagSource). The Greek AIP prints no MAG BRG.
//  - slopePct (+ = uphill in this direction): the AIP RWY-SWY slope when it is a single signed value; when the
//    AIP prints the same unsigned value for both directions the sign comes from the threshold elevations
//    (or the value is dropped if there are none); multi-segment slopes and NIL are replaced by the average
//    slope between the published threshold elevations (slopeSource).
//  - thresholdElevFt: AIP THR elevation, else the aerodrome elevation (thresholdElevSource).
//
// Nothing else is filled in: an unpublished value stays null and is listed in `gaps`.
import fs from 'node:fs';
import path from 'node:path';
import type { RefAerodrome, RefRunway } from '../src/shared/ref.js';
import { distanceNm, trueCourse, norm360 } from '../src/calc/nav.js';

export type { RefRunwayIntersection, RefRunwayDetail } from '../src/shared/ref.js';
import type { RefRunwayDetail, RefRunwayIntersection } from '../src/shared/ref.js';
/** A runway record as generated: every detail field present. */
export type RefRunwayFull = RefRunway & RefRunwayDetail;

interface Parsed {
  trueBrg: number | null; lengthM: number | null; widthM: number | null; thr: [number, number] | null;
  thrElevFt: number | null; surface: string | null; surfaceText: string | null; strength: string | null;
  slopeText: string | null; slopePct: number | null; toraM: number | null; todaM: number | null; asdaM: number | null;
  ldaM: number | null; declaredRemark: string | null; intersections?: RefRunwayIntersection[];
}
interface ParsedAd {
  file: string; magVar: { deg: number; year: number | null; annualDeg: number | null } | null; magVarText: string | null;
  ref12: string; ref13: string; runways: Record<string, Parsed>;
}
interface ParsedDoc {
  corrections: { source: string; designator: string; field: string; printed: unknown; used: unknown; why: string }[];
  aerodromes: Record<string, ParsedAd>;
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;
const M_PER_NM = 1852;
const FT = 0.3048;

function decimalYear(iso: string): number {
  const d = new Date(iso + 'T00:00:00Z'), y = d.getUTCFullYear();
  return y + (d.getTime() - Date.UTC(y, 0, 1)) / (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1));
}

/** The aerodrome's published variation at `year`, or null if none is usable (no epoch / no annual change and older than 5 years). */
function projectedVar(ad: ParsedAd | undefined, year: number): number | null {
  const v = ad?.magVar;
  if (!v || v.year === null) return null;
  if (v.annualDeg === null && year - v.year > 5) return null;
  return v.deg + (v.annualDeg ?? 0) * (year - (v.year + 0.0)); // epochs are printed as JAN YYYY (or the year alone)
}

export function loadParsedRunways(root: string): ParsedDoc {
  return JSON.parse(fs.readFileSync(path.join(root, 'tools', 'runways.json'), 'utf8'));
}

/** One record per runway direction of each aerodrome's `runways` pairs, in the same order as before. */
export function buildRunways(aerodromes: RefAerodrome[], parsed: ParsedDoc, effective: string): { runways: RefRunwayFull[]; warnings: string[] } {
  const year = decimalYear(effective);
  const warnings: string[] = [];
  const usableVar = aerodromes
    .map((a) => ({ a, v: projectedVar(parsed.aerodromes[a.source], year) }))
    .filter((x): x is { a: RefAerodrome; v: number } => x.v !== null);
  const runways: RefRunwayFull[] = [];

  for (const a of aerodromes) {
    const pad = parsed.aerodromes[a.source];
    const listed = new Set(a.runways.flatMap((p) => p.split('/').map((s) => s.trim())));
    // water aerodromes (seaplane lanes) have no runways in data/aip.js and none here
    if (pad && !a.water) for (const d of Object.keys(pad.runways)) if (!listed.has(d)) warnings.push(`${a.id}: ${a.source} has RWY ${d}, not in data/aip.js runways`);
    if (!pad && a.runways.length) warnings.push(`${a.id}: no AIP runway text for ${a.source}`);

    let varHere = projectedVar(pad, year);
    let varSource: RefRunwayDetail['headingMagSource'] = 'true-minus-aip-var';
    let varRef: string | null = pad?.magVar ? `${a.source} item 5 MAG VAR: ${pad.magVarText}` : null;
    if (varHere === null && usableVar.length) {
      const near = usableVar.reduce((b, x) => (distanceNm(a, x.a) < distanceNm(a, b.a) ? x : b));
      varHere = near.v;
      varSource = 'true-minus-nearby-aip-var';
      varRef = `${near.a.source} item 5 MAG VAR (nearest aerodrome publishing one, ${Math.round(distanceNm(a, near.a))} NM): ${parsed.aerodromes[near.a.source].magVarText}`;
    }

    for (const pair of a.runways) {
      const ends = pair.split('/').map((s) => s.trim());
      if (ends.length !== 2) continue;
      ends.forEach((d, i) => {
        const rec = ends[1 - i];
        const p = pad?.runways[d];
        const q = pad?.runways[rec];
        const gaps: string[] = [];
        const n = parseInt(d, 10);

        // true heading
        let headingTrueDeg: number | null = p?.trueBrg ?? null;
        let headingTrueSource: RefRunwayDetail['headingTrueSource'] = headingTrueDeg !== null ? 'aip' : null;
        if (headingTrueDeg === null) {
          gaps.push('true bearing');
          if (p?.thr && q?.thr) {
            headingTrueDeg = r2(trueCourse({ lat: p.thr[0], lon: p.thr[1] }, { lat: q.thr[0], lon: q.thr[1] }));
            headingTrueSource = 'thr-coordinates';
          }
        }
        const notes: string[] = [];
        if (headingTrueSource === 'aip' && p?.thr && q?.thr) {
          const c = trueCourse({ lat: p.thr[0], lon: p.thr[1] }, { lat: q.thr[0], lon: q.thr[1] });
          const diff = Math.abs(((c - headingTrueDeg! + 540) % 360) - 180);
          if (diff > 1) notes.push(`TRUE BRG ${p.trueBrg}° differs by ${r1(diff)}° from the course between the published thresholds (${r1(c)}°)`);
        }
        // magnetic heading
        let headingMagDeg = n * 10;
        let headingMagSource: RefRunwayDetail['headingMagSource'] = 'designator';
        if (headingTrueDeg !== null && varHere !== null) {
          headingMagDeg = r1(norm360(headingTrueDeg - varHere));
          headingMagSource = varSource;
        }
        // threshold
        const thrElev = p?.thrElevFt ?? null;
        if (thrElev === null) gaps.push('threshold elevation');
        if (!p?.thr) gaps.push('threshold coordinates');
        // slope
        let slopePct: number | null = null;
        let slopeSource: RefRunwayDetail['slopeSource'] = null;
        const thrSlope = p?.thr && q?.thr && thrElev !== null && q.thrElevFt !== null
          ? ((q.thrElevFt - thrElev) * FT) / (distanceNm({ lat: p.thr[0], lon: p.thr[1] }, { lat: q.thr[0], lon: q.thr[1] }) * M_PER_NM) * 100
          : null;
        const pub = p?.slopePct ?? null, pubRec = q?.slopePct ?? null;
        if (pub !== null) {
          const ambiguous = pub !== 0 && pubRec !== null && Math.sign(pub) === Math.sign(pubRec);
          if (!ambiguous) { slopePct = pub; slopeSource = 'aip'; }
          else if (thrSlope !== null) { slopePct = Math.abs(pub) * Math.sign(thrSlope); slopeSource = 'aip-magnitude-thr-sign'; }
          else warnings.push(`${a.id} ${d}: slope ${p!.slopeText} printed with the same sign both ways and no THR elevations; left null`);
        }
        if (slopeSource === null) {
          gaps.push('slope');
          if (thrSlope !== null) { slopePct = r2(thrSlope); slopeSource = 'thr-elevations'; }
        }
        // physical + declared
        if (p?.lengthM == null) gaps.push('length');
        if (p?.widthM == null) gaps.push('width');
        if (p?.surface == null) gaps.push('surface');
        for (const [k, label] of [['toraM', 'TORA'], ['todaM', 'TODA'], ['asdaM', 'ASDA'], ['ldaM', 'LDA']] as const) if (p?.[k] == null) gaps.push(label);

        const corrections = parsed.corrections
          .filter((c) => c.source === a.source && c.designator === d)
          .map((c) => `${c.field}: printed ${c.printed}, used ${c.used} (${c.why})`);

        runways.push({
          aerodromeId: a.id, designator: d, reciprocal: rec, headingMagDeg, headingTrueDeg,
          lengthM: p?.lengthM ?? null, widthM: p?.widthM ?? null, surface: p?.surface ?? null,
          toraM: p?.toraM ?? null, todaM: p?.todaM ?? null, asdaM: p?.asdaM ?? null, ldaM: p?.ldaM ?? null,
          slopePct, thresholdElevFt: thrElev ?? a.elevFt,
          thrLat: p?.thr?.[0] ?? null, thrLon: p?.thr?.[1] ?? null, headingTrueSource,
          magVarDeg: headingMagSource === 'designator' || varHere === null ? null : r2(varHere), headingMagSource,
          slopeText: p?.slopeText ?? null, slopeSource,
          thresholdElevSource: thrElev !== null ? 'aip' : a.elevFt !== null ? 'aerodrome-elevation' : null,
          surfaceText: p?.surfaceText ?? null, strength: p?.strength ?? null, declaredRemark: p?.declaredRemark ?? null,
          intersections: p?.intersections ?? [],
          source: { physical: pad?.ref12 ?? null, declared: pad?.ref13 ?? null, magVar: headingMagSource === 'designator' ? null : varRef },
          gaps, notes, corrections,
        });
      });
    }
  }
  return { runways, warnings };
}
