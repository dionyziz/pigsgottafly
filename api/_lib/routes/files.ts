// Aircraft photo and documents: /aircraft/:id/files[/:fileId[/chunks/:seq | /complete]].
// Anyone the aircraft is shared with lists and reads them; editors and the owner add, rename and
// remove them (403 for viewers); everyone else gets 404. Content travels in chunks of
// AIRCRAFT_FILE_CHUNK_BYTES (base64 in JSON), so a 40 MB POH never needs a request or response
// above the serverless limits:
//   POST   /aircraft/:id/files                     AircraftFileStart → 201 AircraftFile (incomplete)
//   PUT    /aircraft/:id/files/:fileId/chunks/:seq { data } → 204 (every chunk full size but the last)
//   POST   /aircraft/:id/files/:fileId/complete    → AircraftFile (a new photo replaces the old one)
//   GET    /aircraft/:id/files                     → AircraftFiles (complete files only)
//   GET    /aircraft/:id/files/:fileId/chunks/:seq → { data }
//   PUT    /aircraft/:id/files/:fileId             { title } → AircraftFile
//   DELETE /aircraft/:id/files/:fileId             → 204
import type { Route } from '../http.js';
import { badRequest, HttpError, newId, notFound, reply } from '../http.js';
import type { Queryable } from '../db.js';
import { aircraftFor } from '../access.js';
import {
  AIRCRAFT_FILE_CHUNK_BYTES, DOCUMENT_MAX_BYTES, DOCUMENT_TYPES, PHOTO_MAX_BYTES, PHOTO_TYPES,
  type AircraftFile, type AircraftFileKind, type AircraftFiles,
} from '../../../src/shared/types.js';

const COLS = 'id, kind, title, name, mime, size, chunks, created';
/** An upload that has not completed after this long is abandoned (deleted on the next upload). */
const INCOMPLETE_UPLOAD_TTL_MS = 24 * 3600e3;
const MIB = 1024 * 1024;
export const toFile = (r: any): AircraftFile => ({
  id: r.id, kind: r.kind, title: r.title ?? '', name: r.name, mime: r.mime, size: Number(r.size), chunks: Number(r.chunks), uploaded: Number(r.created),
});

/** SQL: the aircraft's current photo as JSON (for the aircraft list), given the aircraft alias. */
export const photoJsonSql = (alias: string) => `(SELECT json_build_object('id', f.id, 'kind', f.kind, 'title', f.title, 'name', f.name, 'mime', f.mime,
  'size', f.size, 'chunks', f.chunks, 'created', f.created) FROM aircraft_attachments f
  WHERE f.aircraft_id = ${alias}.id AND f.kind = 'photo' AND f.complete ORDER BY f.created DESC LIMIT 1)`;

const cleanText = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '');
const chunkCount = (size: number) => Math.max(1, Math.ceil(size / AIRCRAFT_FILE_CHUNK_BYTES));

async function fileRow(db: Queryable, owner: string, aircraftId: string, fileId: string) {
  const [r] = await db.query(`SELECT ${COLS}, complete FROM aircraft_attachments WHERE id = $1 AND aircraft_id = $2 AND pilot_id = $3 AND kind IN ('photo', 'document')`,
    [fileId, aircraftId, owner]);
  if (!r) throw notFound('no such file');
  return r;
}

/** Base64 → its decoded byte length; 400 if it is not base64. */
function base64Bytes(v: unknown): { data: string; size: number } {
  if (typeof v !== 'string' || !v) throw badRequest('data (base64) is required');
  const data = v.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 !== 0) throw badRequest('data must be base64');
  return { data, size: (data.length / 4) * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0) };
}

export const routes: Route[] = [
  {
    method: 'GET', path: '/aircraft/:id/files',
    async handler({ db, pilot, params }): Promise<AircraftFiles> {
      const owner = (await aircraftFor(db, pilot.id, params.id, 'view')).pilot_id;
      const rows = await db.query(`SELECT ${COLS} FROM aircraft_attachments WHERE aircraft_id = $1 AND pilot_id = $2 AND complete AND kind IN ('photo', 'document')
        ORDER BY created`, [params.id, owner]);
      const files = rows.map(toFile);
      const photos = files.filter((f) => f.kind === 'photo');
      return { photo: photos[photos.length - 1] ?? null, documents: files.filter((f) => f.kind === 'document') };
    },
  },
  {
    method: 'POST', path: '/aircraft/:id/files',
    async handler({ db, pilot, params, body }) {
      const owner = (await aircraftFor(db, pilot.id, params.id, 'edit')).pilot_id;
      const v = (await body()) as Record<string, unknown>;
      const kind = v.kind as AircraftFileKind;
      if (kind !== 'photo' && kind !== 'document') throw badRequest('kind must be photo or document');
      const types: readonly string[] = kind === 'photo' ? PHOTO_TYPES : DOCUMENT_TYPES;
      if (typeof v.mime !== 'string' || !types.includes(v.mime)) throw badRequest(`mime must be one of ${types.join(', ')}`);
      const max = kind === 'photo' ? PHOTO_MAX_BYTES : DOCUMENT_MAX_BYTES;
      if (typeof v.size !== 'number' || !Number.isInteger(v.size) || v.size <= 0) throw badRequest('size (bytes) is required');
      if (v.size > max) throw badRequest(`the file is larger than ${Math.round(max / MIB)} MB`);
      const name = cleanText(v.name, 200) || (kind === 'photo' ? 'photo' : 'document.pdf');
      const title = kind === 'document' ? cleanText(v.title, 120) || name.replace(/\.pdf$/i, '') : '';
      // uploads that never completed (closed tab, lost connection) go after a day
      await db.query(`DELETE FROM aircraft_attachments WHERE aircraft_id = $1 AND pilot_id = $2 AND NOT complete AND created < $3`,
        [params.id, owner, Date.now() - INCOMPLETE_UPLOAD_TTL_MS]);
      const [r] = await db.query(
        `INSERT INTO aircraft_attachments (id, pilot_id, aircraft_id, name, mime, size, data, created, kind, title, chunks, complete)
         VALUES ($1, $2, $3, $4, $5, $6, '', $7, $8, $9, $10, FALSE) RETURNING ${COLS}`,
        [await newId('file'), owner, params.id, name, v.mime, v.size, Date.now(), kind, title, chunkCount(v.size)],
      );
      return reply(201, toFile(r));
    },
  },
  {
    method: 'PUT', path: '/aircraft/:id/files/:fileId/chunks/:seq',
    async handler({ db, pilot, params, body }) {
      const owner = (await aircraftFor(db, pilot.id, params.id, 'edit')).pilot_id;
      const f = await fileRow(db, owner, params.id, params.fileId);
      if (f.complete) throw new HttpError(409, 'the file is already complete');
      const seq = Number(params.seq);
      if (!Number.isInteger(seq) || seq < 0 || seq >= Number(f.chunks)) throw badRequest(`seq must be 0 … ${Number(f.chunks) - 1}`);
      const { data, size } = base64Bytes(((await body()) as Record<string, unknown>).data);
      const last = seq === Number(f.chunks) - 1;
      const want = last ? Number(f.size) - AIRCRAFT_FILE_CHUNK_BYTES * seq : AIRCRAFT_FILE_CHUNK_BYTES;
      if (size !== want) throw badRequest(`chunk ${seq} must be ${want} bytes`);
      await db.query(`INSERT INTO aircraft_attachment_chunks (attachment_id, seq, size, data) VALUES ($1, $2, $3, $4)
        ON CONFLICT (attachment_id, seq) DO UPDATE SET size = EXCLUDED.size, data = EXCLUDED.data`, [f.id, seq, size, data]);
      return undefined;
    },
  },
  {
    method: 'POST', path: '/aircraft/:id/files/:fileId/complete',
    async handler({ db, pilot, params }) {
      const owner = (await aircraftFor(db, pilot.id, params.id, 'edit')).pilot_id;
      const f = await fileRow(db, owner, params.id, params.fileId);
      const [{ n, bytes }] = await db.query(`SELECT count(*)::int AS n, COALESCE(sum(size), 0)::bigint AS bytes FROM aircraft_attachment_chunks WHERE attachment_id = $1`, [f.id]);
      if (Number(n) !== Number(f.chunks) || Number(bytes) !== Number(f.size)) throw badRequest(`the upload is incomplete (${n} of ${f.chunks} chunks)`);
      return db.transaction(async (tx) => {
        await tx.query('UPDATE aircraft_attachments SET complete = TRUE WHERE id = $1', [f.id]);
        // one photo per aircraft: the new one replaces the old
        if (f.kind === 'photo') await tx.query(`DELETE FROM aircraft_attachments WHERE aircraft_id = $1 AND pilot_id = $2 AND kind = 'photo' AND id <> $3`, [params.id, owner, f.id]);
        await tx.query('UPDATE aircraft SET updated = $2 WHERE id = $1', [params.id, Date.now()]);
        return toFile(f);
      });
    },
  },
  {
    method: 'GET', path: '/aircraft/:id/files/:fileId/chunks/:seq',
    async handler({ db, pilot, params }) {
      const owner = (await aircraftFor(db, pilot.id, params.id, 'view')).pilot_id;
      const f = await fileRow(db, owner, params.id, params.fileId);
      if (!f.complete) throw notFound('no such file');
      const [c] = await db.query('SELECT data FROM aircraft_attachment_chunks WHERE attachment_id = $1 AND seq = $2', [f.id, Number(params.seq)]);
      if (!c) throw notFound('no such chunk');
      return reply(200, { data: c.data }, { 'Cache-Control': 'private, max-age=86400' });
    },
  },
  {
    method: 'PUT', path: '/aircraft/:id/files/:fileId',
    async handler({ db, pilot, params, body }) {
      const owner = (await aircraftFor(db, pilot.id, params.id, 'edit')).pilot_id;
      const f = await fileRow(db, owner, params.id, params.fileId);
      const title = cleanText(((await body()) as Record<string, unknown>).title, 120);
      if (!title && f.kind === 'document') throw badRequest('title is required');
      const [r] = await db.query(`UPDATE aircraft_attachments SET title = $2 WHERE id = $1 RETURNING ${COLS}`, [f.id, title]);
      return toFile(r);
    },
  },
  {
    method: 'DELETE', path: '/aircraft/:id/files/:fileId',
    async handler({ db, pilot, params }) {
      const owner = (await aircraftFor(db, pilot.id, params.id, 'edit')).pilot_id;
      const f = await fileRow(db, owner, params.id, params.fileId);
      await db.query('DELETE FROM aircraft_attachments WHERE id = $1', [f.id]);
      return undefined;
    },
  },
];
