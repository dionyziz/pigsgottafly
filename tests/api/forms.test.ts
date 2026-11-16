// Form 731 signatures and the forms e-mailed to HCAA (api/_lib/routes/forms.ts): the PIC signs
// automatically, signing links (hashed tokens, masking of other people's details, open/sign
// tracking, revoke/renew, expiry), invalidation when the form changes, access control across
// pilots, the PDFs, and the e-mail (MOCKED transport: nothing is sent for real).
import fs from 'node:fs';
import zlib from 'node:zlib';

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';

import handTtf from '../../api/_lib/fonts/homemadeApple';
import { stampZ } from '../../api/_lib/formPdf';
import { type SentMail, setMailTransport } from '../../api/_lib/mail';
import { parseTtf, PdfDoc, winAnsi } from '../../api/_lib/pdf';
import aerodromes from '../../src/data/ref/aerodromes.json';
import { type FormsState, GENDEC_DISINSECT_LINES, GENDEC_HEALTH_LINES, type SigningView } from '../../src/shared/forms';
import type { RefAerodrome } from '../../src/shared/ref';
import type { RoutePoint } from '../../src/shared/types';
import { type Client, client, startApi } from './helpers';

const ADS = ((aerodromes as any).aerodromes ?? aerodromes) as RefAerodrome[];
const pt = (icao: string, uid: string): RoutePoint => {
  const a = ADS.find((x) => x.icao === icao)!;
  return { uid, kind: 'aerodrome', refId: a.id, name: icao, lat: a.lat, lon: a.lon };
};
const tomorrow = new Date(Date.now() + 24 * 3600e3).toISOString().slice(0, 10);

let api: Awaited<ReturnType<typeof startApi>>;
let A: Client, B: Client, anon: Client;
const sent: SentMail[] = [];

beforeAll(async () => {
  // who may send forms by e-mail: see formsMail.test.ts
  api = await startApi({ allowedEmails: ['pilot.a@example.com', 'pilot.b@example.com'] });
  A = client(api.base);
  B = client(api.base);
  anon = client(api.base);
  expect((await A.login('sa', 'pilot.a@example.com')).status).toBe(200);
  expect((await B.login('sb', 'pilot.b@example.com')).status).toBe(200);
  await A.call('PUT', 'me', {
    fullName: 'Dionysis Zindros',
    phone: '+30 690 000 0001',
    idNumber: 'AK123456',
    idType: 'ID',
    relation: 'MEMBER 42',
  });
});
afterAll(() => api.close());
afterEach(() => setMailTransport(null));

async function setup(date = tomorrow) {
  const pax = (
    await A.call('POST', 'passengers', {
      fullName: 'Maria Papadopoulou',
      phone: '+30 690 111 2233',
      idNumber: 'AB987654',
      idType: 'ID',
      relation: 'FRIEND',
    })
  ).body;
  const f = (
    await A.call('POST', 'flights', {
      date,
      blockOff: '08:00',
      route: [pt('LGTT', 'a'), pt('LGMG', 'b')],
      crew: [
        {
          role: 'PIC',
          passengerId: null,
          seat: 'front-left',
          snapshot: {
            fullName: '',
            phone: '',
            dateOfBirth: null,
            weightKg: 80,
            idNumber: '',
            idType: '',
            nationality: '',
            relation: '',
          },
        },
        {
          role: 'PAX',
          passengerId: pax.id,
          seat: 'front-right',
          snapshot: {
            fullName: 'Maria Papadopoulou',
            phone: '+30 690 111 2233',
            dateOfBirth: null,
            weightKg: 60,
            idNumber: 'AB987654',
            idType: 'ID',
            nationality: '',
            relation: 'FRIEND',
          },
        },
      ],
    })
  ).body;
  expect(f.id).toBeTruthy();
  return { flightId: f.id as string, paxKey: pax.id as string };
}
const forms = async (c: Client, id: string) => c.call<FormsState>('GET', `flights/${id}/forms`);

describe('Form 731 signatures', () => {
  test('the PIC is signed automatically; a passenger signs through a link; tokens are not stored', async () => {
    const { flightId, paxKey } = await setup();
    let st = (await forms(A, flightId)).body;
    expect(st.form731.content.people.map((p) => p.name)).toEqual(['Dionysis Zindros', 'Maria Papadopoulou']);
    expect(st.form731.signatures.find((s) => s.role === 'PIC')!.signed).toBe(true);
    expect(st.form731.signatures.find((s) => s.key === paxKey)!.signed).toBe(false);
    expect(st.form731.allSigned).toBe(false);

    const made = (await A.call<FormsState>('POST', `flights/${flightId}/forms/731/links`)).body;
    const token = made.links![paxKey];
    expect(token).toMatch(/^[A-Za-z0-9_-]{30,}$/);
    // again: no new link for someone who has one
    expect((await A.call<FormsState>('POST', `flights/${flightId}/forms/731/links`)).body.links).toEqual({});

    // the signing page needs no sign-in; own row in full, other people's ID and phone masked
    const view = (await anon.call<SigningView>('GET', `sign/${token}`)).body;
    expect(view.me).toBe(paxKey);
    const mine = view.content.people.find((p) => p.key === paxKey)!;
    expect(mine.idPassport).toBe('AB987654');
    expect(mine.contact).toBe('+30 690 111 2233');
    const pic = view.content.people.find((p) => p.role === 'PIC')!;
    expect(pic.name).toBe('Dionysis Zindros');
    expect(pic.idPassport).not.toContain('AK1234');
    expect(pic.idPassport.endsWith('56')).toBe(true);
    expect(pic.contact).not.toContain('690 000');

    st = (await forms(A, flightId)).body;
    const link = st.form731.signatures.find((s) => s.key === paxKey)!.link!;
    expect(link.firstOpened).toBeGreaterThan(0);
    expect(link.revoked).toBe(false);

    const signed = (await anon.call<SigningView>('POST', `sign/${token}`)).body;
    expect(signed.signatures.find((s) => s.key === paxKey)!.signedAt).toBeGreaterThan(0);
    st = (await forms(A, flightId)).body;
    expect(st.form731.allSigned).toBe(true);
  });

  test('a change to the form clears the signatures (the PIC re-signs automatically, the passenger must sign again)', async () => {
    const { flightId, paxKey } = await setup();
    const token = (await A.call<FormsState>('POST', `flights/${flightId}/forms/731/links`)).body.links![paxKey];
    await anon.call('POST', `sign/${token}`);
    expect((await forms(A, flightId)).body.form731.allSigned).toBe(true);

    const f = (await A.call('GET', `flights/${flightId}`)).body;
    const { id, version, created, updated, opened, trashed, pilotId, ...doc } = f;
    expect(
      (
        await A.call('PUT', `flights/${flightId}`, {
          flight: { ...doc, route: [pt('LGTT', 'a'), pt('LGMG', 'b'), pt('LGTT', 'c')] },
          version,
        })
      ).status,
    ).toBe(200);
    const st = (await forms(A, flightId)).body;
    const pax = st.form731.signatures.find((s) => s.key === paxKey)!;
    expect(pax.signed).toBe(false);
    expect(pax.needsResign).toBe(true);
    expect(st.form731.signatures.find((s) => s.role === 'PIC')!.signed).toBe(true);
    // the same link signs the new version
    await anon.call('POST', `sign/${token}`);
    expect((await forms(A, flightId)).body.form731.allSigned).toBe(true);
  });

  test('revoke and renew; links of one flight reach nothing else; other pilots get 404', async () => {
    const { flightId, paxKey } = await setup();
    const t1 = (await A.call<FormsState>('POST', `flights/${flightId}/forms/731/links`)).body.links![paxKey];
    const t2 = (
      await A.call<FormsState>('POST', `flights/${flightId}/forms/731/links/${encodeURIComponent(paxKey)}/renew`)
    ).body.links![paxKey];
    expect(t2).not.toBe(t1);
    expect((await anon.call('GET', `sign/${t1}`)).status).toBe(404);
    expect((await anon.call('GET', `sign/${t2}`)).status).toBe(200);
    await A.call('POST', `flights/${flightId}/forms/731/links/${encodeURIComponent(paxKey)}/revoke`);
    expect((await anon.call('GET', `sign/${t2}`)).status).toBe(404);
    expect((await anon.call('POST', `sign/${t2}`)).status).toBe(404);
    expect((await anon.call('GET', 'sign/not-a-token-at-all-xxxxxxxxxxxxxxx')).status).toBe(404);

    expect((await forms(B, flightId)).status).toBe(404);
    expect((await B.call('POST', `flights/${flightId}/forms/731/links`)).status).toBe(404);
    expect((await B.call('POST', `flights/${flightId}/forms/731/send`)).status).toBe(404);
    expect((await anon.call('GET', `flights/${flightId}/forms`)).status).toBe(401);
  });

  test('a link given to a passenger without a saved record does not reach the next person put in that seat', async () => {
    const snap = (fullName: string, idNumber: string, phone: string) => ({
      fullName,
      phone,
      dateOfBirth: null,
      weightKg: 70,
      idNumber,
      idType: 'ID',
      nationality: '',
      relation: '',
    });
    const pic = { role: 'PIC', passengerId: null, seat: 'front-left', snapshot: snap('', '', '') };
    const f = (
      await A.call('POST', 'flights', {
        date: tomorrow,
        blockOff: '08:00',
        route: [pt('LGTT', 'a'), pt('LGMG', 'b')],
        crew: [
          pic,
          {
            role: 'PAX',
            passengerId: null,
            seat: 'front-right',
            snapshot: snap('Xavier X', 'XX111111', '+30 690 XX111111'),
          },
        ],
      })
    ).body;
    const key = 'seat:front-right';
    const tx = (await A.call<FormsState>('POST', `flights/${f.id}/forms/731/links`)).body.links![key];
    expect(tx).toBeTruthy();
    expect(
      (await anon.call<SigningView>('GET', `sign/${tx}`)).body.content.people.find((p) => p.key === key)!.name,
    ).toBe('Xavier X');
    await anon.call('POST', `sign/${tx}`);

    // the pilot puts Yvonne in that seat instead
    const cur = (await A.call('GET', `flights/${f.id}`)).body;
    const { id, version, created, updated, opened, trashed, pilotId, ...doc } = cur;
    const crew = [
      pic,
      {
        role: 'PAX',
        passengerId: null,
        seat: 'front-right',
        snapshot: snap('Yvonne Y', 'YY999999', '+30 690 YY999999'),
      },
    ];
    expect((await A.call('PUT', `flights/${f.id}`, { flight: { ...doc, crew }, version })).status).toBe(200);

    // Xavier's link neither shows Yvonne's details nor signs for her
    const g = await anon.call('GET', `sign/${tx}`);
    expect(g.status).toBe(410);
    expect(JSON.stringify(g.body)).not.toContain('YY999999');
    expect((await anon.call('POST', `sign/${tx}`)).status).toBe(410);
    let st = (await forms(A, f.id)).body;
    let y = st.form731.signatures.find((s) => s.key === key)!;
    expect(y.name).toBe('Yvonne Y');
    expect(y.signed).toBe(false);
    expect(y.needsResign).toBe(false); // Xavier's signature is not hers
    expect(y.link).toBeNull(); // Xavier's link is not shown as hers
    expect(st.form731.allSigned).toBe(false);
    expect((await A.call('POST', `flights/${f.id}/forms/731/send`)).status).toBe(409);

    // Yvonne gets her own link (Xavier's is revoked) and signs
    const ty = (await A.call<FormsState>('POST', `flights/${f.id}/forms/731/links`)).body.links![key];
    expect(ty).toBeTruthy();
    const v = (await anon.call<SigningView>('GET', `sign/${ty}`)).body;
    expect(v.content.people.find((p) => p.key === key)!.idPassport).toBe('YY999999');
    await anon.call('POST', `sign/${ty}`);
    st = (await forms(A, f.id)).body;
    y = st.form731.signatures.find((s) => s.key === key)!;
    expect(y.signed).toBe(true);
    expect(y.link!.revoked).toBe(false);
    expect(st.form731.allSigned).toBe(true);
    expect((await anon.call('GET', `sign/${tx}`)).status).toBe(404); // revoked

    // a saved passenger keeps their link when the pilot corrects their details
    const { flightId, paxKey } = await setup();
    const tm = (await A.call<FormsState>('POST', `flights/${flightId}/forms/731/links`)).body.links![paxKey];
    await A.call('PUT', `passengers/${paxKey}`, {
      fullName: 'Maria Papadopoulou',
      phone: '+30 690 111 2299',
      idNumber: 'AB987654',
      idType: 'ID',
      relation: 'FRIEND',
    });
    expect((await anon.call('GET', `sign/${tm}`)).status).toBe(200);
  });

  test('links expire after the flight date', async () => {
    const past = new Date(Date.now() - 5 * 24 * 3600e3).toISOString().slice(0, 10);
    const { flightId, paxKey } = await setup(past);
    const t = (await A.call<FormsState>('POST', `flights/${flightId}/forms/731/links`)).body.links?.[paxKey];
    // an already-expired link is not even listed as open, but the token answers 410
    expect(t).toBeTruthy();
    expect((await anon.call('GET', `sign/${t}`)).status).toBe(410);
  });
});

describe('sending the forms to HCAA', () => {
  test('Form 731: refused until everyone signed, 503 without e-mail, then sent as PDF with cc and reply-to the pilot; re-send after changes', async () => {
    const { flightId, paxKey } = await setup();
    let st = (await forms(A, flightId)).body;
    expect(st.emailEnabled).toBe(false);
    expect((await A.call('POST', `flights/${flightId}/forms/731/send`)).status).toBe(409);
    const token = (await A.call<FormsState>('POST', `flights/${flightId}/forms/731/links`)).body.links![paxKey];
    await anon.call('POST', `sign/${token}`);
    expect((await A.call('POST', `flights/${flightId}/forms/731/send`)).status).toBe(503);

    setMailTransport(async (m) => {
      sent.push(m);
      return { id: `msg-${sent.length}` };
    });
    const r = await A.call<FormsState>('POST', `flights/${flightId}/forms/731/send`);
    expect(r.status).toBe(200);
    const m = sent[sent.length - 1];
    expect(m.to).toEqual(['731@hcaa.gov.gr']);
    expect(m.cc).toEqual(['pilot.a@example.com']);
    expect(m.replyTo).toBe('pilot.a@example.com');
    expect(m.subject).toMatch(/^Form 731 · .*LGTT → LGMG · \d{4}-\d{2}-\d{2}$/);
    const pdf = m.attachments![0].content;
    expect(pdf.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
    expect(m.attachments![0].contentType).toBe('application/pdf');
    const text = pdfText(pdf);
    expect(text).toContain('Dionysis Zindros');
    expect(text).toContain('Maria Papadopoulou');
    expect(text).toContain('D. Zindros'); // the PIC's handwriting signature
    expect(text).toContain('M. Papadopoulou');
    expect(pdf.toString('latin1')).toContain('/FontFile2');
    expect(r.body.form731.submission).toMatchObject({
      messageId: `msg-${sent.length}`,
      to: '731@hcaa.gov.gr',
      changed: false,
    });

    // a change: the submission is marked changed (re-send offered once everyone signed again)
    const f = (await A.call('GET', `flights/${flightId}`)).body;
    const { id, version, created, updated, opened, trashed, pilotId, ...doc } = f;
    await A.call('PUT', `flights/${flightId}`, {
      flight: { ...doc, date: new Date(Date.now() + 2 * 24 * 3600e3).toISOString().slice(0, 10) },
      version,
    });
    st = (await forms(A, flightId)).body;
    expect(st.form731.submission!.changed).toBe(true);
    expect(st.form731.allSigned).toBe(false);
  });

  test('General Declaration: sent to gendec@hcaa.gov.gr', async () => {
    const { flightId } = await setup();
    const st = (await forms(A, flightId)).body;
    expect(st.gendec.pilotSends).toBe(true);
    // signed once per version: the time stays while the declaration is unchanged
    expect((await forms(A, flightId)).body.gendec.picSignature).toEqual(st.gendec.picSignature);
    setMailTransport(async (m) => {
      sent.push(m);
      return { id: 'gd-1' };
    });
    const r = await A.call<FormsState>('POST', `flights/${flightId}/forms/gendec/send`);
    expect(r.status).toBe(200);
    const m = sent[sent.length - 1];
    expect(m.to).toEqual(['gendec@hcaa.gov.gr']);
    expect(m.subject).toMatch(/^General Declaration · /);
    const text = pdfText(m.attachments![0].content);
    expect(text).toContain('GENERAL DECLARATION');
    // the PIC's e-signature on the declaration, as on Form 731 (handwriting font + time signed)
    expect(st.gendec.picSignature).toMatchObject({ name: 'Dionysis Zindros' });
    expect(text).toContain('D. Zindros');
    expect(text).toContain(`signed ${stampZ(st.gendec.picSignature!.signedAt)}`);
    expect(m.attachments![0].content.toString('latin1')).toContain('/FontFile2');
    // the official Annex 9 text, the same lines as the print sheet
    for (const l of [...GENDEC_HEALTH_LINES, ...GENDEC_DISINSECT_LINES])
      expect(text).toContain(winAnsi(l).toString('latin1'));
    expect(text).toContain('stop');
    expect(text).toContain('details of most recent disinsecting');
    expect(text).toContain('Signed, if required, with time and date');
    expect(text).toContain('Crew member concerned');
    // the pilot's layout: values in bold after their labels, origin and destination only, NIL
    expect(text).toMatch(/Flight No\.:\nPVT\nDate:\n\d{4}-\d{2}-\d{2}/);
    expect(text).toMatch(/Departure from:\nLGTT\n/);
    expect(text).toMatch(/Arrival at:\nLGMG\n/);
    expect(text).toContain('DIONYSIS ZINDROS');
    expect(text).toContain('NIL');
    expect(text).toContain('* To be completed when required by the State.');
    if (process.env.GENDEC_PDF_OUT) fs.writeFileSync(process.env.GENDEC_PDF_OUT, m.attachments![0].content);
    expect(r.body.gendec.submission).toMatchObject({ messageId: 'gd-1', changed: false });

    // LGTT and LGMG have no handler (AIP AD 1.6.5.4 / AD 1.6.18.4: NIL): the PIC sends it
    expect(st.gendec.handling.ends.map((e) => [e.role, e.handled])).toEqual([
      ['departure', false],
      ['destination', false],
    ]);
    expect(st.gendec.handling.ends[0].reason).toBe('LGTT: no handling (AIP AD 1.6.5.4)');
    // the old profile setting is ignored
    await A.call('PUT', 'me', { settings: { handledAerodromes: ['LGMG', 'LGTT'] } });
    expect((await forms(A, flightId)).body.gendec.pilotSends).toBe(true);
    await A.call('PUT', 'me', { settings: { handledAerodromes: [] } });
  });

  test('General Declaration: handled ends from the AIP and the NOTAMs; the per-flight override', async () => {
    // LGAV (handling H24) → LGIR (handling H24): a handler submits it at both ends
    const f = (
      await A.call('POST', 'flights', { date: tomorrow, blockOff: '08:00', route: [pt('LGAV', 'a'), pt('LGIR', 'b')] })
    ).body;
    let st = (await forms(A, f.id)).body;
    expect(st.gendec.pilotSends).toBe(false);
    expect(st.gendec.handling.autoPilotSends).toBe(false);
    expect(st.gendec.handling.ends.map((e) => e.reason)).toEqual([
      'LGAV: handling H24 (AIP AD 2.3)',
      'LGIR: handling H24 (AIP AD 2.3)',
    ]);

    // a NOTAM in the flight's briefing: no handling at LGIR → the PIC sends it, citing the NOTAM
    const day = Date.parse(`${tomorrow}T00:00:00Z`);
    const notam = {
      key: 'A1234/26',
      type: 'N',
      refers: null,
      itemA: ['LGIR'],
      fir: 'LGGG',
      qcode: 'QFAXX',
      subject: 'Aerodrome',
      condition: null,
      traffic: 'IV',
      purpose: 'NBO',
      scope: 'A',
      lowerFt: 0,
      upperFt: 99900,
      center: null,
      radiusNm: null,
      from: day,
      to: day + 2 * 86400e3,
      estimated: false,
      schedule: null,
      text: 'HANDLING SERVICES NOT AVBL.',
      lowerText: null,
      upperText: null,
      raw: '',
      relevant: true,
      reasons: [],
      legIndex: null,
    };
    const { db } = await (api.server as any).ready;
    await db.query(
      `INSERT INTO flight_notams (flight_id, pilot_id, fetched, params, doc) SELECT id, pilot_id, $2, '{}'::jsonb, $3::jsonb FROM flights WHERE id = $1`,
      [f.id, Date.now(), JSON.stringify({ notams: [notam] })],
    );
    st = (await forms(A, f.id)).body;
    expect(st.gendec.pilotSends).toBe(true);
    expect(st.gendec.handling.ends[1]).toMatchObject({
      handled: false,
      reason: expect.stringMatching(/^LGIR: NOTAM A1234\/26: handling not available/),
    });

    // the override is per flight: a handler submits it after all
    let r = await A.call<FormsState>('POST', `flights/${f.id}/forms/gendec/handled`, { handled: true });
    expect(r.status).toBe(200);
    expect(r.body.gendec.pilotSends).toBe(false);
    expect(r.body.gendec.handling).toMatchObject({ override: true, autoPilotSends: true });
    // stored with the flight; an editor save (whose copy has no override) keeps it
    const got = (await A.call('GET', `flights/${f.id}`)).body;
    expect(got.options.genDecHandled).toBe(true);
    const { id, version, created, updated, opened, trashed, pilotId, ...doc } = got;
    expect(
      (
        await A.call('PUT', `flights/${f.id}`, {
          flight: { ...doc, options: { ...doc.options, genDecHandled: undefined } },
          version,
        })
      ).status,
    ).toBe(200);
    expect((await forms(A, f.id)).body.gendec.pilotSends).toBe(false);
    // back to automatic
    r = await A.call<FormsState>('POST', `flights/${f.id}/forms/gendec/handled`, { handled: null });
    expect(r.body.gendec.pilotSends).toBe(true);
    expect(r.body.gendec.handling.override).toBe(null);
    expect((await A.call('POST', `flights/${f.id}/forms/gendec/handled`, { handled: 'yes' })).status).toBe(400);
    // another pilot's flight: 404
    expect((await B.call('POST', `flights/${f.id}/forms/gendec/handled`, { handled: true })).status).toBe(404);
  });
});

describe('PDF writer', () => {
  test('the handwriting font parses and has widths for ASCII', () => {
    const info = parseTtf(Buffer.from(handTtf, 'base64'));
    expect(info.unitsPerEm).toBeGreaterThan(0);
    expect(info.widths['A'.charCodeAt(0) - 32]).toBeGreaterThan(100);
  });
  test('Greek is transliterated to WinAnsi text', () => {
    expect(winAnsi('Μαρία Ευαγγέλου').toString('latin1')).toBe('Maria Evangelou');
  });
  test('a valid file: header, xref offsets, trailer', () => {
    const d = new PdfDoc();
    d.page().text(10, 10, 'Hello (world)');
    const b = d.bytes().toString('latin1');
    const start = Number(/startxref\n(\d+)/.exec(b)![1]);
    expect(b.slice(start, start + 4)).toBe('xref');
    const off = /xref\n0 \d+\n0000000000 65535 f \n(\d{10})/.exec(b)![1];
    expect(b.slice(Number(off), Number(off) + 7)).toBe('1 0 obj');
    expect(pdfText(Buffer.from(b, 'latin1'))).toContain('Hello (world)');
  });
});

/** Text shown by the PDF's content streams (inflated), for assertions. */
function pdfText(pdf: Buffer): string {
  const s = pdf.toString('latin1');
  const out: string[] = [];
  const re = /stream\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const begin = m.index + m[0].length;
    const end = s.indexOf('\nendstream', begin);
    try {
      const raw = zlib.inflateSync(pdf.subarray(begin, end)).toString('latin1');
      for (const t of raw.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g))
        out.push(
          t[1].replace(/\\([0-7]{3}|[()\\])/g, (_, e: string) =>
            e.length === 3 ? String.fromCharCode(parseInt(e, 8)) : e,
          ),
        );
    } catch {
      /* the font stream */
    }
  }
  return out.join('\n');
}
