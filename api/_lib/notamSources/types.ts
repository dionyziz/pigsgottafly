// The NOTAM source driver interface. Every backend (autorouter, Notamify, …) answers the same query
// (item A locations + a validity window) with NOTAMs in one normalized form, RawNotam; multiplex.ts
// queries the sources available to the pilot together and merges what they return, and notams.ts
// (toNotam, assessNotams) turns the merged list into the briefing.
import type { NotamSource } from '../../../src/shared/briefing.js';
import type { LatLon } from '../../../src/shared/types.js';

export type { NotamSource };

/** A NOTAM number: series, number, year (2 digits), e.g. A1234/26. */
export interface NotamId {
  series: string;
  number: number;
  year: number;
}

/** One NOTAM as a source returned it, normalized. Unknown fields are null. */
export interface RawNotam {
  source: NotamSource;
  /** The source's own id for it (diagnostics). */
  sourceId: string | null;
  series: string | null;
  number: number | null;
  /** Two digits. */
  year: number | null;
  /** NOTAMN, NOTAMR, NOTAMC. */
  type: 'N' | 'R' | 'C';
  /** NOTAMR/C: the NOTAM replaced or cancelled. */
  refers: NotamId | null;
  // Q line
  fir: string | null;
  /** Q code letters 2–3 (subject) and 4–5 (condition). */
  code23: string | null;
  code45: string | null;
  traffic: string | null;
  purpose: string | null;
  scope: string | null;
  /** Flight levels (hundreds of feet). */
  lowerFl: number | null;
  upperFl: number | null;
  center: LatLon | null;
  radiusNm: number | null;
  /** Item A. */
  itemA: string[];
  /** Items B and C, epoch ms; to = null: PERM. */
  from: number | null;
  to: number | null;
  estimated: boolean;
  itemD: string | null;
  itemE: string | null;
  itemF: string | null;
  itemG: string | null;
  /** The NOTAM in ICAO format as the source gave it, when it did. */
  raw: string | null;
  /** The location it was returned for (a source answering per location). */
  location?: string | null;
  /** When it was issued, epoch ms (sources that say). */
  issued?: number | null;
}

export interface NotamQuery {
  /** Item A locations: the route's aerodromes, aerodromes near it, the FIR (LGGG). */
  locations: string[];
  /** Validity window, epoch ms. */
  window: { from: number; to: number };
  /** Aborted when the multiplexer stops waiting for this source. */
  signal?: AbortSignal;
}

/** Who asks: the signed-in pilot and the owner of the flight being briefed. */
export interface NotamAccess {
  pilotId: string;
  ownerId: string;
}

export interface NotamSourceDriver {
  id: NotamSource;
  /** As shown to the pilot. */
  label: string;
  /**
   * The licensing gate: whether this source may be used for (and its NOTAMs shown to) this pilot on
   * this flight. A source that is not available is not queried, so nothing it returned reaches them.
   */
  availableFor: (access: NotamAccess) => boolean;
  fetch: (q: NotamQuery) => Promise<RawNotam[]>;
  /** How long the multiplexer waits for it. */
  timeoutMs?: number;
  /** Results kept per location and window (cache.ts), to save paid requests; 0/absent: not cached. */
  cacheTtlMs?: number;
}

/** A source failed in a way worth telling the pilot (its message is shown). */
export class NotamSourceError extends Error {}

/** 'A1234/26' (series, 4-digit number, 2-digit year). */
export const notamKey = (id: NotamId): string =>
  `${id.series}${String(id.number).padStart(4, '0')}/${String(id.year % 100).padStart(2, '0')}`;

/** 'A1234/26', 'A0012/2026', 'A 12/26' → NotamId; null when it does not read. */
export function parseNotamId(s: string | null | undefined): NotamId | null {
  const m = /^\s*([A-Z])\s*(\d{1,5})\s*\/\s*(\d{2}|\d{4})\s*$/i.exec(String(s ?? ''));
  return m ? { series: m[1].toUpperCase(), number: Number(m[2]), year: Number(m[3]) % 100 } : null;
}

/** An empty RawNotam of a source, to fill. */
export const blankNotam = (source: NotamSource): RawNotam => ({
  source,
  sourceId: null,
  series: null,
  number: null,
  year: null,
  type: 'N',
  refers: null,
  fir: null,
  code23: null,
  code45: null,
  traffic: null,
  purpose: null,
  scope: null,
  lowerFl: null,
  upperFl: null,
  center: null,
  radiusNm: null,
  itemA: [],
  from: null,
  to: null,
  estimated: false,
  itemD: null,
  itemE: null,
  itemF: null,
  itemG: null,
  raw: null,
});
