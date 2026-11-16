// Files stored with an aircraft (compass swing reports): /aircraft/:id/attachments[/:fileId].
// Anyone the aircraft is shared with reads them; editors and the owner add and delete them (403 for
// viewers); everyone else gets 404. Files keep pilot_id = the aircraft's owner. The content travels
// as base64 in JSON (the API is JSON-only); the client turns it into a Blob to view or save.
import type { Route } from '../http.js';
import { badRequest, HttpError, newId, notFound, reply } from '../http.js';
import { checkMagic, checkQuota, LIMITS } from '../limits.js';
import type { Queryable } from '../db.js';
import { aircraftFor } from '../access.js';
import {
  ATTACHMENT_MAX_BYTES, ATTACHMENT_TYPES, type Attachment, type AttachmentRef, type AttachmentType, type CompassCard,
} from '../../../src/shared/types.js';

/** The owner's pilot id of an aircraft the session pilot has `need` access to (404/403 otherwise). */
async function ownerOf(db: Queryable, pilotId: string, id: string, need: 'view' | 'edit'): Promise<string> {
  return (await aircraftFor(db, pilotId, id, need)).pilot_id;
}

const ref = (r: any): AttachmentRef => ({ id: r.id, name: r.name, mime: r.mime, size: Number(r.size), uploaded: Number(r.created) });

/** Validates the upload: name, accepted type, base64 content within the size limit. */
export function attachmentInput(v: Record<string, unknown>): { name: string; mime: AttachmentType; data: string; size: number } {
  const name = typeof v.name === 'string' ? v.name.trim().replace(/[\u0000-\u001f]/g, '').slice(0, 200) : '';
  if (!name) throw badRequest('name is required');
  if (!(ATTACHMENT_TYPES as readonly unknown[]).includes(v.mime)) throw badRequest(`mime must be one of ${ATTACHMENT_TYPES.join(', ')}`);
  if (typeof v.data !== 'string' || !v.data) throw badRequest('data (base64) is required');
  const data = v.data.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 !== 0) throw badRequest('data must be base64');
  const size = (data.length / 4) * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
  if (size <= 0) throw badRequest('the file is empty');
  if (size > ATTACHMENT_MAX_BYTES) throw badRequest(`the file is larger than ${Math.round(ATTACHMENT_MAX_BYTES / (1024 * 1024))} MB`);
  return { name, mime: v.mime as AttachmentType, data, size };
}

/**
 * Before an aircraft's compass cards are saved: every report they reference must be a file of this
 * aircraft (400 otherwise), and the stored metadata replaces what the client sent. Returns the cards
 * to store and the ids of this aircraft's files no card references any more (deleted after the save).
 */
export async function checkReports(db: Queryable, pilotId: string, aircraftId: string, cards: CompassCard[]): Promise<{ cards: CompassCard[]; unused: string[] }> {
  const rows = await db.query("SELECT id, name, mime, size, created FROM aircraft_attachments WHERE aircraft_id = $1 AND pilot_id = $2 AND kind = 'report'", [aircraftId, pilotId]);
  const byId = new Map(rows.map((r: any) => [r.id as string, ref(r)]));
  const used = new Set<string>();
  const out = cards.map((c, i) => {
    if (!c.report) return c;
    const f = byId.get(c.report.id);
    if (!f) throw badRequest(`compassCards[${i}].report: no such file on this aircraft (upload it first)`);
    used.add(f.id);
    return { ...c, report: f };
  });
  return { cards: out, unused: [...byId.keys()].filter((id) => !used.has(id)) };
}

export async function deleteAttachments(db: Queryable, pilotId: string, ids: string[]): Promise<void> {
  if (ids.length) await db.query("DELETE FROM aircraft_attachments WHERE pilot_id = $1 AND id = ANY($2::text[]) AND kind = 'report'", [pilotId, ids]);
}

export const routes: Route[] = [
  {
    method: 'POST', path: '/aircraft/:id/attachments',
    async handler({ db, pilot, params, body }) {
      const owner = await ownerOf(db, pilot.id, params.id, 'edit');
      const a = attachmentInput(await body());
      checkMagic(a.mime, a.data);
      const [{ n }] = await db.query('SELECT count(*)::int AS n FROM aircraft_attachments WHERE aircraft_id = $1', [params.id]);
      if (n >= LIMITS.filesPerParent) throw new HttpError(409, `At most ${LIMITS.filesPerParent} files each: delete one first.`);
      await checkQuota(db, owner, a.size);
      const [r] = await db.query(
        `INSERT INTO aircraft_attachments (id, pilot_id, aircraft_id, name, mime, size, data, created)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, name, mime, size, created`,
        [await newId('file'), owner, params.id, a.name, a.mime, a.size, a.data, Date.now()],
      );
      return reply(201, ref(r));
    },
  },
  {
    method: 'GET', path: '/aircraft/:id/attachments/:fileId',
    async handler(ctx): Promise<Attachment> {
      const { db, pilot, params } = ctx;
      const owner = await ownerOf(db, pilot.id, params.id, 'view');
      const [r] = await db.query(
        "SELECT * FROM aircraft_attachments WHERE id = $1 AND aircraft_id = $2 AND pilot_id = $3 AND kind = 'report'", [params.fileId, params.id, owner]);
      if (!r) throw notFound('no such file');
      ctx.headers['Content-Disposition'] = 'attachment';
      return { ...ref(r), data: r.data };
    },
  },
  {
    method: 'DELETE', path: '/aircraft/:id/attachments/:fileId',
    async handler({ db, pilot, params }) {
      const owner = await ownerOf(db, pilot.id, params.id, 'edit');
      const r = await db.query(
        "DELETE FROM aircraft_attachments WHERE id = $1 AND aircraft_id = $2 AND pilot_id = $3 AND kind = 'report' RETURNING id", [params.fileId, params.id, owner]);
      if (!r.length) throw notFound('no such file');
      return undefined;
    },
  },
];
