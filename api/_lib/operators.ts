// Who may do what with an operator (src/shared/operators.ts), like access.ts for aircraft. The
// owner is operators.pilot_id; operator_shares gives other pilots 'view' or 'edit'; and anyone with
// access to an aircraft assigned to the operator views it (derived here on every query, so it ends
// with that aircraft access, unless the operator is also shared with them directly). No access
// answers 404, too little 403.
import type { Operator, OperatorItem } from '../../src/shared/operators.js';
import type { AircraftRole } from '../../src/shared/sharing.js';
import { accessibleSql, personName } from './access.js';
import type { Queryable } from './db.js';
import { HttpError, notFound } from './http.js';

type Row = Record<string, any>;

/** SQL: the registrations of the aircraft of operator `alias` that pilot `param` can access. */
const viaSql = (alias: string, param: string) =>
  `ARRAY(SELECT a_.registration FROM aircraft a_ WHERE a_.operator_id = ${alias}.id AND ${accessibleSql('a_', param)} ORDER BY a_.registration)`;

// functions, not constants: access.ts and this module import each other indirectly (routes/files.ts)
const SELECT =
  () => `SELECT o.*, ow.email AS owner_email, ow.full_name AS owner_full_name, ow.name AS owner_name, s.role AS share_role,
    ${viaSql('o', '$1')} AS via_aircraft,
    COALESCE((SELECT json_agg(json_build_object('id', a2.id, 'registration', a2.registration) ORDER BY a2.registration)
      FROM aircraft a2 WHERE a2.operator_id = o.id AND ${accessibleSql('a2', '$1')}), '[]'::json) AS aircraft_json
  FROM operators o JOIN pilots ow ON ow.id = o.pilot_id
  LEFT JOIN operator_shares s ON s.operator_id = o.id AND s.pilot_id = $1`;
const VISIBLE = () =>
  `(o.pilot_id = $1 OR s.pilot_id IS NOT NULL OR EXISTS (SELECT 1 FROM aircraft a3 WHERE a3.operator_id = o.id AND ${accessibleSql('a3', '$1')}))`;

export function toOperator(r: Row): Operator {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone ?? '',
    email: r.email ?? '',
    address: r.address ?? '',
    aftn: r.aftn ?? '',
    notes: r.notes ?? '',
    requiresWbPerf: !!r.requires_wb_perf,
    declarationsEmail: r.declarations_email ?? '',
    created: Number(r.created),
    updated: Number(r.updated),
  };
}

function roleOf(r: Row, pilotId: string): AircraftRole {
  if (r.pilot_id === pilotId) return 'owner';
  return r.share_role === 'edit' ? 'edit' : 'view';
}

function toItem(r: Row, pilotId: string): OperatorItem & { _owner: string } {
  const aircraft = typeof r.aircraft_json === 'string' ? JSON.parse(r.aircraft_json) : (r.aircraft_json ?? []);
  return {
    ...toOperator(r),
    access: {
      role: roleOf(r, pilotId),
      owner: { pilotId: r.pilot_id, name: personName(r.owner_full_name, r.owner_name), email: r.owner_email ?? '' },
      viaAircraft: (r.via_aircraft ?? []) as string[],
    },
    aircraft,
    _owner: r.pilot_id,
  };
}
const strip = ({ _owner: _o, ...x }: OperatorItem & { _owner: string }): OperatorItem => x;

/** Every operator the pilot owns, is shared with, or sees through an aircraft, by name. */
export async function listOperators(db: Queryable, pilotId: string): Promise<OperatorItem[]> {
  const rows = await db.query(`${SELECT()} WHERE ${VISIBLE()} ORDER BY lower(o.name), o.created`, [pilotId]);
  return rows.map((r) => strip(toItem(r, pilotId)));
}

const RANK: Record<AircraftRole, number> = { view: 1, edit: 2, owner: 3 };

/** The operator (with the pilot's access) when the pilot has at least `need`; 404 without access, 403 with less. */
export async function operatorFor(
  db: Queryable,
  pilotId: string,
  id: string,
  need: AircraftRole = 'view',
): Promise<OperatorItem & { _owner: string }> {
  const [r] = await db.query(`${SELECT()} WHERE o.id = $2 AND ${VISIBLE()}`, [pilotId, id]);
  if (!r) throw notFound('no such operator');
  const item = toItem(r, pilotId);
  if (RANK[item.access.role] < RANK[need]) {
    throw new HttpError(
      403,
      need === 'owner' ? 'only the owner can do this' : 'you can view this operator but not change it',
    );
  }
  return item;
}
export const operatorItem = strip;
