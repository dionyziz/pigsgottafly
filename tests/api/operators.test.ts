// Operators: the access matrix (owner / editor / viewer / stranger), the view access that sharing an
// aircraft gives to its operator (and that ends with the aircraft's share), assigning an aircraft to
// an operator, the operator's name on the aircraft (GenDec, FPL), its documents, and the W&B and
// performance sheets e-mailed to an operator that asks for them (mail transport MOCKED).
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';

import { type SentMail, setMailTransport } from '../../api/_lib/mail';
import { wbPerfHash } from '../../api/_lib/routes/declarations';
import aerodromes from '../../src/data/ref/aerodromes.json';
import {
  type DeclarationsState,
  type HangarAircraft,
  type OperatorItem,
  type OperatorSharing,
  type WbPerfContent,
  wbPerfContentOf,
} from '../../src/shared';
import type { RefAerodrome } from '../../src/shared/ref';
import { blankAircraft } from '../../src/shared/templates';
import type { RoutePoint } from '../../src/shared/types';
import { type Client, client, startApi } from './helpers';

const ADS = ((aerodromes as any).aerodromes ?? aerodromes) as RefAerodrome[];
const pt = (icao: string, uid: string): RoutePoint => {
  const a = ADS.find((x) => x.icao === icao)!;
  return { uid, kind: 'aerodrome', refId: a.id, name: icao, lat: a.lat, lon: a.lon };
};
const tomorrow = new Date(Date.now() + 24 * 3600e3).toISOString().slice(0, 10);

let api: Awaited<ReturnType<typeof startApi>>;
let owner: Client, editor: Client, viewer: Client, stranger: Client, pilot: Client;
const ids: Record<string, string> = {};

const aircraftBody = (reg: string, operatorId: string | null = null) => {
  const ac = blankAircraft();
  ac.registration = reg;
  ac.cruiseTasKt = 95;
  ac.patternTasKt = 80;
  ac.operatorId = operatorId;
  return ac;
};

beforeAll(async () => {
  api = await startApi();
  owner = client(api.base);
  editor = client(api.base);
  viewer = client(api.base);
  stranger = client(api.base);
  pilot = client(api.base);
  for (const [c, sub, email] of [
    [owner, 'o', 'owner@example.com'],
    [editor, 'e', 'editor@example.com'],
    [viewer, 'v', 'viewer@example.com'],
    [stranger, 's', 'stranger@example.com'],
    [pilot, 'p', 'pilot@example.com'],
  ] as const) {
    expect((await c.login(`sub-${sub}`, email)).status).toBe(200);
    ids[sub] = (await c.call('GET', 'me')).body.id;
  }
});
afterAll(() => api.close());

describe('operators', () => {
  let op: OperatorItem;
  beforeAll(async () => {
    const r = await owner.call<OperatorItem>('POST', 'operators', { name: 'Aeroclub Test', phone: '+30 210 0000000' });
    expect(r.status).toBe(201);
    op = r.body;
    expect(
      (await owner.call('POST', `operators/${op.id}/shares`, { email: 'editor@example.com', role: 'edit' })).status,
    ).toBe(201);
    expect(
      (await owner.call('POST', `operators/${op.id}/shares`, { email: 'VIEWER@example.com', role: 'view' })).status,
    ).toBe(201);
  });

  test('validation: a name; the declarations e-mail when they are required', async () => {
    expect((await owner.call('POST', 'operators', {})).status).toBe(400);
    expect((await owner.call('POST', 'operators', { name: 'X', requiresWbPerf: true })).status).toBe(400);
    expect((await owner.call('POST', 'operators', { name: 'X', declarationsEmail: 'not an address' })).status).toBe(
      400,
    );
    expect((await owner.call('POST', 'operators', { name: 'X', requiresFplCopy: true })).status).toBe(400);
    expect((await owner.call('POST', 'operators', { name: 'X', requiresFplCopy: 'yes' })).status).toBe(400);
    const r = await owner.call('POST', 'operators', {
      name: 'Copies Club',
      requiresFplCopy: true,
      fplCopyEmail: 'ops@copies.example',
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ requiresFplCopy: true, fplCopyEmail: 'ops@copies.example' });
  });

  test('access matrix', async () => {
    expect(op.access.role).toBe('owner');
    for (const [c, role] of [
      [editor, 'edit'],
      [viewer, 'view'],
    ] as const) {
      const g = await c.call<OperatorItem>('GET', `operators/${op.id}`);
      expect(g.status).toBe(200);
      expect(g.body.access.role).toBe(role);
      expect((await c.call<OperatorItem[]>('GET', 'operators')).body.map((o) => o.id)).toContain(op.id);
    }
    expect((await stranger.call('GET', `operators/${op.id}`)).status).toBe(404);
    expect((await stranger.call<OperatorItem[]>('GET', 'operators')).body).toEqual([]);
    // editors change it and its sharing; viewers do not; only the owner deletes
    expect((await editor.call('PUT', `operators/${op.id}`, { address: 'Tatoi' })).body.address).toBe('Tatoi');
    expect((await viewer.call('PUT', `operators/${op.id}`, { address: 'x' })).status).toBe(403);
    expect((await stranger.call('PUT', `operators/${op.id}`, { address: 'x' })).status).toBe(404);
    expect(
      (await viewer.call('POST', `operators/${op.id}/shares`, { email: 'stranger@example.com', role: 'view' })).status,
    ).toBe(403);
    expect((await editor.call('DELETE', `operators/${op.id}`)).status).toBe(403);
    expect((await viewer.call('DELETE', `operators/${op.id}`)).status).toBe(403);
    expect((await stranger.call('DELETE', `operators/${op.id}`)).status).toBe(404);
    // documents: viewers read, editors upload
    const data = Buffer.from('%PDF-1.4 ops manual').toString('base64');
    expect(
      (
        await viewer.call('POST', `operators/${op.id}/files`, {
          kind: 'document',
          name: 'om.pdf',
          mime: 'application/pdf',
          size: 19,
        })
      ).status,
    ).toBe(403);
    const f = (
      await editor.call('POST', `operators/${op.id}/files`, {
        kind: 'document',
        name: 'om.pdf',
        title: 'Operations manual',
        mime: 'application/pdf',
        size: 19,
      })
    ).body;
    expect((await editor.call('PUT', `operators/${op.id}/files/${f.id}/chunks/0`, { data })).status).toBe(204);
    expect((await editor.call('POST', `operators/${op.id}/files/${f.id}/complete`, {})).status).toBe(200);
    expect((await viewer.call('GET', `operators/${op.id}/files`)).body.documents.map((d: any) => d.title)).toEqual([
      'Operations manual',
    ]);
    expect((await viewer.call('GET', `operators/${op.id}/files/${f.id}/chunks/0`)).body.data).toBe(data);
    expect((await stranger.call('GET', `operators/${op.id}/files`)).status).toBe(404);
    expect(
      (
        await owner.call('POST', `operators/${op.id}/files`, {
          kind: 'photo',
          name: 'p.jpg',
          mime: 'image/jpeg',
          size: 10,
        })
      ).status,
    ).toBe(400);
  });

  test('an aircraft is assigned to an operator its pilot can edit, and carries its name', async () => {
    expect((await viewer.call('POST', 'aircraft', aircraftBody('SX-VWR', op.id))).status).toBe(403);
    expect((await stranger.call('POST', 'aircraft', aircraftBody('SX-STR', op.id))).status).toBe(404);
    const ac = (await owner.call<HangarAircraft>('POST', 'aircraft', aircraftBody('SX-OPR', op.id))).body;
    expect(ac).toMatchObject({ operatorId: op.id, operator: 'Aeroclub Test' });
    // a rename shows everywhere the aircraft is read
    await owner.call('PUT', `operators/${op.id}`, { name: 'Aeroclub Renamed' });
    expect((await owner.call<HangarAircraft>('GET', `aircraft/${ac.id}`)).body.operator).toBe('Aeroclub Renamed');
    // the operator lists the pilot's aircraft
    expect((await owner.call<OperatorItem>('GET', `operators/${op.id}`)).body.aircraft).toEqual([
      { id: ac.id, registration: 'SX-OPR' },
    ]);
    // deleting the operator keeps its name on the aircraft as text
    const tmp = (await owner.call<OperatorItem>('POST', 'operators', { name: 'Short Lived' })).body;
    const ac2 = (await owner.call<HangarAircraft>('POST', 'aircraft', aircraftBody('SX-TMP', tmp.id))).body;
    expect((await owner.call('DELETE', `operators/${tmp.id}`)).status).toBe(204);
    expect((await owner.call<HangarAircraft>('GET', `aircraft/${ac2.id}`)).body).toMatchObject({
      operatorId: null,
      operator: 'Short Lived',
    });
  });

  test('sharing an aircraft shares its operator (view) until the aircraft share ends', async () => {
    const own = (await owner.call<OperatorItem>('POST', 'operators', { name: 'Via Aircraft Club' })).body;
    const ac = (await owner.call<HangarAircraft>('POST', 'aircraft', aircraftBody('SX-VIA', own.id))).body;
    expect((await pilot.call('GET', `operators/${own.id}`)).status).toBe(404);
    expect(
      (await owner.call('POST', `aircraft/${ac.id}/shares`, { email: 'pilot@example.com', role: 'edit' })).status,
    ).toBe(201);
    const seen = await pilot.call<OperatorItem>('GET', `operators/${own.id}`);
    expect(seen.status).toBe(200);
    expect(seen.body.access).toMatchObject({ role: 'view', viaAircraft: ['SX-VIA'] });
    expect((await pilot.call('PUT', `operators/${own.id}`, { phone: '1' })).status).toBe(403);
    // the aircraft editor keeps the operator on the aircraft, but cannot assign one they only view to another aircraft
    expect((await pilot.call('PUT', `aircraft/${ac.id}`, { colours: 'RED' })).body.operatorId).toBe(own.id);
    expect((await pilot.call('POST', 'aircraft', aircraftBody('SX-MIN', own.id))).status).toBe(403);
    // who has access: the owner, then the pilot through the aircraft
    const s = (await owner.call<OperatorSharing>('GET', `operators/${own.id}/shares`)).body;
    expect(s.people.map((p) => [p.email, p.role, p.direct, p.via])).toEqual([
      ['owner@example.com', 'owner', true, ['SX-VIA']],
      ['pilot@example.com', 'view', false, ['SX-VIA']],
    ]);
    // shared directly too: revoking the aircraft keeps the operator
    expect(
      (await owner.call('POST', `operators/${own.id}/shares`, { email: 'pilot@example.com', role: 'view' })).status,
    ).toBe(201);
    expect((await owner.call('DELETE', `aircraft/${ac.id}/shares/${ids.p}`)).status).toBe(204);
    expect((await pilot.call('GET', `operators/${own.id}`)).body.access).toMatchObject({
      role: 'view',
      viaAircraft: [],
    });
    // without the direct share, it is gone with the aircraft
    expect((await owner.call('DELETE', `operators/${own.id}/shares/${ids.p}`)).status).toBe(204);
    expect((await pilot.call('GET', `operators/${own.id}`)).status).toBe(404);
    expect((await pilot.call<OperatorItem[]>('GET', 'operators')).body.map((o) => o.id)).not.toContain(own.id);
    // a viewer may remove themselves; nobody removes the owner
    expect((await owner.call('DELETE', `operators/${own.id}/shares/${ids.o}`)).status).toBe(400);
  });

  test('the GenDec prints the linked operator', async () => {
    const o = (await owner.call<OperatorItem>('POST', 'operators', { name: 'GENDEC OPERATOR' })).body;
    const ac = (await owner.call<HangarAircraft>('POST', 'aircraft', aircraftBody('SX-GDO', o.id))).body;
    await owner.call('PUT', 'me', { fullName: 'Olga Owner', phone: '+30 690' });
    const f = (await owner.call('POST', 'flights', { aircraftId: ac.id })).body;
    expect((await owner.call('GET', `flights/${f.id}/forms`)).body.gendec.content.operator).toBe('GENDEC OPERATOR');
  });
});

// ---------------------------------------------------------------- W&B and performance to the operator

const sent: SentMail[] = [];
afterEach(() => setMailTransport(null));
const content = (mass = '1040.2'): WbPerfContent =>
  wbPerfContentOf({
    registration: 'SX-DCL',
    makeModel: 'Reims F172M',
    operator: 'Declarations Club',
    date: '2026-11-20',
    pilot: 'Olga Owner',
    route: 'LGTT – LGSY',
    category: 'Normal',
    wb: {
      verdict: 'pass',
      verdictText: 'Within limits (normal category)',
      rows: [
        {
          kind: 'line',
          label: 'Corrected empty weight',
          note: '',
          mass: '691.2',
          arm: '0.995',
          moment: '687.74',
          over: false,
        },
      ],
      totals: [
        {
          kind: 'total',
          label: 'Total at take-off',
          note: 'MTOW 1043 kg',
          mass,
          arm: '1.010',
          moment: '1050.60',
          over: false,
        },
      ],
      checks: [{ label: 'Take-off', ok: true, text: `${mass} kg · CG 1.010 m`, categories: 'Normal: within' }],
      chart: {
        envelopes: [
          {
            label: 'Normal category',
            outline: [
              [600, 700],
              [1100, 1043],
              [1200, 1043],
              [800, 700],
            ],
            cgOutline: null,
          },
        ],
        points: [{ label: 'T/O', moment: 1050, mass: 1040, ok: true }],
      },
      limits: ['MTOW 1043 kg'],
      weighing: 'Weighing 2024',
      note: 'Arm of a total = centre of gravity.',
    },
    perf: {
      verdict: 'pass',
      verdictText: 'Within limits',
      pages: [
        {
          label: '',
          speeds: 'Vx 60 kt',
          takeoff: {
            title: 'Departure',
            aerodrome: 'LGTT',
            time: 'Take-off 09:15Z',
            rows: [{ label: 'TODR', value: '420 m', note: 'x1.33', status: 'ok' }],
            verdict: 'pass',
            verdictText: 'ok',
            weather: 'METAR',
            metar: 'LGTT 150850Z',
          },
          landing: {
            title: 'Destination',
            aerodrome: 'LGSY',
            time: 'Landing 10:00Z',
            rows: [],
            verdict: 'pass',
            verdictText: 'ok',
            weather: '',
            metar: '',
          },
        },
      ],
      factors: [{ label: 'Paved, dry', factor: '1.00' }],
      slopeRule: '',
      notes: [],
    },
  });

describe('W&B and performance sent to the operator', () => {
  test('only when the operator asks; once per version; re-send; the pilot in cc', async () => {
    setMailTransport(async (m) => {
      sent.push(m);
      return { id: `m-${sent.length}` };
    });
    const o = (await owner.call<OperatorItem>('POST', 'operators', { name: 'Declarations Club' })).body;
    const ac = (await owner.call<HangarAircraft>('POST', 'aircraft', aircraftBody('SX-DCL', o.id))).body;
    const f = (
      await owner.call('POST', 'flights', {
        aircraftId: ac.id,
        date: tomorrow,
        route: [pt('LGTT', 'a'), pt('LGSY', 'b')],
      })
    ).body;
    const db = (await api.server.ready).db;
    /** The 10-minute pause between two sends of a flight's form, passed. */
    const later = () => db.query('UPDATE mail_log SET at = at - 660000 WHERE flight_id = $1', [f.id]);
    let st = (await owner.call<DeclarationsState>('GET', `flights/${f.id}/declarations`)).body;
    expect(st).toMatchObject({
      operator: { id: o.id, name: 'Declarations Club', requiresWbPerf: false },
      submission: null,
      emailEnabled: true,
    });
    expect((await owner.call('POST', `flights/${f.id}/declarations/send`, { content: content() })).status).toBe(409);

    await owner.call('PUT', `operators/${o.id}`, { requiresWbPerf: true, declarationsEmail: 'ops@club.example' });
    expect((await owner.call('POST', `flights/${f.id}/declarations/send`, { content: 'x' })).status).toBe(400);
    const r = await owner.call<DeclarationsState>('POST', `flights/${f.id}/declarations/send`, { content: content() });
    expect(r.status).toBe(200);
    expect(r.body.submission).toMatchObject({ to: 'ops@club.example', hash: wbPerfHash(content()), messageId: 'm-1' });
    const m = sent[sent.length - 1];
    expect(m.to).toEqual(['ops@club.example']);
    expect(m.cc).toEqual(['owner@example.com']);
    // subject and body from the server's records, not the client's content
    expect(m.subject).toBe(`W&B and performance · SX-DCL · ${tomorrow} · LGTT–LGSY`);
    expect(m.text).toContain(`for the flight of SX-DCL on ${tomorrow}, LGTT – LGSY, attached as PDF.`);
    expect(m.attachments?.[0].content.subarray(0, 5).toString()).toBe('%PDF-');
    expect(m.attachments?.[0].filename).toMatch(/^WB_Performance_SXDCL_\d{4}-\d{2}-\d{2}\.pdf$/);

    // the same version again: refused unless re-sent; a changed version goes
    expect((await owner.call('POST', `flights/${f.id}/declarations/send`, { content: content() })).status).toBe(409);
    const soon = await owner.call('POST', `flights/${f.id}/declarations/send`, { content: content(), resend: true });
    expect(soon.status).toBe(429);
    expect(soon.body.error).toMatch(/less than 10 minutes ago/);
    await later();
    expect(
      (await owner.call('POST', `flights/${f.id}/declarations/send`, { content: content(), resend: true })).status,
    ).toBe(200);
    await later();
    st = (
      await owner.call<DeclarationsState>('POST', `flights/${f.id}/declarations/send`, { content: content('1001.0') })
    ).body;
    expect(st.submission?.hash).toBe(wbPerfHash(content('1001.0')));
    expect(sent.length).toBe(3);
    // what the client sends cannot reach the subject or the body
    await later();
    const evil = {
      ...content('1002.0'),
      registration: 'ACT NOW',
      route: 'Verify at https://evil.example/login',
      wb: { ...content().wb, verdictText: 'Click evil.example/x or mail a@b.example' },
    };
    expect((await owner.call('POST', `flights/${f.id}/declarations/send`, { content: evil })).status).toBe(200);
    const e = sent[sent.length - 1];
    expect(e.subject).toBe(`W&B and performance · SX-DCL · ${tomorrow} · LGTT–LGSY`);
    expect(`${e.subject}\n${e.text}`).not.toMatch(/evil|ACT NOW|Verify|a@b/);
    // the log has every send, the refused one as capped
    const log = await db.query(
      `SELECT result, recipient, subject, message_id FROM mail_log WHERE flight_id = $1 ORDER BY at`,
      [f.id],
    );
    expect(log.map((l: any) => l.result).sort()).toEqual(['capped', 'sent', 'sent', 'sent', 'sent']);
    expect(log.find((l: any) => l.result === 'sent')).toMatchObject({
      recipient: 'ops@club.example',
      subject: `W&B and performance · SX-DCL · ${tomorrow} · LGTT–LGSY`,
    });
    // another pilot's flight is not found
    expect((await stranger.call('GET', `flights/${f.id}/declarations`)).status).toBe(404);
  });
});
