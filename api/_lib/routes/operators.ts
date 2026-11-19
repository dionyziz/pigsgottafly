// Operators: /operators, /operators/:id, /operators/:id/shares[/:pilotId] (src/shared/operators.ts,
// access in ../operators.ts). Viewers read; editors also change the operator, its documents and
// its sharing; only the owner deletes it (its aircraft keep the name as free text). Sharing works
// as for aircraft (shares.ts, the person is e-mailed too); people who see the operator only through
// an aircraft are listed with that aircraft and are changed by sharing the aircraft, not here.
import { EMPTY_OPERATOR, isEmail, type OperatorInput, type OperatorSharing } from '../../../src/shared/operators.js';
import type { ShareRole } from '../../../src/shared/sharing.js';
import { accessibleSql, personName } from '../access.js';
import type { Queryable, Row } from '../db.js';
import type { Route } from '../http.js';
import { badRequest, conflict, HttpError, newId, notFound, reply } from '../http.js';
import { checkCount } from '../limits.js';
import { listOperators, operatorFor, operatorItem } from '../operators.js';
import { rateLimit } from '../rateLimit.js';
import { str } from '../rows.js';
import { notifyShare } from '../shareMail.js';

export function operatorInput(input: Record<string, unknown>, base: OperatorInput): OperatorInput {
  const o = { ...base };
  if ('name' in input) o.name = str(input.name, 'name', 200);
  for (const k of ['phone', 'email', 'address', 'aftn', 'declarationsEmail', 'fplCopyEmail'] as const)
    if (k in input) o[k] = str(input[k], k, 320);
  if ('notes' in input) o.notes = str(input.notes, 'notes', 5000);
  if ('requiresWbPerf' in input) {
    if (typeof input.requiresWbPerf !== 'boolean') throw badRequest('requiresWbPerf must be true or false');
    o.requiresWbPerf = input.requiresWbPerf;
  }
  if ('requiresFplCopy' in input) {
    if (typeof input.requiresFplCopy !== 'boolean') throw badRequest('requiresFplCopy must be true or false');
    o.requiresFplCopy = input.requiresFplCopy;
  }
  if (!o.name) throw badRequest('name is required');
  if (o.email && !isEmail(o.email)) throw badRequest('email is not an e-mail address');
  if (o.declarationsEmail && !isEmail(o.declarationsEmail))
    throw badRequest('declarationsEmail is not an e-mail address');
  if (o.requiresWbPerf && !o.declarationsEmail) throw badRequest('an e-mail address for the declarations is required');
  if (o.fplCopyEmail && !isEmail(o.fplCopyEmail)) throw badRequest('fplCopyEmail is not an e-mail address');
  if (o.requiresFplCopy && !o.fplCopyEmail)
    throw badRequest('an e-mail address for the flight plan copies is required');
  return o;
}

const cols = (o: OperatorInput) => [
  o.name,
  o.phone,
  o.email,
  o.address,
  o.aftn,
  o.notes,
  o.requiresWbPerf,
  o.declarationsEmail,
  o.requiresFplCopy,
  o.fplCopyEmail,
];

function shareRole(v: unknown): ShareRole {
  if (v !== 'view' && v !== 'edit') throw badRequest("role must be 'view' or 'edit'");
  return v;
}

async function sharing(db: Queryable, op: Awaited<ReturnType<typeof operatorFor>>): Promise<OperatorSharing> {
  const [owner] = await db.query('SELECT id, email, full_name, name FROM pilots WHERE id = $1', [op._owner]);
  const direct = await db.query(
    `SELECT s.pilot_id, s.role, s.created, p.email, p.full_name, p.name FROM operator_shares s JOIN pilots p ON p.id = s.pilot_id WHERE s.operator_id = $1`,
    [op.id],
  );
  // everyone with access to one of its aircraft (aircraft owners and the aircraft's shares)
  const via = await db.query(
    `SELECT x.pilot_id, array_agg(DISTINCT x.registration) AS regs, p.email, p.full_name, p.name FROM (
       SELECT a.pilot_id, a.registration FROM aircraft a WHERE a.operator_id = $1
       UNION ALL SELECT s.pilot_id, a.registration FROM aircraft a JOIN aircraft_shares s ON s.aircraft_id = a.id WHERE a.operator_id = $1
     ) x JOIN pilots p ON p.id = x.pilot_id GROUP BY x.pilot_id, p.email, p.full_name, p.name`,
    [op.id],
  );
  const viaBy = new Map<string, string[]>(via.map((r: Row) => [r.pilot_id, [...(r.regs ?? [])].sort()]));
  const people = new Map<string, OperatorSharing['people'][number]>();
  for (const r of direct) {
    people.set(r.pilot_id, {
      pilotId: r.pilot_id,
      name: personName(r.full_name, r.name),
      email: r.email ?? '',
      role: r.role,
      added: Number(r.created),
      via: viaBy.get(r.pilot_id) ?? [],
      direct: true,
    });
  }
  for (const r of via) {
    if (r.pilot_id === op._owner || people.has(r.pilot_id)) continue;
    people.set(r.pilot_id, {
      pilotId: r.pilot_id,
      name: personName(r.full_name, r.name),
      email: r.email ?? '',
      role: 'view',
      added: null,
      via: viaBy.get(r.pilot_id) ?? [],
      direct: false,
    });
  }
  const sorted = [...people.values()].sort((a, b) =>
    (a.name || a.email).toLowerCase().localeCompare((b.name || b.email).toLowerCase()),
  );
  const role = op.access.role;
  return {
    operatorId: op.id,
    name: op.name,
    role,
    canManage: role !== 'view',
    people: [
      {
        pilotId: owner.id,
        name: personName(owner.full_name, owner.name),
        email: owner.email ?? '',
        role: 'owner',
        added: null,
        via: viaBy.get(owner.id) ?? [],
        direct: true,
      },
      ...sorted,
    ],
  };
}

export const routes: Route[] = [
  { method: 'GET', path: '/operators', handler: async ({ db, pilot }) => listOperators(db, pilot.id) },
  {
    method: 'POST',
    path: '/operators',
    async handler({ db, pilot, body }) {
      const o = operatorInput(await body(), EMPTY_OPERATOR);
      await checkCount(db, pilot.id, 'operators');
      const id = await newId('op');
      const now = Date.now();
      await db.query(
        `INSERT INTO operators (id, pilot_id, name, phone, email, address, aftn, notes, requires_wb_perf, declarations_email, requires_fpl_copy, fpl_copy_email, created, updated)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)`,
        [id, pilot.id, ...cols(o), now],
      );
      return reply(201, operatorItem(await operatorFor(db, pilot.id, id)));
    },
  },
  {
    method: 'GET',
    path: '/operators/:id',
    handler: async ({ db, pilot, params }) => operatorItem(await operatorFor(db, pilot.id, params.id)),
  },
  {
    method: 'PUT',
    path: '/operators/:id',
    async handler({ db, pilot, params, body }) {
      const {
        id: _i,
        created: _c,
        updated: _u,
        access: _a,
        aircraft: _ac,
        _owner,
        ...base
      } = await operatorFor(db, pilot.id, params.id, 'edit');
      const o = operatorInput(await body(), base);
      const now = Date.now();
      await db.query(
        `UPDATE operators SET name=$2, phone=$3, email=$4, address=$5, aftn=$6, notes=$7, requires_wb_perf=$8, declarations_email=$9, requires_fpl_copy=$10, fpl_copy_email=$11, updated=$12 WHERE id=$1`,
        [params.id, ...cols(o), now],
      );
      // the fallback text of its aircraft follows the name
      await db.query('UPDATE aircraft SET operator = $2 WHERE operator_id = $1', [params.id, o.name]);
      return operatorItem(await operatorFor(db, pilot.id, params.id));
    },
  },
  {
    method: 'DELETE',
    path: '/operators/:id',
    async handler({ db, pilot, params }) {
      await operatorFor(db, pilot.id, params.id, 'owner');
      await db.query('DELETE FROM operators WHERE id = $1 AND pilot_id = $2', [params.id, pilot.id]);
      return undefined;
    },
  },
  {
    method: 'GET',
    path: '/operators/:id/shares',
    handler: async ({ db, pilot, params }) => sharing(db, await operatorFor(db, pilot.id, params.id)),
  },
  {
    method: 'POST',
    path: '/operators/:id/shares',
    async handler({ db, pilot, params, body, req, config }) {
      const op = await operatorFor(db, pilot.id, params.id, 'edit');
      await rateLimit(db, 'share', { pilotId: pilot.id });
      const input = await body();
      const role = shareRole(input.role);
      const email = typeof input.email === 'string' ? input.email.trim() : '';
      if (!email) throw badRequest('email is required');
      if (email.length > 320) throw badRequest('email is too long');
      const [p] = await db.query(
        'SELECT id, email FROM pilots WHERE lower(email) = lower($1) ORDER BY last_login DESC LIMIT 1',
        [email],
      );
      if (!p)
        throw notFound(
          `No Pig’s Gotta Fly account uses ${email}. They need to sign in once before you can share with them.`,
        );
      if (p.id === pilot.id) throw badRequest('You cannot share an operator with yourself.');
      if (p.id === op._owner) throw badRequest(`${email} owns this operator.`);
      const ins = await db.query(
        `INSERT INTO operator_shares (operator_id, pilot_id, role, created, created_by) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (operator_id, pilot_id) DO NOTHING RETURNING pilot_id`,
        [op.id, p.id, role, Date.now(), pilot.id],
      );
      if (!ins.length) throw conflict(`${email} already has access to this operator.`);
      await notifyShare(
        db,
        { req, config, pilot },
        { kind: 'operator', id: op.id, name: op.name, role, to: p.email || email },
      );
      return reply(201, await sharing(db, op));
    },
  },
  {
    method: 'PUT',
    path: '/operators/:id/shares/:pilotId',
    async handler({ db, pilot, params, body }) {
      const op = await operatorFor(db, pilot.id, params.id, 'edit');
      const role = shareRole((await body()).role);
      if (params.pilotId === op._owner) throw badRequest('The owner’s access cannot change.');
      // someone who sees it through an aircraft gets a direct share
      await db.query(
        `INSERT INTO operator_shares (operator_id, pilot_id, role, created, created_by)
        SELECT $1, $2, $3, $4, $5 WHERE EXISTS (SELECT 1 FROM aircraft a WHERE a.operator_id = $1 AND ${accessibleSql('a', '$2')})
        ON CONFLICT (operator_id, pilot_id) DO UPDATE SET role = EXCLUDED.role`,
        [op.id, params.pilotId, role, Date.now(), pilot.id],
      );
      const r = await db.query('SELECT 1 FROM operator_shares WHERE operator_id = $1 AND pilot_id = $2', [
        op.id,
        params.pilotId,
      ]);
      if (!r.length) throw notFound('this person has no access to the operator');
      return sharing(db, await operatorFor(db, pilot.id, params.id));
    },
  },
  {
    method: 'DELETE',
    path: '/operators/:id/shares/:pilotId',
    async handler({ db, pilot, params }) {
      const op = await operatorFor(db, pilot.id, params.id);
      const self = params.pilotId === pilot.id;
      if (params.pilotId === op._owner)
        throw badRequest(self ? 'You own this operator: delete it instead.' : 'The owner cannot be removed.');
      if (!self && op.access.role === 'view') throw new HttpError(403, 'viewers cannot change the sharing');
      const r = await db.query(
        'DELETE FROM operator_shares WHERE operator_id = $1 AND pilot_id = $2 RETURNING pilot_id',
        [op.id, params.pilotId],
      );
      if (!r.length)
        throw notFound('this person has no direct access to the operator (they see it through an aircraft)');
      return undefined;
    },
  },
];
