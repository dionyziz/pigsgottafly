// The pilot's own account (GDPR): erasure and portability.
//   DELETE /me          {confirm: <the account's e-mail>} (local mode: "delete") → deletes the pilot and
//                       everything they own, ends every session, clears the cookie
//   GET    /me/export   everything the pilot owns as one JSON download (files listed, not their bytes)
//
// Deletion is generic: every table with a pilot_id column loses the pilot's rows (owned rows,
// shares received, and the files of the pilot's aircraft, whose pilot_id is the owner), then the
// pilots row goes and its ON DELETE CASCADE foreign keys take the rest (sessions; aircraft →
// shares granted, files and chunks; operators → operator shares granted, operator files and chunks; flights → manifest, forms, briefings, filings). The aircraft
// the pilot owned are deleted even when shared: other pilots' flights lose them (aircraft_id SET
// NULL, as when an owner deletes an aircraft). The e-mails of other pilots' shares with the pilot
// stay in their log without the address. tests/api/account.test.ts checks that no column of
// any table still holds the pilot's id or e-mail afterwards.
import { sessionCookie } from '../auth.js';
import type { Queryable } from '../db.js';
import type { Route } from '../http.js';
import { badRequest, reply } from '../http.js';
import { toOperator } from '../operators.js';
import { toAircraft, toFlight, toPassenger, toPilot, toWaypoint } from '../rows.js';
import { SHARE_FORMS } from '../sendCaps.js';
import { toFile } from './files.js';

const OWNER_COLUMNS = ['pilot_id', 'owner_id', 'owner_pilot_id'];

/** Deletes the pilot and everything they own. Run inside a transaction. */
export async function deletePilotData(q: Queryable, pilotId: string): Promise<void> {
  const cols = await q.query<{ table_name: string; column_name: string }>(
    `SELECT c.table_name, c.column_name FROM information_schema.columns c
     JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
     WHERE c.table_schema = current_schema() AND c.column_name = ANY($1) AND c.table_name <> 'pilots'
     ORDER BY c.table_name`,
    [OWNER_COLUMNS],
  );
  const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
  for (const c of cols)
    await q.query(`DELETE FROM ${ident(c.table_name)} WHERE ${ident(c.column_name)} = $1`, [pilotId]);
  // the v2 flights kept by migration 001 (owner = the pilot id), where that table still exists
  const [legacy] = await q.query(`SELECT to_regclass('legacy_flights') IS NOT NULL AS ok`);
  if (legacy?.ok) await q.query('DELETE FROM legacy_flights WHERE owner = $1', [pilotId]);
  // the notices of shares other pilots made with this one keep counting for them, without the address
  const [me] = await q.query('SELECT email FROM pilots WHERE id = $1', [pilotId]);
  if (me?.email)
    await q.query(
      `UPDATE mail_log SET recipient = 'deleted account' WHERE form = ANY($1::text[]) AND lower(recipient) = lower($2)`,
      [SHARE_FORMS, me.email],
    );
  await q.query('DELETE FROM pilots WHERE id = $1', [pilotId]);
}

const num = (v: unknown) => (v == null ? null : Number(v));

/** Everything the pilot owns, as plain JSON (GDPR data portability). */
export async function exportPilotData(q: Queryable, pilotId: string) {
  const [p] = await q.query('SELECT * FROM pilots WHERE id = $1', [pilotId]);
  const sessions = await q.query('SELECT created FROM sessions WHERE pilot_id = $1 ORDER BY created', [pilotId]);
  const owned = await q.query('SELECT * FROM aircraft WHERE pilot_id = $1 ORDER BY registration', [pilotId]);
  const files = await q.query(
    `SELECT id, aircraft_id, kind, title, name, mime, size, chunks, created, complete FROM aircraft_attachments
     WHERE pilot_id = $1 ORDER BY created`,
    [pilotId],
  );
  const granted = await q.query(
    `SELECT s.aircraft_id, s.role, s.created, g.email, g.full_name, g.name FROM aircraft_shares s
     JOIN aircraft a ON a.id = s.aircraft_id JOIN pilots g ON g.id = s.pilot_id WHERE a.pilot_id = $1 ORDER BY s.created`,
    [pilotId],
  );
  const received = await q.query(
    `SELECT s.aircraft_id, s.role, s.created, a.registration, o.email AS owner_email FROM aircraft_shares s
     JOIN aircraft a ON a.id = s.aircraft_id JOIN pilots o ON o.id = a.pilot_id WHERE s.pilot_id = $1 ORDER BY a.registration`,
    [pilotId],
  );
  const operators = await q.query('SELECT * FROM operators WHERE pilot_id = $1 ORDER BY lower(name)', [pilotId]);
  const opFiles = await q.query(
    `SELECT f.id, f.operator_id, f.kind, f.title, f.name, f.mime, f.size, f.chunks, f.created, f.complete FROM operator_files f
     JOIN operators o ON o.id = f.operator_id WHERE o.pilot_id = $1 ORDER BY f.created`,
    [pilotId],
  );
  const opGranted = await q.query(
    `SELECT s.operator_id, s.role, s.created, g.email, g.full_name, g.name FROM operator_shares s
     JOIN operators o ON o.id = s.operator_id JOIN pilots g ON g.id = s.pilot_id WHERE o.pilot_id = $1 ORDER BY s.created`,
    [pilotId],
  );
  const opReceived = await q.query(
    `SELECT s.operator_id, s.role, s.created, o.name, w.email AS owner_email FROM operator_shares s
     JOIN operators o ON o.id = s.operator_id JOIN pilots w ON w.id = o.pilot_id WHERE s.pilot_id = $1 ORDER BY lower(o.name)`,
    [pilotId],
  );
  const passengers = await q.query('SELECT * FROM passengers WHERE pilot_id = $1 ORDER BY full_name', [pilotId]);
  const waypoints = await q.query('SELECT * FROM waypoints WHERE pilot_id = $1 ORDER BY name', [pilotId]);
  const flights = await q.query('SELECT * FROM flights WHERE pilot_id = $1 ORDER BY date, created', [pilotId]);
  const crew = await q.query('SELECT * FROM flight_crew WHERE pilot_id = $1', [pilotId]);
  const all = (sql: string) => q.query(sql, [pilotId]);
  const [links, signatures, submissions, briefings, filings, filingLog, mailLog] = await Promise.all([
    all(
      'SELECT flight_id, person_key, created, first_opened, last_opened, revoked, expires FROM form_links WHERE pilot_id = $1 ORDER BY created',
    ),
    all(
      'SELECT flight_id, person_key, signer_name, signed_at, text_hash FROM form_signatures WHERE pilot_id = $1 ORDER BY signed_at',
    ),
    all(
      'SELECT flight_id, form, sent_at, message_id, to_addr FROM form_submissions WHERE pilot_id = $1 ORDER BY sent_at',
    ),
    all('SELECT flight_id, fetched, params, doc FROM flight_notams WHERE pilot_id = $1 ORDER BY fetched'),
    all(
      'SELECT flight_id, provider, provider_id, status, eobt, fpl, addresses, message, filed, updated FROM flight_filings WHERE pilot_id = $1',
    ),
    all('SELECT flight_id, at, action, ok, message, detail FROM filing_log WHERE pilot_id = $1 ORDER BY at'),
    all('SELECT flight_id, form, at, recipient, subject, result FROM mail_log WHERE pilot_id = $1 ORDER BY at'),
  ]);
  const crewOf = (id: string) => crew.filter((c) => c.flight_id === id);
  return {
    format: 'pigsgottafly-export',
    version: 1,
    exportedAt: new Date().toISOString(),
    account: {
      id: p.id,
      googleSubject: p.google_sub ?? null,
      email: p.email,
      googleName: p.name,
      picture: p.picture,
      created: num(p.created),
      lastLogin: num(p.last_login),
      sessions: sessions.map((s) => ({ created: num(s.created) })),
    },
    profile: toPilot(p),
    aircraft: owned.map((a) => ({
      ...toAircraft(a),
      files: files.filter((f) => f.aircraft_id === a.id).map((f) => ({ ...toFile(f), complete: !!f.complete })),
      sharedWith: granted
        .filter((s) => s.aircraft_id === a.id)
        .map((s) => ({ email: s.email, name: s.full_name || s.name, role: s.role, created: num(s.created) })),
    })),
    aircraftSharedWithMe: received.map((s) => ({
      aircraftId: s.aircraft_id,
      registration: s.registration,
      owner: s.owner_email,
      role: s.role,
      created: num(s.created),
    })),
    operators: operators.map((o) => ({
      ...toOperator(o),
      files: opFiles.filter((f) => f.operator_id === o.id).map((f) => ({ ...toFile(f), complete: !!f.complete })),
      sharedWith: opGranted
        .filter((s) => s.operator_id === o.id)
        .map((s) => ({ email: s.email, name: s.full_name || s.name, role: s.role, created: num(s.created) })),
    })),
    operatorsSharedWithMe: opReceived.map((s) => ({
      operatorId: s.operator_id,
      name: s.name,
      owner: s.owner_email,
      role: s.role,
      created: num(s.created),
    })),
    passengers: passengers.map(toPassenger),
    waypoints: waypoints.map(toWaypoint),
    flights: flights.map((f) => toFlight(f, crewOf(f.id))),
    forms: {
      signingLinks: links.map((l) => ({
        flightId: l.flight_id,
        person: l.person_key,
        created: num(l.created),
        firstOpened: num(l.first_opened),
        lastOpened: num(l.last_opened),
        revoked: !!l.revoked,
        expires: num(l.expires),
      })),
      signatures: signatures.map((s) => ({
        flightId: s.flight_id,
        person: s.person_key,
        name: s.signer_name,
        signedAt: num(s.signed_at),
        formHash: s.text_hash,
      })),
      submissions: submissions.map((s) => ({
        flightId: s.flight_id,
        form: s.form,
        sentAt: num(s.sent_at),
        to: s.to_addr,
        messageId: s.message_id,
      })),
      emailsSent: mailLog.map((m) => ({
        flightId: m.flight_id,
        form: m.form,
        at: num(m.at),
        to: m.recipient,
        subject: m.subject,
        result: m.result,
      })),
    },
    notamBriefings: briefings.map((b) => ({
      flightId: b.flight_id,
      fetched: num(b.fetched),
      params: b.params,
      briefing: b.doc,
    })),
    flightPlanFilings: filings.map((f) => ({
      flightId: f.flight_id,
      provider: f.provider,
      providerId: f.provider_id,
      status: f.status,
      eobt: num(f.eobt),
      fpl: f.fpl,
      addresses: f.addresses,
      message: f.message,
      filed: num(f.filed),
      updated: num(f.updated),
    })),
    filingLog: filingLog.map((l) => ({
      flightId: l.flight_id,
      at: num(l.at),
      action: l.action,
      ok: !!l.ok,
      message: l.message,
      detail: l.detail,
    })),
  };
}

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/me/export',
    async handler({ db, pilot }) {
      const data = await exportPilotData(db, pilot.id);
      const day = new Date().toISOString().slice(0, 10);
      return reply(200, data, { 'Content-Disposition': `attachment; filename="pigsgottafly-${day}.json"` });
    },
  },
  {
    method: 'DELETE',
    path: '/me',
    async handler({ db, pilot, body, config }) {
      const b = await body();
      const expected = (pilot.email || '').trim().toLowerCase() || 'delete';
      if (typeof b.confirm !== 'string' || b.confirm.trim().toLowerCase() !== expected) {
        throw badRequest(pilot.email ? 'type your e-mail address to confirm' : 'type "delete" to confirm');
      }
      await db.transaction((tx) => deletePilotData(tx, pilot.id));
      return reply(200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0, config.secureCookie) });
    },
  },
];
