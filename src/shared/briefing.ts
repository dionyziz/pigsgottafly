// NOTAM briefing and flight-plan filing: the bodies of the /api routes that serve them
// (api/_lib/routes/notams.ts, api/_lib/routes/filing.ts). See PLAN-v3.md "NOTAMs relevant to the
// flight" and "Filing the flight plan via autorouter".
import type { NotamArea } from './notamAreas.js';
import type { EpochMs, Id } from './types.js';

// ---------------------------------------------------------------- NOTAMs
// GET /api/flights/:id/notams[?maxAltFt=&corridorNm=&refresh=1] → NotamBriefing
//   maxAltFt: highest planned altitude (the client's computed altitudes; default 10000 ft);
//   corridorNm: half-width of the route corridor (default 10 NM). The last briefing is cached per
//   flight (10 min) unless refresh=1 or the parameters changed.

export type NotamSource = 'autorouter';

export interface Notam {
  /** 'A1234/26' (series, number, year). */
  key: string;
  /** NEW, REPLACE, CANCEL. */
  type: 'N' | 'R' | 'C';
  /** NOTAMR/C: the NOTAM replaced or cancelled, e.g. 'A1200/26'. */
  refers: string | null;
  /** Item A: aerodromes / FIR the NOTAM applies to. */
  itemA: string[];
  fir: string;
  /** Q code, e.g. 'QRTCA'. */
  qcode: string;
  /** Decoded Q code (ICAO Doc 8126), e.g. 'Temporary restricted area', 'Activated'; null if unknown. */
  subject: string | null;
  condition: string | null;
  /** Q line: 'I', 'V' or 'IV'. */
  traffic: string;
  purpose: string;
  scope: string;
  /** Q line vertical limits, ft (FL × 100). */
  lowerFt: number;
  upperFt: number;
  /** Q line centre and radius; null when not given. */
  center: { lat: number; lon: number } | null;
  radiusNm: number | null;
  /** The areas item E describes (src/shared/notamAreas.ts); empty: the Q-line circle stands in. */
  areas?: NotamArea[];
  /** Items B and C; to = null: permanent. */
  from: EpochMs;
  to: EpochMs | null;
  /** Item C is an estimate (EST). */
  estimated: boolean;
  /** Item D (schedule), E (text), F and G (vertical limits as written). */
  schedule: string | null;
  text: string;
  lowerText: string | null;
  upperText: string | null;
  /** The NOTAM in ICAO format (Q) A) B) C) D) E) F) G)). */
  raw: string;
  /** Relevant to this flight (shown by default). */
  relevant: boolean;
  /** Why it is shown ('departure LGAV', '3 NM from leg 2') or hidden ('outside the time window', …). */
  reasons: string[];
  /** Index of the nearest leg (0-based) for highlighting, or null (aerodrome/FIR-wide NOTAMs). */
  legIndex: number | null;
}

export interface NotamBriefing {
  /** 'ok': fetched; 'not-configured': no NOTAM source available (see message); 'error': the source failed. */
  status: 'ok' | 'not-configured' | 'error';
  source: NotamSource | null;
  message: string | null;
  fetched: EpochMs | null;
  /** Block start − margin … block stop + margin, UTC. */
  window: { from: EpochMs; to: EpochMs };
  params: { maxAltFt: number; corridorNm: number; marginMin: number };
  /** Item A locations queried (route aerodromes, alternates, aerodromes near the route, FIR). */
  locations: string[];
  /** Relevant first (by location, then start time), then the hidden ones. */
  notams: Notam[];
  relevantCount: number;
  hiddenCount: number;
}

// ---------------------------------------------------------------- filing
// GET  /api/flights/:id/filing[?maxAltFt=]        → FilingState
// POST /api/flights/:id/filing   FileRequest      → FilingState   (503 { error } when filing is not enabled)
// POST /api/flights/:id/filing/delay  { eobt }    → FilingState
// POST /api/flights/:id/filing/cancel { reason }  → FilingState
// POST /api/flights/:id/filing/refresh            → FilingState   (polls the status)
// GET  /api/filing/log                            → FilingLogEntry[] (the pilot's actions, newest first)

/** autorouter flight plan status codes (+ 'not-filed'). */
export type FilingStatus =
  | 'not-filed'
  | 'created'
  | 'filed'
  | 'manual_correction'
  | 'suspended'
  | 'departed'
  | 'terminated'
  | 'arriving'
  | 'arrived'
  | 'closed'
  | 'cancelled'
  | 'rejected'
  | 'unknown';

/** How a filing status reads (the editor, the export, the flight list). */
export const FILING_STATUS_LABEL: Record<FilingStatus, string> = {
  'not-filed': 'Not filed',
  created: 'Created',
  filed: 'Filed',
  manual_correction: 'Queued for manual correction',
  suspended: 'Suspended',
  departed: 'Departed',
  terminated: 'Terminated',
  arriving: 'Arriving',
  arrived: 'Arrived',
  closed: 'Closed',
  cancelled: 'Cancelled',
  rejected: 'Rejected',
  unknown: 'Unknown',
};

/** One AFTN addressee proposed for the plan (AIP Greece ENR 1.11), for the pilot to review. */
export interface Addressee {
  /** 8 letters, e.g. 'LGGGZFZX'. */
  address: string;
  /** Why: 'ATHINAI ACC (VFR)', 'ATHINAI TMA', 'departure LGTT', 'LGEL CTR/ATZ crossed'. */
  reasons: string[];
}

export interface FilingRecord {
  provider: 'autorouter';
  /** autorouter flight plan id. */
  providerId: string | null;
  status: FilingStatus;
  /** Estimated off-block time as filed. */
  eobt: EpochMs | null;
  /** The ICAO FPL message as filed. */
  fpl: string;
  addresses: string[];
  /** Last message from the provider (error, rejection reason). */
  message: string;
  filed: EpochMs | null;
  updated: EpochMs;
  polled: EpochMs | null;
}

export interface FilingLogEntry {
  id: Id;
  flightId: Id | null;
  at: EpochMs;
  /** copy: the e-mail copy of what was sent (api/_lib/fplCopy.ts). */
  action: 'file' | 'delay' | 'cancel' | 'refresh' | 'copy';
  ok: boolean;
  message: string;
}

export interface FplCopyRecipient {
  email: string;
  /** Who asks for it: the operator's name, the aerodrome's ICAO. */
  for: string;
}

export interface FilingState {
  /** False when the server cannot file (no autorouter account, filing off, pilot not listed). */
  enabled: boolean;
  /** Why filing is disabled (null when enabled). */
  reason: string | null;
  addressees: Addressee[];
  /** Who gets an e-mail copy of the plan (its operator, the route's aerodromes that ask for one). */
  copyTo: FplCopyRecipient[];
  filing: FilingRecord | null;
  /** This flight's actions, newest first. */
  log: FilingLogEntry[];
}

export interface FileRequest {
  /** The ICAO 2012 FPL message, '(FPL-…)'. */
  fpl: string;
  /** Reviewed AFTN addressees (8 letters each). */
  addresses: string[];
  /** EOBT; default: the flight's date + block start. */
  eobt?: EpochMs;
  /** The e-mail copies to send, out of FilingState.copyTo (default all of them). */
  copyTo?: string[];
}
