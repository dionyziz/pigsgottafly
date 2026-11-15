// Operators (the club or owner who operates an aircraft): /api/operators[/:id[/shares|/files]].
// A pilot creates (owns) an operator and shares it like an aircraft (src/shared/sharing.ts), as a
// viewer or an editor. An aircraft is assigned to an operator (Aircraft.operatorId); whoever has
// access to that aircraft (its owner, or a pilot it is shared with) also VIEWS its operator,
// for as long as they have the aircraft: that access is derived, not stored, so it ends with the
// aircraft's share unless the operator is also shared with them directly.
//
// The operator's name is what the forms print as the operator (GenDec, FPL OPR/, the W&B sheet):
// GET /api/aircraft returns it as Aircraft.operator. An operator may require the W&B and
// performance sheets before each flight (requiresWbPerf): they are then e-mailed from the export
// to declarationsEmail (POST /api/flights/:id/declarations/send), the pilot in cc.
import type { AircraftFile, EpochMs, Id } from './types.js';
import type { AircraftRole, SharePerson, ShareRole } from './sharing.js';

export interface Operator {
  id: Id;
  /** e.g. 'AEROCLUB MESOGEION'. */
  name: string;
  phone: string;
  email: string;
  address: string;
  /** AFTN or other ATS contact, e.g. an ops office address; free text. */
  aftn: string;
  notes: string;
  /** The operator wants the W&B and performance sheets before each flight. */
  requiresWbPerf: boolean;
  /** Where those declarations go (required when requiresWbPerf). */
  declarationsEmail: string;
  created: EpochMs;
  updated: EpochMs;
}
/** POST /api/operators, PUT /api/operators/:id (PUT merges the given fields). */
export type OperatorInput = Omit<Operator, 'id' | 'created' | 'updated'>;

/** How the session pilot holds an operator. */
export interface OperatorAccess {
  role: AircraftRole;
  owner: Omit<SharePerson, 'role'>;
  /** Registrations of the pilot's aircraft operated by it (these give view access). */
  viaAircraft: string[];
}

/** GET /api/operators and /api/operators/:id. */
export type OperatorItem = Operator & {
  access: OperatorAccess;
  /** The aircraft the session pilot can see that are assigned to this operator. */
  aircraft: { id: Id; registration: string }[];
};

/** A person with access to an operator; `via`: the aircraft that give them (view) access. */
export interface OperatorPerson extends SharePerson {
  added: EpochMs | null;
  /** Registrations of the aircraft through which they see the operator ([] for a direct share). */
  via: string[];
  /** A direct share (can be changed or removed here); false: access only through aircraft. */
  direct: boolean;
}

/** GET/POST /api/operators/:id/shares, PUT/DELETE /api/operators/:id/shares/:pilotId. */
export interface OperatorSharing {
  operatorId: Id;
  name: string;
  role: AircraftRole;
  canManage: boolean;
  people: OperatorPerson[];
}
export interface OperatorShareAddRequest {
  email: string;
  role: ShareRole;
}

/** GET /api/operators/:id/files: the operations manual and other PDFs. */
export interface OperatorFiles {
  documents: AircraftFile[];
}

export const EMPTY_OPERATOR: OperatorInput = {
  name: '', phone: '', email: '', address: '', aftn: '', notes: '', requiresWbPerf: false, declarationsEmail: '',
};

/** A plausible single e-mail address. */
export const isEmail = (s: string) => /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(s.trim());
