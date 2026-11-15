// Compass swing reports stored with an aircraft: upload, fetch, references from compass cards,
// cleanup of unreferenced files on save, limits and isolation between pilots.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { client, startApi, type Client } from './helpers';
import { blankAircraft } from '../../src/shared/templates';
import { ATTACHMENT_MAX_BYTES, type AttachmentRef, type CompassCard } from '../../src/shared/types';

let api: Awaited<ReturnType<typeof startApi>>;
let a: Client, b: Client;
beforeAll(async () => {
  api = await startApi();
  a = client(api.base);
  b = client(api.base);
  expect((await a.login('sub-a', 'a@example.com')).status).toBe(200);
  expect((await b.login('sub-b', 'b@example.com')).status).toBe(200);
});
afterAll(() => api.close());

const PDF = Buffer.from('%PDF-1.4\n% compass swing report\n%%EOF\n');
const card = (report?: AttachmentRef | null): CompassCard => ({
  name: 'Magnetic compass', swung: '2026-02-05', expires: '2028-02-05', source: '', points: [[0, 1], [90, 91]], ...(report ? { report } : {}),
});
async function newAircraft(c: Client, reg: string): Promise<string> {
  const ac = blankAircraft();
  ac.registration = reg;
  const r = await c.call('POST', 'aircraft', ac);
  expect(r.status).toBe(201);
  return r.body.id;
}

describe('aircraft attachments', () => {
  test('upload, reference from a card, fetch; unreferenced files go on the next save', async () => {
    const id = await newAircraft(a, 'SX-ATT');
    const up = await a.call('POST', `aircraft/${id}/attachments`, { name: 'SXATT_COMPASS_SWING.pdf', mime: 'application/pdf', data: PDF.toString('base64') });
    expect(up.status).toBe(201);
    const ref = up.body as AttachmentRef;
    expect(ref).toMatchObject({ name: 'SXATT_COMPASS_SWING.pdf', mime: 'application/pdf', size: PDF.length });
    expect(ref.id).toMatch(/^file_/);

    const got = await a.call('GET', `aircraft/${id}/attachments/${ref.id}`);
    expect(got.status).toBe(200);
    expect(Buffer.from(got.body.data, 'base64').equals(PDF)).toBe(true);

    // the card keeps the server's metadata, whatever the client claims
    const put = await a.call('PUT', `aircraft/${id}`, { compassCards: [card({ ...ref, name: 'renamed.pdf', size: 1 })] });
    expect(put.status).toBe(200);
    expect(put.body.compassCards[0].report).toEqual(ref);
    expect((await a.call('GET', `aircraft/${id}`)).body.compassCards[0].report).toEqual(ref);

    // a second upload never saved, then a save: only the referenced file stays
    const orphan = (await a.call('POST', `aircraft/${id}/attachments`, { name: 'x.png', mime: 'image/png', data: 'iVBORw0KGgo=' })).body as AttachmentRef;
    expect((await a.call('PUT', `aircraft/${id}`, { notes: 'saved' })).status).toBe(200);
    expect((await a.call('GET', `aircraft/${id}/attachments/${orphan.id}`)).status).toBe(404);
    expect((await a.call('GET', `aircraft/${id}/attachments/${ref.id}`)).status).toBe(200);

    // removing the report from the card deletes the file
    expect((await a.call('PUT', `aircraft/${id}`, { compassCards: [card()] })).status).toBe(200);
    expect((await a.call('GET', `aircraft/${id}/attachments/${ref.id}`)).status).toBe(404);
  });

  test('a card cannot reference a file of another aircraft or pilot; copies drop references', async () => {
    const id1 = await newAircraft(a, 'SX-AA1');
    const id2 = await newAircraft(a, 'SX-AA2');
    const ref = (await a.call('POST', `aircraft/${id1}/attachments`, { name: 'r.pdf', mime: 'application/pdf', data: PDF.toString('base64') })).body as AttachmentRef;
    expect((await a.call('PUT', `aircraft/${id2}`, { compassCards: [card(ref)] })).status).toBe(400);
    const copy = await a.call('POST', 'aircraft', { ...blankAircraft(), registration: 'SX-AA3', compassCards: [card(ref)] });
    expect(copy.status).toBe(201);
    expect(copy.body.compassCards[0].report).toBeUndefined();

    // isolation: pilot b sees nothing of a's files
    expect((await b.call('GET', `aircraft/${id1}/attachments/${ref.id}`)).status).toBe(404);
    expect((await b.call('POST', `aircraft/${id1}/attachments`, { name: 'r.pdf', mime: 'application/pdf', data: PDF.toString('base64') })).status).toBe(404);
    expect((await b.call('DELETE', `aircraft/${id1}/attachments/${ref.id}`)).status).toBe(404);
    const idB = await newAircraft(b, 'SX-BB1');
    expect((await b.call('PUT', `aircraft/${idB}`, { compassCards: [card(ref)] })).status).toBe(400);

    // deleting the aircraft deletes its files
    expect((await a.call('DELETE', `aircraft/${id1}`)).status).toBe(204);
    expect((await a.call('GET', `aircraft/${id1}/attachments/${ref.id}`)).status).toBe(404);
  });

  test('type, encoding and size limits', async () => {
    const id = await newAircraft(a, 'SX-LIM');
    const post = (body: unknown) => a.call('POST', `aircraft/${id}/attachments`, body);
    expect((await post({ name: 'a.exe', mime: 'application/octet-stream', data: 'AAAA' })).status).toBe(400);
    expect((await post({ name: 'a.pdf', mime: 'application/pdf', data: 'not base64!' })).status).toBe(400);
    expect((await post({ name: '', mime: 'application/pdf', data: 'AAAA' })).status).toBe(400);
    expect((await post({ name: 'a.pdf', mime: 'application/pdf', data: '' })).status).toBe(400);
    const big = Buffer.alloc(ATTACHMENT_MAX_BYTES + 3).toString('base64');
    expect((await post({ name: 'big.pdf', mime: 'application/pdf', data: big })).status).toBe(400);
  });
});
