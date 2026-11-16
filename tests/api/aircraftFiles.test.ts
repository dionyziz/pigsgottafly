// Aircraft photo and documents (api/_lib/routes/files.ts): chunked upload and download (a POH is
// larger than a serverless request or response), one photo per aircraft, access by sharing role,
// and that saving the aircraft never deletes them (only unreferenced swing reports go).
import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { client, startApi, type Client } from './helpers';
import { fleetSeed } from '../../tools/build_seed';
import { AIRCRAFT_FILE_CHUNK_BYTES } from '../../src/shared/types';

let api: Awaited<ReturnType<typeof startApi>>;
let owner: Client, viewer: Client, stranger: Client;
let acId = '';
beforeAll(async () => {
  api = await startApi();
  owner = client(api.base);
  viewer = client(api.base);
  stranger = client(api.base);
  expect((await owner.login('sub-own', 'own@example.com')).status).toBe(200);
  expect((await viewer.login('sub-view', 'view@example.com')).status).toBe(200);
  expect((await stranger.login('sub-str', 'str@example.com')).status).toBe(200);
  acId = (await owner.call('POST', 'aircraft', fleetSeed()[0])).body.id;
  expect((await owner.call('POST', `aircraft/${acId}/shares`, { email: 'view@example.com', role: 'view' })).status).toBe(201);
});
afterAll(() => api.close());

async function upload(c: Client, bytes: Buffer, meta: Record<string, unknown>) {
  const start = await c.call('POST', `aircraft/${acId}/files`, { ...meta, size: bytes.length });
  if (start.status !== 201) return start;
  for (let seq = 0; seq < start.body.chunks; seq++) {
    const part = bytes.subarray(seq * AIRCRAFT_FILE_CHUNK_BYTES, (seq + 1) * AIRCRAFT_FILE_CHUNK_BYTES);
    const r = await c.call('PUT', `aircraft/${acId}/files/${start.body.id}/chunks/${seq}`, { data: part.toString('base64') });
    expect(r.status).toBe(204);
  }
  return c.call('POST', `aircraft/${acId}/files/${start.body.id}/complete`);
}
async function download(c: Client, f: { id: string; chunks: number }) {
  const parts: Buffer[] = [];
  for (let seq = 0; seq < f.chunks; seq++) {
    const r = await c.call('GET', `aircraft/${acId}/files/${f.id}/chunks/${seq}`);
    expect(r.status).toBe(200);
    parts.push(Buffer.from(r.body.data, 'base64'));
  }
  return Buffer.concat(parts);
}

/** `size` random bytes starting with the type's magic bytes (files.ts checks them). */
const withHead = (head: string, size: number) => Buffer.concat([Buffer.from(head, 'latin1'), crypto.randomBytes(size - head.length)]);

describe('aircraft documents and photo', () => {
  const poh = withHead('%PDF-1.4\n', 2 * AIRCRAFT_FILE_CHUNK_BYTES + 12345); // three chunks, the last one short

  test('a POH larger than one request goes up in chunks and comes back identical; viewers read it', async () => {
    const r = await upload(owner, poh, { kind: 'document', name: 'F172M_POH.pdf', title: 'POH', mime: 'application/pdf' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ kind: 'document', title: 'POH', name: 'F172M_POH.pdf', size: poh.length, chunks: 3 });
    const list = (await viewer.call('GET', `aircraft/${acId}/files`)).body;
    expect(list.documents.map((d: any) => d.title)).toEqual(['POH']);
    expect((await download(viewer, list.documents[0])).equals(poh)).toBe(true);
  });

  test('chunks are checked; an incomplete upload is not listed and cannot complete', async () => {
    const start = (await owner.call('POST', `aircraft/${acId}/files`, { kind: 'document', name: 'w.pdf', title: 'Weighing', mime: 'application/pdf', size: AIRCRAFT_FILE_CHUNK_BYTES + 10 })).body;
    expect((await owner.call('PUT', `aircraft/${acId}/files/${start.id}/chunks/0`, { data: Buffer.alloc(10).toString('base64') })).status).toBe(400);
    expect((await owner.call('PUT', `aircraft/${acId}/files/${start.id}/chunks/2`, { data: Buffer.alloc(10).toString('base64') })).status).toBe(400);
    expect((await owner.call('PUT', `aircraft/${acId}/files/${start.id}/chunks/1`, { data: 'not base64!' })).status).toBe(400);
    expect((await owner.call('PUT', `aircraft/${acId}/files/${start.id}/chunks/1`, { data: Buffer.alloc(10).toString('base64') })).status).toBe(204);
    expect((await owner.call('POST', `aircraft/${acId}/files/${start.id}/complete`)).status).toBe(400);
    expect((await owner.call('GET', `aircraft/${acId}/files/${start.id}/chunks/1`)).status).toBe(404);
    expect((await owner.call('GET', `aircraft/${acId}/files`)).body.documents.map((d: any) => d.title)).toEqual(['POH']);
  });

  test('wrong kinds, types and sizes are refused', async () => {
    const bad = [
      { kind: 'video', name: 'x', mime: 'application/pdf', size: 10 },
      { kind: 'document', name: 'x.exe', mime: 'application/octet-stream', size: 10 },
      { kind: 'photo', name: 'x.pdf', mime: 'application/pdf', size: 10 },
      { kind: 'document', name: 'x.pdf', mime: 'application/pdf', size: 0 },
      { kind: 'document', name: 'x.pdf', mime: 'application/pdf', size: 500 * 1024 * 1024 },
      { kind: 'photo', name: 'x.jpg', mime: 'image/jpeg', size: 50 * 1024 * 1024 },
    ];
    for (const b of bad) expect((await owner.call('POST', `aircraft/${acId}/files`, b)).status, JSON.stringify(b)).toBe(400);
  });

  test('viewers cannot add, rename or remove; strangers see nothing', async () => {
    const doc = (await owner.call('GET', `aircraft/${acId}/files`)).body.documents[0];
    expect((await viewer.call('POST', `aircraft/${acId}/files`, { kind: 'document', name: 'v.pdf', mime: 'application/pdf', size: 10 })).status).toBe(403);
    expect((await viewer.call('PUT', `aircraft/${acId}/files/${doc.id}`, { title: 'Mine' })).status).toBe(403);
    expect((await viewer.call('DELETE', `aircraft/${acId}/files/${doc.id}`)).status).toBe(403);
    expect((await stranger.call('GET', `aircraft/${acId}/files`)).status).toBe(404);
    expect((await stranger.call('GET', `aircraft/${acId}/files/${doc.id}/chunks/0`)).status).toBe(404);
    expect((await owner.call('PUT', `aircraft/${acId}/files/${doc.id}`, { title: 'POH (1972)' })).body.title).toBe('POH (1972)');
  });

  test('one photo per aircraft: a new one replaces the old; the aircraft list carries it', async () => {
    const a = withHead('\xff\xd8\xff\xe0', 1000), b = withHead('\xff\xd8\xff\xe0', 2000);
    const p1 = (await upload(owner, a, { kind: 'photo', name: 'a.jpg', mime: 'image/jpeg' })).body;
    const p2 = (await upload(owner, b, { kind: 'photo', name: 'b.jpg', mime: 'image/jpeg' })).body;
    expect((await owner.call('GET', `aircraft/${acId}/files`)).body.photo).toEqual(p2);
    expect((await owner.call('GET', `aircraft/${acId}/files/${p1.id}/chunks/0`)).status).toBe(404);
    const listed = (await viewer.call('GET', 'aircraft')).body.find((x: any) => x.id === acId);
    expect(listed.photo).toEqual(p2);
    expect((await viewer.call('GET', `aircraft/${acId}`)).body.photo).toEqual(p2);
    expect((await download(viewer, p2)).equals(b)).toBe(true);
  });

  test('saving the aircraft keeps photo and documents (only unreferenced swing reports are removed)', async () => {
    const ac = (await owner.call('GET', `aircraft/${acId}`)).body;
    const report = await owner.call('POST', `aircraft/${acId}/attachments`, { name: 'swing.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-1.4').toString('base64') });
    expect(report.status).toBe(201);
    const { id: _i, created: _c, updated: _u, access: _a, photo: _p, ...input } = ac;
    expect((await owner.call('PUT', `aircraft/${acId}`, input)).status).toBe(200);
    const files = (await owner.call('GET', `aircraft/${acId}/files`)).body;
    expect(files.photo).not.toBeNull();
    expect(files.documents).toHaveLength(1);
    expect((await owner.call('GET', `aircraft/${acId}/attachments/${report.body.id}`)).status).toBe(404); // the unreferenced report went
    // the document routes do not serve swing reports, nor the report routes documents
    expect((await owner.call('GET', `aircraft/${acId}/attachments/${files.documents[0].id}`)).status).toBe(404);
  });

  test('removing a document; deleting the aircraft removes its files', async () => {
    const doc = (await owner.call('GET', `aircraft/${acId}/files`)).body.documents[0];
    expect((await owner.call('DELETE', `aircraft/${acId}/files/${doc.id}`)).status).toBe(204);
    expect((await owner.call('GET', `aircraft/${acId}/files`)).body.documents).toEqual([]);
    expect((await owner.call('DELETE', `aircraft/${acId}`)).status).toBe(204);
    expect((await owner.call('GET', `aircraft/${acId}/files`)).status).toBe(404);
  });
});
