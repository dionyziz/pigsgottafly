// The PDFs e-mailed to HCAA: Form 731 (landscape, with the handwriting signatures) and the General
// Declaration (portrait), laid out like the print sheets (src/features/exports/form731/Form731.tsx
// and gendec/GenDec.tsx, positions in mm measured from the originals in trn-docs/).
import { PdfDoc, winAnsi, type PdfPage } from './pdf.js';
import handTtf from './fonts/homemadeApple.js';
import {
  GENDEC_DISINSECT_CONT, GENDEC_DISINSECT_LINES, GENDEC_HEALTH_CONT, GENDEC_HEALTH_LINES, signatureName, type Form731Content, type GenDecContent,
} from '../../src/shared/forms.js';

/** Rows printed on one Form 731 sheet. */
const ROWS_731 = 6;

export interface PdfSignature { key: string; name: string; signedAt: number }

const pad2 = (x: number) => String(x).padStart(2, '0');
/** 'YYYY-MM-DD HH:MMZ' */
export function stampZ(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}Z`;
}

/** Signature: faint "PIG'S GOTTA FLY" mark behind the handwritten name, then when it was signed. */
function signature(p: PdfPage, x: number, y: number, w: number, s: PdfSignature) {
  p.color(0.85, 0.9, 0.97);
  p.text(x, y - 0.6, "PIG'S GOTTA FLY", { font: 'bold', size: 11, maxW: w });
  p.color(0.07, 0.16, 0.45);
  p.text(x, y, signatureName(s.name), { font: 'hand', size: 13, maxW: w });
  p.color(0, 0, 0);
  p.text(x, y + 3.4, `Electronically signed ${stampZ(s.signedAt)}`, { size: 6, maxW: w });
  p.color(0, 0, 0);
}

export function form731Pdf(c: Form731Content, sigs: PdfSignature[]): Buffer {
  const doc = new PdfDoc(Buffer.from(handTtf, 'base64'));
  const bySig = new Map(sigs.map((s) => [s.key, s]));
  const sheets: Form731Content['people'][] = [];
  for (let i = 0; i < c.people.length; i += ROWS_731) sheets.push(c.people.slice(i, i + ROWS_731));
  if (!sheets.length) sheets.push([]);
  const pic = c.people.find((x) => x.role === 'PIC');
  sheets.forEach((rows, si) => {
    const p = doc.page(true);
    p.text(148.5, 22, 'OFFICIAL STATEMENT OF PERSONS BOARDING PRIVATE AIRCRAFTS', { font: 'bold', size: 13, align: 'center' });
    p.text(20, 34, 'TO: HELLENIC CIVIL AVIATION AUTHORITY/AIRPORT', { size: 9.5 });
    p.text(110, 33.4, c.airport, { size: 10, maxW: 103 });
    p.line(109, 34.6, 214, 34.6, 0.15);
    p.text(218, 34, 'DATE', { size: 9.5 });
    p.text(229, 33.4, c.date, { size: 10 });
    p.line(228, 34.6, 278, 34.6, 0.15);
    p.text(20, 43, 'We, the undersigned on our own responsibility and being fully aware of the sanctions stipulated by Law 1599/1986, declare solemly that we are fully aware', { size: 8.6, maxW: 258 });
    p.text(20, 49, 'that the flight on which we are boarding, operated by aircraft with registration', { size: 8.6 });
    p.text(132, 48.4, c.registration, { size: 10 });
    p.line(131, 49.6, 170, 49.6, 0.15);
    p.text(172, 49, 'and operating the route', { size: 8.6 });
    p.text(207, 48.4, c.route, { size: 10, maxW: 70 });
    p.line(206, 49.6, 278, 49.6, 0.15);
    p.text(20, 55, 'is not a commercial flight and no fare (fee) has been paid for the afore mentioned transport.', { size: 8.6 });

    // table: No, name, relation, ID, contact, signature (mm widths as the print sheet)
    const cols = [8.6, 62.1, 65.1, 35, 65, 32.5];
    const x0 = 10.5;
    const xs = cols.reduce<number[]>((a, w) => [...a, a[a.length - 1] + w], [x0]);
    const top = 60, headH = 11, rowH = 12.5;
    const bottom = top + headH + ROWS_731 * rowH;
    p.rect(x0, top, xs[xs.length - 1] - x0, bottom - top, 0.3);
    for (const x of xs.slice(1, -1)) p.line(x, top, x, bottom, 0.2);
    p.line(x0, top + headH, xs[xs.length - 1], top + headH, 0.3);
    for (let r = 1; r < ROWS_731; r++) p.line(x0, top + headH + r * rowH, xs[xs.length - 1], top + headH + r * rowH, 0.15);
    const heads = ['No', 'NAME AND SURNAME', 'Relation to the person/entity operating the aircraft *', 'ID/Passport', 'Contact details', 'Signature'];
    heads.forEach((h, i) => p.text((xs[i] + xs[i + 1]) / 2, top + 6.8, h, { font: 'bold', size: 8, align: 'center', maxW: cols[i] - 2 }));
    for (let r = 0; r < ROWS_731; r++) {
      const y = top + headH + r * rowH + 7.8;
      const no = si * ROWS_731 + r + 1;
      p.text(xs[0] + 1.5, y, `${no}.`, { size: 9 });
      const row = rows[r];
      if (!row) continue;
      p.text(xs[1] + 1.5, y, row.name, { size: 10, maxW: cols[1] - 3 });
      p.text(xs[2] + 1.5, y, row.relation, { size: 10, maxW: cols[2] - 3 });
      p.text(xs[3] + 1.5, y, row.idPassport, { size: 10, maxW: cols[3] - 3 });
      p.text(xs[4] + 1.5, y, row.contact, { size: 10, maxW: cols[4] - 3 });
      const s = bySig.get(row.key);
      if (s) signature(p, xs[5] + 1.5, y - 1.2, cols[5] - 3, s);
    }
    p.text(20, bottom + 9, 'Official Statement Guidelines', { font: 'bold', size: 8.5 });
    p.text(20, bottom + 14, 'a.  This form must be submitted by the Pilot in Command to the HCAA/Airport Office (wherever applicable)', { size: 8 });
    p.text(25, bottom + 18, 'otherwise to the Airport Manager Office for validation before flight departure', { size: 8 });
    p.text(20, bottom + 23, 'b.(*) In field "Relation to the person/entity" Aeroclub members must additionally state their Aeroclub Code Number', { size: 8 });
    // The PIC's box, bottom right as on the form; "It is verified by" is for HCAA.
    p.text(198, bottom + 16, 'The Pilot in Command', { font: 'bold', size: 11 });
    p.text(248.4, bottom + 16, 'It is verified by', { font: 'bold', size: 11 });
    if (pic) {
      p.text(218, bottom + 25, pic.name, { size: 10, align: 'center', maxW: 56 });
      const s = bySig.get(pic.key);
      if (s) signature(p, 196, bottom + 33, 44, s);
    }
    p.text(229.3, bottom + 41, '(Fullname-signature)', { size: 8.5, align: 'center' });
    p.text(7.6, 202, 'FORM 731', { font: 'bold', size: 9 });
  });
  return doc.bytes({ title: `Form 731 ${c.registration} ${c.date}` });
}

/** Rows of the routing table (origin, the arrow, destination, blank rows). */
const GD_ROWS = 9;

/**
 * The General Declaration (MD 4.7 = ICAO Annex 9 Appendix 1), one A4 page laid out like the print
 * sheet (src/features/exports/gendec/GenDec.tsx + gendec.css, same mm positions): header lines
 * with the values in bold, the routing box (origin ⇩ destination with the PIC), passengers on this
 * stage, the Declaration of Health struck through "NIL" in blue, the declaration with the PIC's
 * e-signature on its signature line (`sig`, the same handwriting signature as on Form 731).
 */
export function genDecPdf(c: GenDecContent, sig?: PdfSignature | null): Buffer {
  const doc = new PdfDoc(Buffer.from(handTtf, 'base64'));
  const p = doc.page(false);
  const w = (s: string, font: 'regular' | 'bold', size: number) => doc.widthMm(winAnsi(s), font, size);
  /** "Label: VALUE" (value bold) with the baseline at y; returns where it ends. */
  const field = (x: number, y: number, label: string, value: string, maxW = 120) => {
    p.text(x, y, label, { size: 9 });
    const vx = x + w(label + ' ', 'regular', 9);
    const room = Math.max(10, maxW - (vx - x));
    p.text(vx, y, value, { font: 'bold', size: 9.5, maxW: room });
    return vx + Math.min(w(value, 'bold', 9.5), room);
  };
  const L = 15, R = 195;

  p.text(105, 19.5, 'GENERAL DECLARATION', { font: 'bold', size: 17, align: 'center' });
  p.text(105, 24.3, '(OUTWARD/INWARD)', { size: 7, align: 'center' });

  // header lines (7.6 mm apart, as the print sheet)
  field(L, 34.6, 'Operator:', c.operator, 180);
  field(L, 42.2, 'Marks of Nationality and Registration:', c.registration, 98);
  const fx = field(L + 100, 42.2, 'Flight No.:', c.flightNo, 30);
  field(fx + 9, 42.2, 'Date:', c.date, 40);
  const depEnd = field(L, 49.8, 'Departure from:', c.departure, 98);
  p.text((L + depEnd) / 2, 53.6, '(Place)', { size: 6.5, align: 'center' });
  const arrEnd = field(L + 100, 49.8, 'Arrival at:', c.arrival, 80);
  p.text((L + 100 + arrEnd) / 2, 53.6, '(Place)', { size: 6.5, align: 'center' });

  // the routing box
  const top = 59, headH = 14, tableH = 70, healthH = 74;
  const bodyTop = top + headH, healthTop = bodyTop + tableH, bottom = healthTop + healthH;
  const split = L + 110;
  p.rect(L, top, R - L, bottom - top, 0.45);
  p.text(105, top + 7, 'FLIGHT ROUTING', { font: 'bold', size: 13, align: 'center' });
  p.text(105, top + 11.2, '("Place" Column always to list origin every en-route stop and destination)', { size: 7.5, align: 'center' });
  p.line(L, bodyTop, R, bodyTop, 0.35);
  p.line(split, bodyTop, split, bottom, 0.35);
  p.line(L, healthTop, R, healthTop, 0.35);

  // PLACE | NAMES OF CREW*: origin, ⇩, destination, blank rows
  const rowH = tableH / (GD_ROWS + 1), placeR = L + 26;
  p.line(placeR, bodyTop, placeR, healthTop, 0.35);
  p.text((L + placeR) / 2, bodyTop + 4.6, 'PLACE', { font: 'bold', size: 8, align: 'center' });
  p.text((placeR + split) / 2, bodyTop + 4.6, 'NAMES OF CREW*', { font: 'bold', size: 8, align: 'center' });
  for (let r = 1; r <= GD_ROWS; r++) p.line(L, bodyTop + r * rowH, split, bodyTop + r * rowH, r === 1 ? 0.35 : 0.2);
  const rowY = (i: number) => bodyTop + rowH * (i + 1) + 4.8;
  const [origin, dest] = c.routing;
  if (origin) {
    p.text((L + placeR) / 2, rowY(0), origin.place, { font: 'bold', size: 10, align: 'center', maxW: 24 });
    p.text(placeR + 2, rowY(0), origin.crew, { font: 'bold', size: 10, maxW: split - placeR - 4 });
  }
  if (dest) {
    downArrow(p, (L + placeR) / 2, bodyTop + rowH * 2 + 1.3, rowH - 2.6);
    p.text((L + placeR) / 2, rowY(2), dest.place, { font: 'bold', size: 10, align: 'center', maxW: 24 });
  }

  // NUMBER OF PASSENGERS ON THIS STAGE**
  const pcx = (split + R) / 2;
  p.text(pcx, bodyTop + 4.3, 'NUMBER OF PASSENGERS', { font: 'bold', size: 8, align: 'center' });
  p.text(pcx, bodyTop + 7.8, 'ON THIS STAGE**', { font: 'bold', size: 8, align: 'center' });
  p.line(split, bodyTop + 10, R, bodyTop + 10, 0.35);
  const px = split + 4, pr = R - 4;
  const under = (x: number, y: number, s: string) => { p.text(x, y, s, { font: 'italic', size: 8 }); p.line(x, y + 0.7, x + w(s, 'regular', 8), y + 0.7, 0.15); };
  const pax = (y: number, label: string, v: number) => {
    p.text(px, y, label, { size: 8 });
    const x0 = px + w(label, 'regular', 8) + 2;
    p.line(x0, y + 0.8, pr, y + 0.8, 0.2);
    p.text((x0 + pr) / 2, y, String(v), { font: 'bold', size: 9.5, align: 'center' });
  };
  let y = bodyTop + 18;
  under(px, y, 'Departure place:'); y += 6;
  pax(y, 'Embarking', c.embarking); y += 6;
  pax(y, 'Through on same flight', c.throughDeparture); y += 10;
  under(px, y, 'Arrival place:'); y += 6;
  pax(y, 'Disembarking', c.disembarking); y += 6;
  pax(y, 'Through on same flight', c.throughArrival);
  p.text(pcx, healthTop + 6, 'FOR OFFICIAL USE ONLY', { font: 'bold', size: 8, align: 'center' });

  // Declaration of Health: the full Annex 9 text, struck through NIL (nothing to declare)
  p.text((L + split) / 2, healthTop + 4.4, 'DECLARATION OF HEALTH', { font: 'bold', size: 8, align: 'center' });
  const lh = 3, x0 = L + 2, tw = 106, fs = 7.1;
  const dotted = (yy: number, lead: string) => {
    if (lead) p.text(x0, yy, lead, { size: fs });
    const from = lead ? x0 + w(lead + ' ', 'regular', fs) : x0;
    for (let x = from; x < x0 + tw; x += 1.2) p.line(x, yy, x + 0.25, yy, 0.2);
  };
  let hy = healthTop + 9.6;
  for (const l of GENDEC_HEALTH_LINES) { p.text(x0, hy, l, { size: fs, maxW: tw }); hy += lh; }
  dotted(hy, GENDEC_HEALTH_CONT); hy += lh;
  dotted(hy, ''); hy += lh + 1.6;
  for (const l of GENDEC_DISINSECT_LINES) { p.text(x0, hy, l, { size: fs, maxW: tw }); hy += lh; }
  dotted(hy, GENDEC_DISINSECT_CONT); hy += lh;
  dotted(hy, '');
  const sy = bottom - 7.2;
  const signed = 'Signed, if required, with time and date';
  p.text(x0, sy, signed, { size: fs });
  p.line(x0 + w(signed, 'regular', fs) + 1.5, sy + 0.4, split - 2, sy + 0.4, 0.2);
  p.text(split - 12, bottom - 3.2, 'Crew member concerned', { size: fs, align: 'right' });
  const hx0 = L + 2, hy0 = bottom - 2, hx1 = split - 2, hy1 = healthTop + 2;
  p.color(0.12, 0.31, 0.75);
  p.line(hx0, hy0, hx1, hy1, 0.5);
  const ang = (Math.atan2(hy0 - hy1, hx1 - hx0) * 180) / Math.PI;
  const a = (ang * Math.PI) / 180;
  // NIL along the line, just above it
  p.text((hx0 + hx1) / 2 - 2 * Math.sin(a), (hy0 + hy1) / 2 - 2 * Math.cos(a), 'NIL', { font: 'bold', size: 32, align: 'center', rotate: ang });
  p.color(0, 0, 0);

  // the declaration, full width
  const decl = [
    'I declare that all statements and particulars contained in this General Declaration, and in any supplementary forms required to be',
    'presented with this General Declaration, are complete, exact and true to the best of my knowledge and that all through passengers',
    'will continue/have continued on the flight.',
  ];
  decl.forEach((l, i) => p.text(L, 225.2 + i * 4.2, l, { size: 8.5, maxW: R - L }));
  const sl = 251;
  p.text(70, sl, 'Signature', { size: 9 });
  const lx = 70 + w('Signature', 'regular', 9) + 2;
  p.line(lx, sl, lx + 90, sl, 0.2);
  if (sig) signature(p, lx + 14, sl - 7.4, 60, sig);
  p.text(lx + 45, sl + 4.4, 'Authorized Agent or Pilot-in-Command', { size: 8, align: 'center' });

  p.text(L, 271, '* To be completed when required by the State.', { size: 7 });
  p.text(L, 274.6, '** Not to be completed when passenger manifests are presented and to be completed only when required by the State.', { size: 7, maxW: R - L });
  return doc.bytes({ title: `General Declaration ${c.registration} ${c.date}` });
}

/** An outlined down arrow (⇩) centred on x, from y (top) over h mm. */
function downArrow(p: PdfPage, x: number, y: number, h: number) {
  const sw = 1.1, hw = 2.6, sh = h * 0.5;
  const pts: [number, number][] = [[x - sw, y], [x + sw, y], [x + sw, y + sh], [x + hw, y + sh], [x, y + h], [x - hw, y + sh], [x - sw, y + sh], [x - sw, y]];
  for (let i = 0; i < pts.length - 1; i++) p.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 0.25);
}
