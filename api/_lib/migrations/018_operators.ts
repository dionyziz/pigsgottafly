// Operators (src/shared/operators.ts). An operator is owned by the pilot who created it and shared
// like an aircraft (operator_shares: view/edit). aircraft.operator_id assigns an aircraft to an
// operator; anyone with access to the aircraft views its operator (derived in api/_lib/operators.ts,
// not stored). The free-text aircraft.operator stays as the fallback name of an aircraft without one.
// The operator's documents (operations manual) use the chunked file scheme of the aircraft files
// (operator_files + operator_file_chunks, api/_lib/routes/files.ts).
//
// The W&B and performance sheets e-mailed to the operator are a third kind of form submission
// ('wbperf' in form_submissions and form_send_claims, as Form 731 and the GenDec).
//
// Data: for every pilot, one operator per distinct (trimmed, case-insensitive) aircraft.operator
// text of their own aircraft, linked to those aircraft. Its phone is taken from an aircraft's item 19
// remarks only when they are exactly 'OPR TEL <phone numbers>' (the owner's SX-ASV / SX-ASG).
import crypto from 'node:crypto';
import type { Queryable } from '../db.js';

const sql = `
CREATE TABLE operators (
  id TEXT PRIMARY KEY,
  pilot_id TEXT NOT NULL REFERENCES pilots(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  aftn TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  requires_wb_perf BOOLEAN NOT NULL DEFAULT FALSE,
  declarations_email TEXT NOT NULL DEFAULT '',
  created BIGINT NOT NULL,
  updated BIGINT NOT NULL
);
CREATE INDEX operators_pilot ON operators (pilot_id);

CREATE TABLE operator_shares (
  operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  pilot_id TEXT NOT NULL REFERENCES pilots(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('view', 'edit')),
  created BIGINT NOT NULL,
  created_by TEXT REFERENCES pilots(id) ON DELETE SET NULL,
  PRIMARY KEY (operator_id, pilot_id)
);
CREATE INDEX operator_shares_pilot ON operator_shares (pilot_id);

ALTER TABLE aircraft ADD COLUMN operator_id TEXT REFERENCES operators(id) ON DELETE SET NULL;
CREATE INDEX aircraft_operator ON aircraft (operator_id);

CREATE TABLE operator_files (
  id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('document')),
  name TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  chunks INTEGER NOT NULL,
  complete BOOLEAN NOT NULL DEFAULT FALSE,
  created BIGINT NOT NULL
);
CREATE INDEX operator_files_operator ON operator_files (operator_id);
CREATE TABLE operator_file_chunks (
  attachment_id TEXT NOT NULL REFERENCES operator_files(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  size INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (attachment_id, seq)
);

-- 'wbperf': the W&B and performance sheets sent to the aircraft's operator
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname, conrelid::regclass AS t FROM pg_constraint
           WHERE contype = 'c' AND conrelid IN ('form_submissions'::regclass, 'form_send_claims'::regclass)
             AND pg_get_constraintdef(oid) LIKE '%gendec%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.t, c.conname);
  END LOOP;
END $$;
ALTER TABLE form_submissions ADD CONSTRAINT form_submissions_form_check CHECK (form IN ('731', 'gendec', 'wbperf'));
ALTER TABLE form_send_claims ADD CONSTRAINT form_send_claims_form_check CHECK (form IN ('731', 'gendec', 'wbperf'));
`;

/** 'OPR TEL +302108169910 +306974776230' → '+302108169910 +306974776230'; anything else → ''. */
export function oprTel(remarks: unknown): string {
  const m = /^\s*OPR TEL\s+(\+?\d[\d ]{5,}(?:\s+\+?\d[\d ]{5,})*)\s*$/i.exec(String(remarks ?? ''));
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

export async function run(q: Queryable): Promise<void> {
  await q.exec(sql);
  const rows = await q.query<{ id: string; pilot_id: string; operator: string; equipment: { remarks?: string } | null }>(
    `SELECT id, pilot_id, btrim(operator) AS operator, equipment FROM aircraft WHERE btrim(operator) <> '' ORDER BY created, id`);
  const groups = new Map<string, { pilotId: string; name: string; phone: string; aircraft: string[] }>();
  for (const r of rows) {
    const k = `${r.pilot_id}\u0000${r.operator.toLowerCase()}`;
    const g = groups.get(k) ?? { pilotId: r.pilot_id, name: r.operator, phone: '', aircraft: [] };
    g.aircraft.push(r.id);
    if (!g.phone) g.phone = oprTel(r.equipment?.remarks);
    groups.set(k, g);
  }
  const now = Date.now();
  for (const g of groups.values()) {
    const id = `op_${crypto.randomBytes(9).toString('base64url')}`;
    await q.query('INSERT INTO operators (id, pilot_id, name, phone, created, updated) VALUES ($1, $2, $3, $4, $5, $5)', [id, g.pilotId, g.name, g.phone, now]);
    await q.query('UPDATE aircraft SET operator_id = $1 WHERE id = ANY($2::text[])', [id, g.aircraft]);
  }
}
