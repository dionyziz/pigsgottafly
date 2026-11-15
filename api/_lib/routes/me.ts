// GET /me, PUT /me: the session pilot's profile.
import type { Route } from '../http.js';
import { badRequest } from '../http.js';
import { optNum, personColumns, str, toPilot } from '../rows.js';
import type { PilotUpdate, PilotSettings } from '../../../src/shared/types.js';
import { WIND_MODELS } from '../../../src/shared/constants.js';

function settingsPatch(s: unknown): Partial<PilotSettings> {
  if (!s || typeof s !== 'object') throw badRequest('settings must be an object');
  const i = s as Record<string, unknown>;
  const out: Partial<PilotSettings> = {};
  for (const k of ['taxiOutMin', 'taxiInMin', 'reserveMin'] as const) if (k in i) out[k] = optNum(i[k], k, 0, 600);
  if ('finalReserveMin' in i) out.finalReserveMin = optNum(i.finalReserveMin, 'finalReserveMin', 0, 600) ?? 0;
  if ('enrouteAerodromeRadiusNm' in i) out.enrouteAerodromeRadiusNm = optNum(i.enrouteAerodromeRadiusNm, 'enrouteAerodromeRadiusNm', 0, 50) ?? 2;
  if ('windModel' in i) {
    if (!(String(i.windModel) in WIND_MODELS)) throw badRequest('unknown windModel');
    out.windModel = i.windModel as PilotSettings['windModel'];
  }
  return out;
}

export const routes: Route[] = [
  { method: 'GET', path: '/me', handler: async ({ pilot }) => pilot },
  {
    method: 'PUT', path: '/me',
    async handler({ db, pilot, body }) {
      const input = (await body()) as PilotUpdate;
      const p = personColumns(input, pilot);
      const licenceNo = 'licenceNo' in input ? str(input.licenceNo, 'licenceNo', 60) : pilot.licenceNo;
      let home = pilot.homeAerodrome;
      if ('homeAerodrome' in input) home = input.homeAerodrome ? str(input.homeAerodrome, 'homeAerodrome', 40).toUpperCase() || null : null;
      let defaultAircraftId = pilot.defaultAircraftId;
      if ('defaultAircraftId' in input) {
        defaultAircraftId = input.defaultAircraftId || null;
        if (defaultAircraftId) {
          const own = await db.query('SELECT 1 FROM aircraft WHERE id = $1 AND pilot_id = $2', [defaultAircraftId, pilot.id]);
          if (!own.length) throw badRequest('no such aircraft');
        }
      }
      const settings = { ...pilot.settings, ...('settings' in input ? settingsPatch(input.settings) : {}) };
      const [row] = await db.query(
        `UPDATE pilots SET full_name = $2, phone = $3, date_of_birth = $4, weight_kg = $5, id_number = $6, id_type = $7, nationality = $8,
           relation = $9, licence_no = $10, home_aerodrome = $11, default_aircraft_id = $12, settings = $13::jsonb
         WHERE id = $1 RETURNING *`,
        [pilot.id, p.fullName, p.phone, p.dateOfBirth, p.weightKg, p.idNumber, p.idType, p.nationality, p.relation, licenceNo, home, defaultAircraftId, JSON.stringify(settings)],
      );
      return toPilot(row);
    },
  },
];
