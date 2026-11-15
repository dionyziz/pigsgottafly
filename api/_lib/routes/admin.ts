// Admin (read-only): GET /admin/pilots lists every pilot with their activity and sharing. Only for
// the admins of ADMIN_EMAILS (Ctx.isAdmin); everyone else gets 403.
import type { Route } from '../http.js';
import { HttpError } from '../http.js';
import { personName } from '../access.js';
import type { AdminPilot, AdminShare } from '../../../src/shared/api.js';

type Row = Record<string, any>;

export const routes: Route[] = [
  {
    method: 'GET', path: '/admin/pilots',
    async handler({ db, isAdmin }): Promise<AdminPilot[]> {
      if (!isAdmin) throw new HttpError(403, 'admins only');
      const pilots = await db.query(`SELECT p.id, p.email, p.name, p.full_name, p.created, p.last_login,
          (SELECT count(*)::int FROM flights f WHERE f.pilot_id = p.id AND NOT f.deleted) AS flights,
          (SELECT count(*)::int FROM flights f WHERE f.pilot_id = p.id AND f.deleted) AS trashed,
          (SELECT count(*)::int FROM aircraft a WHERE a.pilot_id = p.id) AS aircraft,
          (SELECT count(*)::int FROM passengers x WHERE x.pilot_id = p.id) AS passengers,
          (SELECT count(*)::int FROM operators o WHERE o.pilot_id = p.id) AS operators
        FROM pilots p ORDER BY p.created DESC`);
      const shares = await db.query(`
        SELECT 'aircraft' AS kind, a.registration AS what, a.pilot_id AS owner_id, s.pilot_id AS with_id, s.role
          FROM aircraft_shares s JOIN aircraft a ON a.id = s.aircraft_id
        UNION ALL
        SELECT 'operator', o.name, o.pilot_id, s.pilot_id, s.role FROM operator_shares s JOIN operators o ON o.id = s.operator_id
        ORDER BY 2`);
      const label = new Map<string, string>(pilots.map((p: Row) => [p.id, personName(p.full_name, p.name) || p.email || p.id]));
      const share = (s: Row, other: string): AdminShare => ({ kind: s.kind, name: s.what, role: s.role, pilot: label.get(other) ?? other });
      return pilots.map((p: Row) => ({
        id: p.id, email: p.email ?? '', name: personName(p.full_name, p.name), created: Number(p.created), lastLogin: Number(p.last_login),
        flights: p.flights, trashedFlights: p.trashed, aircraft: p.aircraft, passengers: p.passengers, operators: p.operators,
        sharedByThem: shares.filter((s: Row) => s.owner_id === p.id).map((s: Row) => share(s, s.with_id)),
        sharedWithThem: shares.filter((s: Row) => s.with_id === p.id).map((s: Row) => share(s, s.owner_id)),
      }));
    },
  },
];
