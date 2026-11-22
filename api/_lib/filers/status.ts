import type { FilingStatus } from '../../../src/shared/briefing.js';

const STATUSES = new Set<FilingStatus>([
  'created',
  'filed',
  'manual_correction',
  'suspended',
  'departed',
  'terminated',
  'arriving',
  'arrived',
  'closed',
  'cancelled',
  'rejected',
  'sending',
  'delivered',
  'failed',
]);

export const toStatus = (s: string): FilingStatus =>
  STATUSES.has(s as FilingStatus) ? (s as FilingStatus) : 'unknown';

/** Plans in these states can no longer be delayed or cancelled (a failed fax never reached anyone). */
export const FINAL = new Set<FilingStatus>(['closed', 'cancelled', 'rejected', 'arrived', 'failed']);
