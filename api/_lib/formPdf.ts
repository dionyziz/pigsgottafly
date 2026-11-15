// The PDFs e-mailed to HCAA: Form 731 (landscape, with the handwriting signatures) and the General
// Declaration (portrait), laid out like the print sheets (src/features/exports/form731/Form731.tsx
// and gendec/GenDec.tsx, positions in mm measured from the originals in trn-docs/).
import { PdfDoc, type PdfPage } from './pdf.js';
import handTtf from './fonts/homemadeApple.js';
import {
  GENDEC_DISINSECT_CONT, GENDEC_DISINSECT_LINES, GENDEC_HEALTH_CONT, GENDEC_HEALTH_LINES, signatureName, type Form731Content, type GenDecContent,
} from '../../src/shared/forms.js';

/** Rows printed on one Form 731 sheet. */
const ROWS_731 = 6;

export interface PdfSignature { key: string; name: string; signedAt: number }

const pad2 = (x: number) => String(x).padStart(2, '0');
/** 'DD/MM/YYYY HH:MMZ' */
export function stampZ(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}Z`;
}

function signature(p: PdfPage, x: number, y: number, w: number, s: PdfSignature) {
  p.color(0.07, 0.16, 0.45);
  p.text(x, y, signatureName(s.name), { font: 'hand', size: 13, maxW: w });
  p.color(0, 0, 0);
  p.text(x, y + 3.6, `signed ${stampZ(s.signedAt)}`, { size: 6.5, maxW: w });
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

/**
 * The General Declaration (MD 4.7 = ICAO Annex 9 Appendix 1) with the PIC's e-signature on the
 * declaration's signature line (`sig`, the same handwriting signature as on Form 731).
 */
export function genDecPdf(c: GenDecContent, sig?: PdfSignature | null): Buffer {
  const doc = new PdfDoc(Buffer.from(handTtf, 'base64'));
  const p = doc.page(false);
  const fill = (x: number, y: number, w: number, v: string) => { p.text(x + 1, y - 0.6, v, { size: 10, maxW: w - 2 }); p.line(x, y + 0.6, x + w, y + 0.6, 0.15); };
  p.text(105, 18, 'GENERAL DECLARATION', { font: 'bold', size: 14, align: 'center' });
  p.text(105, 23, '(OUTWARD/INWARD)', { size: 9, align: 'center' });
  p.text(15, 33, 'Operator', { size: 9.5 });
  fill(31, 33, 164, c.operator);
  p.text(15, 40, 'Marks of Nationality and Registration', { size: 9.5 });
  fill(76, 40, 42, c.registration);
  p.text(120, 40, 'Flight No.', { size: 9.5 });
  fill(137, 40, 20, c.flightNo);
  p.text(159, 40, 'Date', { size: 9.5 });
  fill(167, 40, 28, c.date.every(Boolean) ? c.date.join('/') : '');
  p.text(15, 47, 'Departure from', { size: 9.5 });
  fill(41, 47, 62, c.departure);
  p.text(105, 47, 'Arrival at', { size: 9.5 });
  fill(122, 47, 73, c.arrival);
  p.text(72, 51, '(Place)', { size: 7, align: 'center' });
  p.text(158, 51, '(Place)', { size: 7, align: 'center' });

  const top = 56, boxH = 162;
  p.rect(15, top, 180, boxH, 0.3);
  p.text(105, top + 6, 'FLIGHT ROUTING', { font: 'bold', size: 10, align: 'center' });
  p.text(105, top + 10.5, '("Place" Column always to list origin every en-route stop and destination)', { size: 7.5, align: 'center' });
  const tTop = top + 13, rowH = 7.5;
  p.line(15, tTop, 195, tTop, 0.3);
  p.line(45, tTop, 45, tTop + rowH * (c.routing.length + 1), 0.2);
  p.line(125, tTop, 125, top + boxH, 0.3);
  p.text(30, tTop + 5, 'PLACE', { font: 'bold', size: 8.5, align: 'center' });
  p.text(85, tTop + 5, 'NAMES OF CREW*', { font: 'bold', size: 8.5, align: 'center' });
  c.routing.forEach((r, i) => {
    const y = tTop + rowH * (i + 1);
    p.line(15, y, 125, y, 0.15);
    p.text(17, y + 5.3, r.place, { size: 10, maxW: 27 });
    p.text(47, y + 5.3, r.crew, { size: 10, maxW: 76 });
  });
  p.text(160, tTop + 5, 'NUMBER OF PASSENGERS', { font: 'bold', size: 8, align: 'center' });
  p.text(160, tTop + 9, 'ON THIS STAGE**', { font: 'bold', size: 8, align: 'center' });
  const px = 128;
  let y = tTop + 20;
  p.text(px, y, `Departure place: ${c.departureCode}`, { size: 9 }); y += 7;
  p.text(px, y, `Embarking: ${c.embarking}`, { size: 9 }); y += 6;
  p.text(px, y, `Through on same flight: ${c.throughDeparture}`, { size: 9 }); y += 12;
  p.text(px, y, `Arrival place: ${c.arrivalCode}`, { size: 9 }); y += 7;
  p.text(px, y, `Disembarking: ${c.disembarking}`, { size: 9 }); y += 6;
  p.text(px, y, `Through on same flight: ${c.throughArrival}`, { size: 9 });

  // Declaration of health: the full Annex 9 text, left blank (as on the print sheet).
  const hTop = tTop + rowH * (c.routing.length + 1);
  p.line(15, hTop, 125, hTop, 0.3);
  p.text(70, hTop + 5, 'DECLARATION OF HEALTH', { font: 'bold', size: 8.5, align: 'center' });
  const lh = 3.3, x0 = 17, w = 106;
  const dotted = (yy: number, lead: string) => {
    if (lead) p.text(x0, yy, lead, { size: 7.2 });
    const from = lead ? x0 + doc.widthMm(Buffer.from(lead + ' ', 'latin1'), 'regular', 7.2) : x0;
    p.line(from, yy + 0.4, x0 + w, yy + 0.4, 0.1);
  };
  let hy = hTop + 9.5;
  for (const l of GENDEC_HEALTH_LINES) { p.text(x0, hy, l, { size: 7.2, maxW: w }); hy += lh; }
  dotted(hy, GENDEC_HEALTH_CONT); hy += 4.6;
  dotted(hy, ''); hy += 5.2;
  for (const l of GENDEC_DISINSECT_LINES) { p.text(x0, hy, l, { size: 7.2, maxW: w }); hy += lh; }
  dotted(hy, GENDEC_DISINSECT_CONT); hy += 4.6;
  dotted(hy, ''); hy += 6.5;
  p.text(x0, hy, 'Signed, if required, with time and date', { size: 7.2 });
  p.line(x0 + 50, hy + 0.4, x0 + 98, hy + 0.4, 0.15);
  p.text(x0 + 74, hy + 3.6, 'Crew member concerned', { size: 7.2, align: 'center' });
  p.text(160, hTop + 30, 'FOR OFFICIAL USE ONLY', { size: 8, align: 'center' });

  const b = top + boxH + 8;
  p.text(15, b, 'I declare that all statements and particulars contained in this General Declaration, and in any supplementary forms required to be', { size: 8, maxW: 180 });
  p.text(15, b + 4, 'presented with this General Declaration, are complete, exact and true to the best of my knowledge and that all through passengers', { size: 8, maxW: 180 });
  p.text(15, b + 8, 'will continue/have continued on the flight.', { size: 8 });
  if (sig) signature(p, 136, b + 19, 56, sig);
  p.line(118, b + 23, 195, b + 23, 0.15);
  p.text(156, b + 27, 'Signature: Authorized Agent or Pilot-in-Command', { size: 7, align: 'center' });
  p.text(156, b + 32, c.picName, { size: 10, align: 'center', maxW: 75 });
  p.text(15, 278, '* To be completed when required by the State.', { size: 6.5 });
  p.text(15, 281, '** Not to be completed when passenger manifests are presented and to be completed only when required by the State.', { size: 6.5 });
  p.text(15, 287, 'ICAO ANNEX 9 - APPENDIX 1.1', { size: 8 });
  p.text(105, 291, 'MD 4.7', { font: 'bold', size: 8, align: 'center' });
  return doc.bytes({ title: `General Declaration ${c.registration} ${c.date.join('/')}` });
}
