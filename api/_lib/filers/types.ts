// The filing driver interface: every backend that can send a flight plan (autorouter, fax) looks
// the same to routes/filing.ts, which picks one per flight (select.ts) and records which one filed,
// so the plan's delay and cancellation go to the same backend.
import type { FilerCapabilities, FilerId, FilingStatus } from '../../../src/shared/briefing.js';
import type { FaxDestination } from '../../../src/shared/fax.js';
import type { Pilot } from '../../../src/shared/types.js';
import type { AftnMessage } from '../autorouter.js';
import type { Queryable } from '../db.js';

/**
 * A backend's refusal or failure. `transient`: the service is down, timed out or refused for its own
 * reasons, so the next backend may file instead; otherwise the plan itself was refused (the pilot's
 * to fix) and no other backend is tried. `status` is the HTTP status the route answers with.
 */
export class FilerError extends Error {
  constructor(
    message: string,
    public status = 502,
    public transient = status >= 500,
  ) {
    super(message);
  }
}

/** The plan as the route checked it. */
export interface FilePlan {
  flightId: string;
  pilot: Pilot;
  /** '(FPL-…)' */
  fpl: string;
  addresses: string[];
  eobt: number;
  /** The departure aerodrome's ICAO (item 13), '' when unknown. */
  adep: string;
}

/** The flight_filings row a delay, cancellation or status refers to. */
export interface FiledRef {
  flightId: string;
  pilot: Pilot;
  providerId: string;
  fpl: string;
  addresses: string[];
  eobt: number | null;
  status: FilingStatus;
  faxTo: FaxDestination | null;
}

export interface FileOutcome {
  providerId: string;
  status: FilingStatus;
  /** Shown with the record ('' for none). */
  message: string;
  /** For the filing log: 'filed (id 2763)', 'faxed to Athens Central AIS (+302103532635)'. */
  logText: string;
  faxTo?: FaxDestination | null;
  /** Run once the route has written the record (a delivery already known settles it). */
  after?: (db: Queryable) => Promise<void>;
}

export interface ChangeOutcome {
  /** The record's new status (unchanged when absent). */
  status?: FilingStatus;
  message: string;
  logText: string;
  /** The ICAO message the backend itself wrote (a faxed DLA / CNL), for the e-mail copy. */
  sent?: string;
  after?: (db: Queryable) => Promise<void>;
}

export interface StatusOutcome {
  status: FilingStatus;
  eobt?: number | null;
  message?: string;
  logText: string;
}

export interface Availability {
  available: boolean;
  reason: string | null;
  /** Available once the pilot connects (or reconnects) their own account. */
  connect?: 'connect' | 'reconnect';
}

export interface Filer {
  id: FilerId;
  /** How the UI names it for a flight from `adep`: 'autorouter', 'Fax to Athens Central AIS'. */
  labelFor: (adep: string) => string;
  capabilities: FilerCapabilities;
  /** Whether this pilot may file this flight through it (configuration, allow-lists, the departure). */
  availableFor: (pilot: Pilot, flight: { adep: string }) => Availability;
  file: (db: Queryable, plan: FilePlan) => Promise<FileOutcome>;
  delay: (db: Queryable, ref: FiledRef, eobt: number) => Promise<ChangeOutcome>;
  cancel: (db: Queryable, ref: FiledRef, reason: string) => Promise<ChangeOutcome>;
  status: (db: Queryable, ref: FiledRef) => Promise<StatusOutcome>;
  /** What was just transmitted for the plan, for the e-mail copy ([] = the plan the app sent). */
  transmitted: (ref: { providerId: string; faxTo: FaxDestination | null }, message: string) => Promise<AftnMessage[]>;
}
