// Per-pilot limits on what an account can store (4xx with a clear message beyond them):
//   counts     aircraft 50, operators 20 (owned), flights 2000 (trash included), passengers 500,
//              waypoints 1000, files per aircraft or operator 50
//   storage    STORAGE_QUOTA_MB (default 300) over every file the pilot owns: the files of their
//              aircraft (photo, documents, compass swing reports), of their operators and their own
//              (licence, medical), incomplete
//              uploads included (an upload counts with its declared size from its start)
//   uploads    at most MAX_OPEN_UPLOADS incomplete uploads per pilot at a time; incomplete uploads
//              older than STALE_UPLOAD_MS are swept (all pilots) whenever an upload starts
// File content is checked against its declared type (magic bytes: checkMagic).
import type { Queryable } from './db.js';
import { HttpError } from './http.js';

export const LIMITS = {
  aircraft: 50,
  operators: 20,
  flights: 2000,
  passengers: 500,
  waypoints: 1000,
  filesPerParent: 50,
} as const;
export const MAX_OPEN_UPLOADS = 3;
export const STALE_UPLOAD_MS = 3600e3;

export function storageQuotaBytes(env: NodeJS.ProcessEnv = process.env): number {
  const mb = Number(env.STORAGE_QUOTA_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : 300) * 1048576;
}

const COUNT_SQL: Record<'aircraft' | 'operators' | 'flights' | 'passengers' | 'waypoints', string> = {
  aircraft: 'SELECT count(*)::int AS n FROM aircraft WHERE pilot_id = $1',
  operators: 'SELECT count(*)::int AS n FROM operators WHERE pilot_id = $1',
  flights: 'SELECT count(*)::int AS n FROM flights WHERE pilot_id = $1',
  passengers: 'SELECT count(*)::int AS n FROM passengers WHERE pilot_id = $1',
  waypoints: 'SELECT count(*)::int AS n FROM waypoints WHERE pilot_id = $1',
};
const WHAT: Record<keyof typeof COUNT_SQL, string> = {
  aircraft: 'aircraft in your hangar',
  operators: 'operators',
  flights: 'flights (the trash included: empty it to make room)',
  passengers: 'passengers',
  waypoints: 'waypoints',
};

export async function checkCount(
  db: Queryable,
  pilotId: string,
  kind: keyof typeof COUNT_SQL,
  adding = 1,
): Promise<void> {
  const [{ n }] = await db.query(COUNT_SQL[kind], [pilotId]);
  if (n + adding > LIMITS[kind])
    throw new HttpError(409, `You have reached the limit of ${LIMITS[kind]} ${WHAT[kind]}.`);
}

export async function storageUsed(db: Queryable, pilotId: string): Promise<number> {
  const [r] = await db.query(
    `SELECT (SELECT COALESCE(sum(size), 0) FROM aircraft_attachments WHERE pilot_id = $1)
          + (SELECT COALESCE(sum(f.size), 0) FROM operator_files f JOIN operators o ON o.id = f.operator_id WHERE o.pilot_id = $1)
          + (SELECT COALESCE(sum(size), 0) FROM pilot_files WHERE pilot_id = $1) AS bytes`,
    [pilotId],
  );
  return Number(r.bytes);
}

const mb = (b: number) => `${Math.round(b / 1048576)} MB`;

/** `adding` 0 re-checks what is already reserved. */
export async function checkQuota(db: Queryable, pilotId: string, adding: number): Promise<void> {
  const quota = storageQuotaBytes();
  const used = await storageUsed(db, pilotId);
  if (used + adding > quota) {
    throw new HttpError(
      413,
      `Not enough storage: your files use ${mb(used)} of ${mb(quota)}${adding ? `, and this file needs ${mb(adding)}` : ''}. Delete some files first.`,
    );
  }
}

/** Any pilot's: one cheap indexed delete per table. */
export async function sweepStaleUploads(db: Queryable, now = Date.now()): Promise<void> {
  await db.query(`DELETE FROM aircraft_attachments WHERE NOT complete AND created < $1`, [now - STALE_UPLOAD_MS]);
  await db.query(`DELETE FROM operator_files WHERE NOT complete AND created < $1`, [now - STALE_UPLOAD_MS]);
  await db.query(`DELETE FROM pilot_files WHERE NOT complete AND created < $1`, [now - STALE_UPLOAD_MS]);
}

export async function checkOpenUploads(db: Queryable, pilotId: string): Promise<void> {
  const [r] = await db.query(
    `SELECT (SELECT count(*) FROM aircraft_attachments WHERE pilot_id = $1 AND NOT complete)
          + (SELECT count(*) FROM operator_files f JOIN operators o ON o.id = f.operator_id WHERE o.pilot_id = $1 AND NOT f.complete)
          + (SELECT count(*) FROM pilot_files WHERE pilot_id = $1 AND NOT complete) AS n`,
    [pilotId],
  );
  if (Number(r.n) >= MAX_OPEN_UPLOADS) {
    throw new HttpError(
      429,
      `At most ${MAX_OPEN_UPLOADS} uploads at a time: wait for the others to finish (unfinished uploads are removed after an hour).`,
    );
  }
}

const MAGIC: Record<string, (b: Buffer) => boolean> = {
  'application/pdf': (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
  'image/jpeg': (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/webp': (b) =>
    b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};

export function checkMagic(mime: string, base64: string): void {
  const head = Buffer.from(base64.slice(0, 24), 'base64');
  const ok = MAGIC[mime];
  if (!ok || !ok(head))
    throw new HttpError(
      400,
      `the file is not a ${mime === 'application/pdf' ? 'PDF' : mime.replace('image/', '').toUpperCase() + ' image'}`,
    );
}
