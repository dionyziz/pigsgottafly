// The pilot's licence and medical certificate (api/_lib/routes/files.ts, /pilots/:id/files): one PDF
// of each kind, chunked like the aircraft documents; a new one replaces the old; only the pilot
// themselves sees or changes them (404 for any other pilot, 401 signed out); they count towards the
// storage quota; deleting the account deletes them.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import type { Db } from '../../api/_lib/db';
import { AIRCRAFT_FILE_CHUNK_BYTES, DOCUMENT_MAX_BYTES } from '../../src/shared/types';
import { type Client, client, startApi } from './helpers';

let api: Awaited<ReturnType<typeof startApi>>;
let db: Db;
let me: Client, other: Client;
let myId = '',
  otherId = '';
beforeAll(async () => {
  api = await startApi();
  db = (await api.server.ready).db;
  me = client(api.base);
  other = client(api.base);
  expect((await me.login('sub-pf-me', 'pf-me@example.com')).status).toBe(200);
  expect((await other.login('sub-pf-other', 'pf-other@example.com')).status).toBe(200);
  myId = (await me.call('GET', 'me')).body.id;
  otherId = (await other.call('GET', 'me')).body.id;
});
afterAll(() => api.close());

const pdf = (size: number, fill = 0x20) => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(size - 9, fill)]);
const at = (id: string) => `pilots/${id}/files`;

async function upload(c: Client, id: string, bytes: Buffer, meta: Record<string, unknown>) {
  const start = await c.call('POST', at(id), { mime: 'application/pdf', ...meta, size: bytes.length });
  if (start.status !== 201) return start;
  for (let seq = 0; seq < start.body.chunks; seq++) {
    const part = bytes.subarray(seq * AIRCRAFT_FILE_CHUNK_BYTES, (seq + 1) * AIRCRAFT_FILE_CHUNK_BYTES);
    const r = await c.call('PUT', `${at(id)}/${start.body.id}/chunks/${seq}`, { data: part.toString('base64') });
    expect(r.status).toBe(204);
  }
  return c.call('POST', `${at(id)}/${start.body.id}/complete`);
}

describe('licence and medical', () => {
  const licence = pdf(AIRCRAFT_FILE_CHUNK_BYTES + 777, 0x41); // two chunks
  let licenceId = '';

  test('none at first; a licence goes up in chunks and comes back identical', async () => {
    expect((await me.call('GET', at(myId))).body).toEqual({ licence: null, medical: null });
    const r = await upload(me, myId, licence, { kind: 'licence', name: 'EL.FCL.6094.pdf' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ kind: 'licence', name: 'EL.FCL.6094.pdf', size: licence.length, chunks: 2 });
    licenceId = r.body.id;
    const list = (await me.call('GET', at(myId))).body;
    expect(list.licence).toMatchObject({ id: licenceId });
    expect(list.medical).toBeNull();
    const parts: Buffer[] = [];
    for (let seq = 0; seq < 2; seq++)
      parts.push(Buffer.from((await me.call('GET', `${at(myId)}/${licenceId}/chunks/${seq}`)).body.data, 'base64'));
    expect(Buffer.concat(parts).equals(licence)).toBe(true);
  });

  test('a new licence replaces the old; the medical is kept apart', async () => {
    const med = await upload(me, myId, pdf(2000), { kind: 'medical', name: 'class2.pdf' });
    expect(med.status).toBe(200);
    const again = await upload(me, myId, pdf(3000), { kind: 'licence', name: 'renewed.pdf' });
    expect(again.status).toBe(200);
    const list = (await me.call('GET', at(myId))).body;
    expect([list.licence.name, list.medical.name]).toEqual(['renewed.pdf', 'class2.pdf']);
    expect((await me.call('GET', `${at(myId)}/${licenceId}/chunks/0`)).status).toBe(404);
    const [{ n }] = await db.query('SELECT count(*)::int AS n FROM pilot_files WHERE pilot_id = $1', [myId]);
    expect(n).toBe(2);
  });

  test('only PDFs, only these kinds, within the size limit, of the declared type', async () => {
    const start = (b: Record<string, unknown>) =>
      me.call('POST', at(myId), { kind: 'licence', name: 'x.pdf', mime: 'application/pdf', size: 1000, ...b });
    expect((await start({ mime: 'image/png' })).status).toBe(400);
    expect((await start({ kind: 'document' })).status).toBe(400);
    expect((await start({ kind: 'photo', mime: 'image/jpeg' })).status).toBe(400);
    const big = await start({ size: DOCUMENT_MAX_BYTES + 1 });
    expect(big.status).toBe(400);
    expect(big.body.error).toMatch(/larger than/);
    const bad = Buffer.from('hello, not a pdf');
    const s = await start({ kind: 'medical', size: bad.length });
    expect(s.status).toBe(201);
    const notPdf = await me.call('PUT', `${at(myId)}/${s.body.id}/chunks/0`, { data: bad.toString('base64') });
    expect(notPdf.status).toBe(400);
    expect(notPdf.body.error).toMatch(/not a PDF/);
    expect((await me.call('POST', `${at(myId)}/${s.body.id}/complete`)).status).toBe(400);
  });

  test("another pilot's files are not found; signed out is 401", async () => {
    const list = (await me.call('GET', at(myId))).body;
    const f = list.medical;
    expect((await other.call('GET', at(myId))).status).toBe(404);
    expect((await other.call('GET', `${at(myId)}/${f.id}/chunks/0`)).status).toBe(404);
    expect((await other.call('DELETE', `${at(myId)}/${f.id}`)).status).toBe(404);
    expect(
      (await other.call('POST', at(myId), { kind: 'licence', name: 'x.pdf', mime: 'application/pdf', size: 100 }))
        .status,
    ).toBe(404);
    // nor through their own id
    expect((await other.call('GET', `${at(otherId)}/${f.id}/chunks/0`)).status).toBe(404);
    expect((await other.call('DELETE', `${at(otherId)}/${f.id}`)).status).toBe(404);
    const anon = client(api.base);
    expect((await anon.call('GET', at(myId))).status).toBe(401);
    expect((await anon.call('GET', `${at(myId)}/${f.id}/chunks/0`)).status).toBe(401);
    expect((await anon.call('DELETE', `${at(myId)}/${f.id}`)).status).toBe(401);
    expect((await me.call('GET', at(myId))).body.medical).toMatchObject({ id: f.id });
  });

  test('removing one', async () => {
    const { medical } = (await me.call('GET', at(myId))).body;
    expect((await me.call('DELETE', `${at(myId)}/${medical.id}`)).status).toBe(204);
    expect((await me.call('GET', at(myId))).body.medical).toBeNull();
    expect((await me.call('DELETE', `${at(myId)}/${medical.id}`)).status).toBe(404);
    const [{ n }] = await db.query('SELECT count(*)::int AS n FROM pilot_file_chunks WHERE attachment_id = $1', [
      medical.id,
    ]);
    expect(n).toBe(0);
  });

  test('they count towards the storage quota', async () => {
    const prev = process.env.STORAGE_QUOTA_MB;
    process.env.STORAGE_QUOTA_MB = '3';
    try {
      const r = await other.call('POST', at(otherId), {
        kind: 'licence',
        name: 'x.pdf',
        mime: 'application/pdf',
        size: 2 * 1048576,
      });
      expect(r.status).toBe(201);
      const ac = (await other.call('POST', 'aircraft', { registration: 'SX-PFQ' })).body;
      const over = await other.call('POST', `aircraft/${ac.id}/files`, {
        kind: 'document',
        name: 'poh.pdf',
        mime: 'application/pdf',
        size: 2 * 1048576,
      });
      expect(over.status).toBe(413);
    } finally {
      if (prev === undefined) delete process.env.STORAGE_QUOTA_MB;
      else process.env.STORAGE_QUOTA_MB = prev;
    }
  });

  test('deleting the account deletes them', async () => {
    expect((await me.call('DELETE', 'me', { confirm: 'pf-me@example.com' })).status).toBe(200);
    const [{ n }] = await db.query('SELECT count(*)::int AS n FROM pilot_files WHERE pilot_id = $1', [myId]);
    const [{ c }] = await db.query('SELECT count(*)::int AS c FROM pilot_file_chunks');
    expect([n, c]).toEqual([0, 0]);
  });
});
