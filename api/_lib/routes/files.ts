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
// The same scheme serves an operator's documents (operations manual) under /operators/:id/files,
// stored in operator_files / operator_file_chunks (migration 018) with the operator's access
// (../operators.ts): fileRoutes() builds the routes of either from a FileScope.
// Limits (../limits.ts): the owner's storage quota (checked at the start and at every chunk), at most
// 3 unfinished uploads per owner, 50 files per aircraft or operator; unfinished uploads older than an
// hour are swept at every start; the first chunk must be of the declared type (magic bytes).
import type { Route } from '../http.js';
import { badRequest, HttpError, newId, notFound, reply } from '../http.js';
import type { Queryable } from '../db.js';
import { aircraftFor } from '../access.js';
import { operatorFor } from '../operators.js';
import { checkMagic, checkOpenUploads, checkQuota, LIMITS, sweepStaleUploads } from '../limits.js';
import {
  AIRCRAFT_FILE_CHUNK_BYTES, DOCUMENT_MAX_BYTES, DOCUMENT_TYPES, PHOTO_MAX_BYTES, PHOTO_TYPES,
  type AircraftFile, type AircraftFileKind, type AircraftFiles,
} from '../../../src/shared/types.js';

const COLS = 'id, kind, title, name, mime, size, chunks, created';
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

/** Base64 → its decoded byte length; 400 if it is not base64. */
function base64Bytes(v: unknown): { data: string; size: number } {
  if (typeof v !== 'string' || !v) throw badRequest('data (base64) is required');
  const data = v.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 !== 0) throw badRequest('data must be base64');
  return { data, size: (data.length / 4) * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0) };
}

/** What files belong to: their routes, tables and access (aircraft or operator). */
interface FileScope {
  /** e.g. '/aircraft/:id/files' */
  path: string;
  /** Table of the file rows, and of their chunks (chunks.attachment_id → files.id). */
  files: string;
  chunks: string;
  /** Column of the files table holding the parent's id. */
  parent: string;
  kinds: readonly AircraftFileKind[];
  /** Checks the pilot's access to parent `id` (404 / 403); returns the parent's owner (whose storage
   * the files use) and extra columns for a new file row. */
  access(db: Queryable, pilotId: string, id: string, need: 'view' | 'edit'): Promise<{ owner: string; extra: Record<string, unknown> }>;
  /** After a file is completed, in its transaction. */
  completed?(tx: Queryable, id: string): Promise<void>;
}

export function fileRoutes(scope: FileScope): Route[] {
  const { files, chunks, parent, path: P } = scope;
  const kinds = `kind IN (${scope.kinds.map((k) => `'${k}'`).join(', ')})`;
  const fileRow = async (db: Queryable, parentId: string, fileId: string) => {
    const [r] = await db.query(`SELECT ${COLS}, complete FROM ${files} WHERE id = $1 AND ${parent} = $2 AND ${kinds}`, [fileId, parentId]);
    if (!r) throw notFound('no such file');
    return r;
  };
  return [
    {
      method: 'GET', path: P,
      async handler({ db, pilot, params }) {
        await scope.access(db, pilot.id, params.id, 'view');
        const rows = await db.query(`SELECT ${COLS} FROM ${files} WHERE ${parent} = $1 AND complete AND ${kinds} ORDER BY created`, [params.id]);
        const all = rows.map(toFile);
        const documents = all.filter((f) => f.kind === 'document');
        if (!scope.kinds.includes('photo')) return { documents };
        const photos = all.filter((f) => f.kind === 'photo');
        return { photo: photos[photos.length - 1] ?? null, documents } satisfies AircraftFiles;
      },
    },
    {
      method: 'POST', path: P,
      async handler({ db, pilot, params, body }) {
        const { owner, extra } = await scope.access(db, pilot.id, params.id, 'edit');
        const v = (await body()) as Record<string, unknown>;
        const kind = v.kind as AircraftFileKind;
        if (!scope.kinds.includes(kind)) throw badRequest(`kind must be ${scope.kinds.join(' or ')}`);
        const types: readonly string[] = kind === 'photo' ? PHOTO_TYPES : DOCUMENT_TYPES;
        if (typeof v.mime !== 'string' || !types.includes(v.mime)) throw badRequest(`mime must be one of ${types.join(', ')}`);
        const max = kind === 'photo' ? PHOTO_MAX_BYTES : DOCUMENT_MAX_BYTES;
        if (typeof v.size !== 'number' || !Number.isInteger(v.size) || v.size <= 0) throw badRequest('size (bytes) is required');
        if (v.size > max) throw badRequest(`the file is larger than ${Math.round(max / MIB)} MB`);
        const name = cleanText(v.name, 200) || (kind === 'photo' ? 'photo' : 'document.pdf');
        const title = kind === 'document' ? cleanText(v.title, 120) || name.replace(/\.pdf$/i, '') : '';
        // uploads that never completed (closed tab, lost connection) go after an hour
        await sweepStaleUploads(db);
        const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM ${files} WHERE ${parent} = $1`, [params.id]);
        if (n >= LIMITS.filesPerParent) throw new HttpError(409, `At most ${LIMITS.filesPerParent} files each: delete one first.`);
        await checkOpenUploads(db, owner);
        await checkQuota(db, owner, v.size);
        const cols = Object.keys(extra);
        const [r] = await db.query(
          `INSERT INTO ${files} (id, ${parent}, name, mime, size, created, kind, title, chunks, complete${cols.map((c) => `, ${c}`).join('')})
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE${cols.map((_, i) => `, $${10 + i}`).join('')}) RETURNING ${COLS}`,
          [await newId('file'), params.id, name, v.mime, v.size, Date.now(), kind, title, chunkCount(v.size), ...Object.values(extra)],
        );
        return reply(201, toFile(r));
      },
    },
    {
      method: 'PUT', path: `${P}/:fileId/chunks/:seq`,
      async handler({ db, pilot, params, body }) {
        const { owner } = await scope.access(db, pilot.id, params.id, 'edit');
        const f = await fileRow(db, params.id, params.fileId);
        if (f.complete) throw new HttpError(409, 'the file is already complete');
        await checkQuota(db, owner, 0);
        const seq = Number(params.seq);
        if (!Number.isInteger(seq) || seq < 0 || seq >= Number(f.chunks)) throw badRequest(`seq must be 0 … ${Number(f.chunks) - 1}`);
        const { data, size } = base64Bytes(((await body()) as Record<string, unknown>).data);
        const last = seq === Number(f.chunks) - 1;
        const want = last ? Number(f.size) - AIRCRAFT_FILE_CHUNK_BYTES * seq : AIRCRAFT_FILE_CHUNK_BYTES;
        if (size !== want) throw badRequest(`chunk ${seq} must be ${want} bytes`);
        if (seq === 0) checkMagic(f.mime, data);
        await db.query(`INSERT INTO ${chunks} (attachment_id, seq, size, data) VALUES ($1, $2, $3, $4)
          ON CONFLICT (attachment_id, seq) DO UPDATE SET size = EXCLUDED.size, data = EXCLUDED.data`, [f.id, seq, size, data]);
        return undefined;
      },
    },
    {
      method: 'POST', path: `${P}/:fileId/complete`,
      async handler({ db, pilot, params }) {
        await scope.access(db, pilot.id, params.id, 'edit');
        const f = await fileRow(db, params.id, params.fileId);
        const [{ n, bytes }] = await db.query(`SELECT count(*)::int AS n, COALESCE(sum(size), 0)::bigint AS bytes FROM ${chunks} WHERE attachment_id = $1`, [f.id]);
        if (Number(n) !== Number(f.chunks) || Number(bytes) !== Number(f.size)) throw badRequest(`the upload is incomplete (${n} of ${f.chunks} chunks)`);
        return db.transaction(async (tx) => {
          await tx.query(`UPDATE ${files} SET complete = TRUE WHERE id = $1`, [f.id]);
          // one photo per aircraft: the new one replaces the old
          if (f.kind === 'photo') await tx.query(`DELETE FROM ${files} WHERE ${parent} = $1 AND kind = 'photo' AND id <> $2`, [params.id, f.id]);
          await scope.completed?.(tx, params.id);
          return toFile(f);
        });
      },
    },
    {
      method: 'GET', path: `${P}/:fileId/chunks/:seq`,
      async handler({ db, pilot, params }) {
        await scope.access(db, pilot.id, params.id, 'view');
        const f = await fileRow(db, params.id, params.fileId);
        if (!f.complete) throw notFound('no such file');
        const [c] = await db.query(`SELECT data FROM ${chunks} WHERE attachment_id = $1 AND seq = $2`, [f.id, Number(params.seq)]);
        if (!c) throw notFound('no such chunk');
        return reply(200, { data: c.data }, { 'Cache-Control': 'private, max-age=86400', 'Content-Disposition': 'attachment' });
      },
    },
    {
      method: 'PUT', path: `${P}/:fileId`,
      async handler({ db, pilot, params, body }) {
        await scope.access(db, pilot.id, params.id, 'edit');
        const f = await fileRow(db, params.id, params.fileId);
        const title = cleanText(((await body()) as Record<string, unknown>).title, 120);
        if (!title && f.kind === 'document') throw badRequest('title is required');
        const [r] = await db.query(`UPDATE ${files} SET title = $2 WHERE id = $1 RETURNING ${COLS}`, [f.id, title]);
        return toFile(r);
      },
    },
    {
      method: 'DELETE', path: `${P}/:fileId`,
      async handler({ db, pilot, params }) {
        await scope.access(db, pilot.id, params.id, 'edit');
        const f = await fileRow(db, params.id, params.fileId);
        await db.query(`DELETE FROM ${files} WHERE id = $1`, [f.id]);
        return undefined;
      },
    },
  ];
}

export const routes: Route[] = [
  // the aircraft's photo and documents (rows keep pilot_id = the aircraft's owner)
  ...fileRoutes({
    path: '/aircraft/:id/files', files: 'aircraft_attachments', chunks: 'aircraft_attachment_chunks', parent: 'aircraft_id', kinds: ['photo', 'document'],
    access: async (db, pilotId, id, need) => {
      const owner = (await aircraftFor(db, pilotId, id, need)).pilot_id as string;
      return { owner, extra: { pilot_id: owner, data: '' } };
    },
    completed: async (tx, id) => { await tx.query('UPDATE aircraft SET updated = $2 WHERE id = $1', [id, Date.now()]); },
  }),
  // an operator's documents (operations manual)
  ...fileRoutes({
    path: '/operators/:id/files', files: 'operator_files', chunks: 'operator_file_chunks', parent: 'operator_id', kinds: ['document'],
    access: async (db, pilotId, id, need) => ({ owner: (await operatorFor(db, pilotId, id, need))._owner, extra: {} }),
  }),
];
