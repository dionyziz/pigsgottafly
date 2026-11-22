// A NOTAM in ICAO format (Annex 15 / Doc 8126) read into RawNotam fields:
//   A1234/26 NOTAMR A1200/26
//   Q) LGGG/QRTCA/IV/BO/W/000/050/3802N02334E003
//   A) LGGG B) 2611230600 C) 2611231800 EST
//   D) …  E) …  F) SFC G) 5000FT AMSL
// For sources that give the text but not (all of) its fields. Lenient: what does not read stays null.
import { parseNotamId, type RawNotam } from './types.js';

type Parsed = Partial<Omit<RawNotam, 'source' | 'sourceId'>>;

const ITEMS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const;

/** YYMMDDHHMM (UTC) → epoch ms. */
export function icaoTime(s: string | null | undefined): number | null {
  const m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(s ?? '').trim());
  if (!m) return null;
  const t = Date.UTC(2000 + +m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return Number.isFinite(t) && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31 ? t : null;
}

/** Q-line position: DDMM[N|S]DDDMM[E|W]RRR. */
function qPosition(s: string): { center: { lat: number; lon: number } | null; radiusNm: number | null } {
  const m = /^(\d{2})(\d{2})([NS])(\d{3})(\d{2})([EW])(\d{3})?$/.exec(s.trim());
  if (!m) return { center: null, radiusNm: null };
  const lat = (+m[1] + +m[2] / 60) * (m[3] === 'S' ? -1 : 1);
  const lon = (+m[4] + +m[5] / 60) * (m[6] === 'W' ? -1 : 1);
  return { center: { lat: +lat.toFixed(5), lon: +lon.toFixed(5) }, radiusNm: m[7] ? +m[7] : null };
}

type Item = (typeof ITEMS)[number];

function marker(text: string, k: Item, from: number, to: number, last: boolean): RegExpExecArray | null {
  const re = new RegExp(`(^|[\\s(])${k}\\)\\s*`, 'g');
  re.lastIndex = from;
  let hit: RegExpExecArray | null = null;
  for (let m = re.exec(text); m && m.index < to; m = re.exec(text)) {
    hit = m;
    if (!last) break;
  }
  return hit;
}

/**
 * Each item's text. Item E is free text that may quote other markers, so A) … D) are looked for
 * before E's marker, and F) and G) as the last markers after it.
 */
function itemSpans(text: string): Partial<Record<Item, string>> {
  const e = marker(text, 'E', 0, text.length, false);
  const eAt = e ? e.index : text.length;
  const at: { k: Item; start: number; body: number }[] = [];
  let pos = 0;
  for (const k of ITEMS) {
    const hit =
      k === 'E'
        ? e
        : k === 'F' || k === 'G'
          ? marker(text, k, Math.max(pos, eAt), text.length, true)
          : marker(text, k, pos, eAt, false);
    if (!hit) continue;
    at.push({ k, start: hit.index + hit[1].length, body: hit.index + hit[0].length });
    pos = hit.index + hit[0].length;
  }
  const out: Partial<Record<Item, string>> = {};
  at.forEach((a, i) => {
    const end = i + 1 < at.length ? at[i + 1].start : text.length;
    out[a.k] = text
      .slice(a.body, end)
      .replace(/\)\s*$/, '')
      .trim();
  });
  return out;
}

/** The fields an ICAO-format NOTAM states; {} when it is not one. */
export function parseIcaoNotam(text: string | null | undefined): Parsed {
  const t = String(text ?? '')
    .replace(/\r/g, '')
    .trim();
  if (!t) return {};
  const out: Parsed = {};
  const head = /([A-Z])\s?(\d{1,5})\/(\d{2})\s+NOTAM([NRC])(?:\s+([A-Z]\s?\d{1,5}\/\d{2}))?/.exec(t);
  if (head) {
    out.series = head[1];
    out.number = +head[2];
    out.year = +head[3];
    out.type = head[4] as 'N' | 'R' | 'C';
    out.refers = head[5] ? parseNotamId(head[5]) : null;
  }
  const q = /Q\)\s*([^\n]*?)(?=\s+A\)|\n|$)/.exec(t);
  if (q) {
    const f = q[1].split('/').map((x) => x.trim());
    if (/^[A-Z]{4}$/.test(f[0] ?? '')) out.fir = f[0];
    const code = /^Q([A-Z]{2})([A-Z]{2})$/.exec(f[1] ?? '');
    if (code) [out.code23, out.code45] = [code[1], code[2]];
    if (f[2]) out.traffic = f[2];
    if (f[3]) out.purpose = f[3];
    if (f[4]) out.scope = f[4];
    if (/^\d{3}$/.test(f[5] ?? '')) out.lowerFl = +f[5];
    if (/^\d{3}$/.test(f[6] ?? '')) out.upperFl = +f[6];
    if (f[7]) Object.assign(out, qPosition(f[7]));
  }
  const items = itemSpans(t.slice(q ? q.index + q[0].length : 0));
  // a multi-part NOTAM writes 'PART 1 OF 4' after the locations
  if (items.A)
    out.itemA = items.A.replace(/\bPART\s+\d+\s+OF\s+\d+\b/g, ' ')
      .split(/\s+/)
      .filter((x) => /^[A-Z]{4}$/.test(x));
  if (items.B) out.from = icaoTime(items.B.slice(0, 10));
  if (items.C) {
    const c = items.C.toUpperCase();
    out.to = /^PERM/.test(c) ? null : icaoTime(c.slice(0, 10));
    out.estimated = /EST/.test(c);
  }
  if (items.D) out.itemD = items.D;
  if (items.E) out.itemE = items.E;
  if (items.F) out.itemF = items.F;
  if (items.G) out.itemG = items.G;
  return out;
}
