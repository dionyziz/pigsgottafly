// A small PDF 1.4 writer for the forms the server e-mails to HCAA (Form 731, General Declaration):
// A4 pages with text (optionally rotated), lines and rectangles; Helvetica, Helvetica-Bold and
// Helvetica-Oblique, WinAnsiEncoding) and one embedded TrueType font (the handwriting signatures). Streams are
// Flate-compressed. Text is WinAnsi: Greek is transliterated (ELOT 743) before it is written.
//
// (PLAN-v3 names pdf-lib; this writer covers the little the two forms need without adding a
// dependency. Coordinates are in millimetres from the TOP-LEFT corner, like the CSS of the print
// sheets they mirror.)
import zlib from 'node:zlib';

import { transliterate } from '../../src/shared/translit.js';

export const MM = 72 / 25.4;
export const A4 = { w: 210, h: 297 };

export type FontName = 'regular' | 'bold' | 'italic' | 'hand';

/** Glyph widths (1/1000 em) of Helvetica and Helvetica-Bold for WinAnsi 32..126 (Adobe AFM). */
const HELV: number[] = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833,
  722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556,
  556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334,
  260, 334, 584,
];
const HELV_B: number[] = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833,
  722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611,
  556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389,
  280, 389, 584,
];

// ------------------------------------------------------------------------------------------------
// TrueType: just enough to embed a font as a simple (WinAnsi) font: metrics and per-code widths.

interface TtfInfo {
  unitsPerEm: number;
  ascent: number;
  descent: number;
  capHeight: number;
  bbox: [number, number, number, number];
  widths: number[]; /* 32..255 in 1/1000 em */
}

const WIN_ANSI_HIGH: Record<number, number> = {
  0x80: 0x20ac,
  0x82: 0x201a,
  0x83: 0x0192,
  0x84: 0x201e,
  0x85: 0x2026,
  0x86: 0x2020,
  0x87: 0x2021,
  0x88: 0x02c6,
  0x89: 0x2030,
  0x8a: 0x0160,
  0x8b: 0x2039,
  0x8c: 0x0152,
  0x8e: 0x017d,
  0x91: 0x2018,
  0x92: 0x2019,
  0x93: 0x201c,
  0x94: 0x201d,
  0x95: 0x2022,
  0x96: 0x2013,
  0x97: 0x2014,
  0x98: 0x02dc,
  0x99: 0x2122,
  0x9a: 0x0161,
  0x9b: 0x203a,
  0x9c: 0x0153,
  0x9e: 0x017e,
  0x9f: 0x0178,
};
const UNI_TO_WIN = new Map<number, number>(Object.entries(WIN_ANSI_HIGH).map(([k, v]) => [v, Number(k)]));
const winToUni = (c: number) => WIN_ANSI_HIGH[c] ?? c;

export function parseTtf(buf: Buffer): TtfInfo {
  const numTables = buf.readUInt16BE(4);
  const tables: Record<string, number> = {};
  for (let i = 0; i < numTables; i++) {
    const o = 12 + 16 * i;
    tables[buf.toString('latin1', o, o + 4)] = buf.readUInt32BE(o + 8);
  }
  const head = tables.head,
    hhea = tables.hhea,
    hmtx = tables.hmtx,
    cmap = tables.cmap;
  if (head == null || hhea == null || hmtx == null || cmap == null) throw new Error('not a TrueType font');
  const upem = buf.readUInt16BE(head + 18);
  const bbox: [number, number, number, number] = [
    buf.readInt16BE(head + 36),
    buf.readInt16BE(head + 38),
    buf.readInt16BE(head + 40),
    buf.readInt16BE(head + 42),
  ];
  const ascent = buf.readInt16BE(hhea + 4),
    descent = buf.readInt16BE(hhea + 6);
  const nHMetrics = buf.readUInt16BE(hhea + 34);
  const advance = (g: number) => buf.readUInt16BE(hmtx + 4 * Math.min(g, nHMetrics - 1));
  // cmap: the (3,1) format 4 subtable.
  const nSub = buf.readUInt16BE(cmap + 2);
  let sub = -1;
  for (let i = 0; i < nSub; i++) {
    const pid = buf.readUInt16BE(cmap + 4 + 8 * i),
      eid = buf.readUInt16BE(cmap + 6 + 8 * i);
    const off = cmap + buf.readUInt32BE(cmap + 8 + 8 * i);
    if (pid === 3 && (eid === 1 || eid === 0) && buf.readUInt16BE(off) === 4) {
      sub = off;
      break;
    }
  }
  const glyphOf = (u: number): number => {
    if (sub < 0) return 0;
    const segX2 = buf.readUInt16BE(sub + 6);
    const ends = sub + 14,
      starts = ends + segX2 + 2,
      deltas = starts + segX2,
      ranges = deltas + segX2;
    for (let s = 0; s < segX2 / 2; s++) {
      const end = buf.readUInt16BE(ends + 2 * s);
      if (u > end) continue;
      const start = buf.readUInt16BE(starts + 2 * s);
      if (u < start) return 0;
      const delta = buf.readInt16BE(deltas + 2 * s);
      const ro = buf.readUInt16BE(ranges + 2 * s);
      if (!ro) return (u + delta) & 0xffff;
      const g = buf.readUInt16BE(ranges + 2 * s + ro + 2 * (u - start));
      return g ? (g + delta) & 0xffff : 0;
    }
    return 0;
  };
  const widths: number[] = [];
  for (let c = 32; c <= 255; c++) widths.push(Math.round((advance(glyphOf(winToUni(c))) * 1000) / upem));
  const os2 = tables['OS/2'];
  const capHeight = os2 != null && buf.readUInt16BE(os2) >= 2 ? buf.readInt16BE(os2 + 88) : ascent;
  const k = 1000 / upem;
  return {
    unitsPerEm: upem,
    ascent: Math.round(ascent * k),
    descent: Math.round(descent * k),
    capHeight: Math.round(capHeight * k),
    bbox: bbox.map((x) => Math.round(x * k)) as TtfInfo['bbox'],
    widths,
  };
}

// ------------------------------------------------------------------------------------------------

/** Text → WinAnsi bytes: Greek transliterated (keeping case), anything else unencodable → '?'. */
export function winAnsi(s: string): Buffer {
  // signs WinAnsi lacks, spelled out (≤ in the W&B limits, − in signed numbers, → in routes)
  const t = transliterate(s, { keepCase: true })
    .normalize('NFC')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/−/g, '-')
    .replace(/→/g, '->');
  const out: number[] = [];
  for (const ch of t) {
    const u = ch.codePointAt(0)!;
    if (u >= 32 && u < 127) out.push(u);
    else if (u >= 0xa0 && u <= 0xff) out.push(u);
    else if (UNI_TO_WIN.has(u)) out.push(UNI_TO_WIN.get(u)!);
    else if (u === 0x2022 || u === 0x2026) out.push(UNI_TO_WIN.get(u)!);
    else {
      const plain = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      const p = plain.codePointAt(0)!;
      out.push(plain.length === 1 && p >= 32 && p < 127 ? p : 63);
    }
  }
  return Buffer.from(out);
}

const pdfString = (b: Buffer) => {
  let s = '(';
  for (const c of b) {
    if (c === 0x28 || c === 0x29 || c === 0x5c) s += '\\' + String.fromCharCode(c);
    else if (c < 32 || c > 126) s += '\\' + c.toString(8).padStart(3, '0');
    else s += String.fromCharCode(c);
  }
  return s + ')';
};
const n = (x: number) => (Math.round(x * 100) / 100).toString();

export interface TextOpts {
  size?: number;
  font?: FontName;
  align?: 'left' | 'center' | 'right';
  /** shrink to fit this width (mm) */ maxW?: number;
  /** Degrees counter-clockwise about (x, y); alignment is along the rotated baseline. */
  rotate?: number;
}

export class PdfPage {
  ops: string[] = [];
  constructor(
    public w: number,
    public h: number,
    private doc: PdfDoc,
  ) {}
  private y(mm: number) {
    return (this.h - mm) * MM;
  }
  /** Text with its BASELINE at (x, y) mm from the top-left. */
  text(x: number, y: number, s: string, o: TextOpts = {}): void {
    if (!s) return;
    const font = o.font ?? 'regular';
    let size = o.size ?? 10;
    const bytes = winAnsi(s);
    let w = this.doc.widthMm(bytes, font, size);
    if (o.maxW && w > o.maxW) {
      size = Math.max(4, (size * o.maxW) / w);
      w = this.doc.widthMm(bytes, font, size);
    }
    const dx = o.align === 'center' ? -w / 2 : o.align === 'right' ? -w : 0;
    const f = font === 'bold' ? 'F2' : font === 'hand' ? 'F3' : font === 'italic' ? 'F4' : 'F1';
    if (o.rotate) {
      const a = (o.rotate * Math.PI) / 180,
        c = Math.cos(a),
        s = Math.sin(a);
      // the start of the (aligned) text, rotated about (x, y); y grows downwards on the page
      const tx = x + dx * c,
        ty = y - dx * s;
      this.ops.push(
        `BT /${f} ${n(size)} Tf ${c.toFixed(4)} ${s.toFixed(4)} ${(-s).toFixed(4)} ${c.toFixed(4)} ${n(tx * MM)} ${n(this.y(ty))} Tm ${pdfString(bytes)} Tj ET`,
      );
      return;
    }
    this.ops.push(`BT /${f} ${n(size)} Tf ${n((x + dx) * MM)} ${n(this.y(y))} Td ${pdfString(bytes)} Tj ET`);
  }
  line(x1: number, y1: number, x2: number, y2: number, width = 0.2): void {
    this.ops.push(`${n(width * MM)} w ${n(x1 * MM)} ${n(this.y(y1))} m ${n(x2 * MM)} ${n(this.y(y2))} l S`);
  }
  rect(x: number, y: number, w: number, h: number, width = 0.2): void {
    this.ops.push(`${n(width * MM)} w ${n(x * MM)} ${n(this.y(y + h))} ${n(w * MM)} ${n(h * MM)} re S`);
  }
  /** Ink colour for what follows (0..1 RGB). */
  color(r: number, g: number, b: number): void {
    this.ops.push(`${n(r)} ${n(g)} ${n(b)} rg ${n(r)} ${n(g)} ${n(b)} RG`);
  }
}

export class PdfDoc {
  pages: PdfPage[] = [];
  private hand: { info: TtfInfo; data: Buffer } | null = null;
  constructor(handTtf?: Buffer) {
    if (handTtf) this.hand = { info: parseTtf(handTtf), data: handTtf };
  }
  page(landscape = false): PdfPage {
    const p = landscape ? new PdfPage(A4.h, A4.w, this) : new PdfPage(A4.w, A4.h, this);
    this.pages.push(p);
    return p;
  }
  widthMm(bytes: Buffer, font: FontName, size: number): number {
    let w = 0;
    for (const c of bytes) {
      if (font === 'hand' && this.hand) w += this.hand.info.widths[c - 32] ?? 500;
      else w += (font === 'bold' ? HELV_B : HELV)[c - 32] ?? 556;
    }
    return ((w / 1000) * size) / MM;
  }
  bytes(meta: { title?: string } = {}): Buffer {
    const objs: Buffer[] = [];
    const add = (b: Buffer | string) => {
      objs.push(Buffer.isBuffer(b) ? b : Buffer.from(b, 'latin1'));
      return objs.length;
    };
    const stream = (dict: string, data: Buffer) => {
      const z = zlib.deflateSync(data);
      return Buffer.concat([
        Buffer.from(`<< ${dict} /Length ${z.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'),
        z,
        Buffer.from('\nendstream', 'latin1'),
      ]);
    };
    const catalog = add(''); // placeholder, filled below
    const pagesId = add('');
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const f4 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>');
    let f3 = 0;
    if (this.hand) {
      const { info, data } = this.hand;
      const file = add(stream(`/Length1 ${data.length}`, data));
      const desc = add(
        `<< /Type /FontDescriptor /FontName /HomemadeApple /Flags 32 /FontBBox [${info.bbox.join(' ')}] /ItalicAngle 0 /Ascent ${info.ascent} /Descent ${info.descent} /CapHeight ${info.capHeight} /StemV 80 /FontFile2 ${file} 0 R >>`,
      );
      f3 = add(
        `<< /Type /Font /Subtype /TrueType /BaseFont /HomemadeApple /FirstChar 32 /LastChar 255 /Widths [${info.widths.join(' ')}] /Encoding /WinAnsiEncoding /FontDescriptor ${desc} 0 R >>`,
      );
    }
    const fonts = `/Font << /F1 ${f1} 0 R /F2 ${f2} 0 R /F4 ${f4} 0 R${f3 ? ` /F3 ${f3} 0 R` : ''} >>`;
    const kids: number[] = [];
    for (const p of this.pages) {
      const content = add(stream('', Buffer.from(p.ops.join('\n'), 'latin1')));
      kids.push(
        add(
          `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${n(p.w * MM)} ${n(p.h * MM)}] /Resources << ${fonts} >> /Contents ${content} 0 R >>`,
        ),
      );
    }
    objs[pagesId - 1] = Buffer.from(
      `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`,
      'latin1',
    );
    objs[catalog - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`, 'latin1');
    const info = add(
      `<< /Producer (Pig's Gotta Fly)${meta.title ? ` /Title ${pdfString(winAnsi(meta.title))}` : ''} >>`,
    );

    const parts: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    let len = parts[0].length;
    const offsets: number[] = [];
    objs.forEach((o, i) => {
      offsets.push(len);
      const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), o, Buffer.from('\nendobj\n', 'latin1')]);
      parts.push(b);
      len += b.length;
    });
    const xref = [
      `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`,
      ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`),
    ].join('');
    parts.push(
      Buffer.from(
        `${xref}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${len}\n%%EOF\n`,
        'latin1',
      ),
    );
    return Buffer.concat(parts);
  }
}
