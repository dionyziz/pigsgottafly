// App Store subscriptions (StoreKit 2 in the iOS app). Apple signs every transaction and notification as a
// JWS whose x5c chain ends in Apple Root CA - G3; we check the chain and the signature ourselves instead of
// calling Apple, as Apple's App Store Server Library does.
//   https://developer.apple.com/documentation/appstoreservernotifications/responsebodyv2decodedpayload
//   https://developer.apple.com/documentation/appstoreserverapi/jwstransactiondecodedpayload
// Sandbox transactions are accepted in production too: App Review buys with sandbox accounts against the
// production server, and sandbox subscriptions (TestFlight) lapse within hours.
import crypto from 'node:crypto';

import type { Queryable } from '../db.js';
import { HttpError } from '../http.js';
import { saveSubscription } from './entitlement.js';

export const APPLE_BUNDLE_ID = 'com.pigsgottafly.app';
export const APPLE_PRODUCT_ID = 'com.pigsgottafly.app.yearly';

/** SHA-256 of Apple Root CA - G3 (https://www.apple.com/certificateauthority/AppleRootCA-G3.cer). */
const APPLE_ROOT_G3_SHA256 =
  '63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79';
// Apple's marker extensions: the leaf signs App Store receipts (1.2.840.113635.100.6.11.1), the intermediate
// is Apple's WWDR CA (1.2.840.113635.100.6.2.1). X509Certificate does not list extensions, so their DER OIDs
// are looked for in the raw certificates.
const LEAF_OID = Buffer.from('060a2a864886f76364060b01', 'hex');
const INTERMEDIATE_OID = Buffer.from('060a2a864886f76364060201', 'hex');

export interface AppleTrust {
  /** Fingerprint of the root the chain must end in; tests sign with their own. */
  rootSha256: string;
}
export const APPLE_TRUST: AppleTrust = { rootSha256: APPLE_ROOT_G3_SHA256 };

const b64json = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

export function verifyAppleJws<T>(jws: string, trust: AppleTrust = APPLE_TRUST, now = new Date()): T {
  const parts = String(jws).split('.');
  if (parts.length !== 3) throw new Error('malformed JWS');
  const header = b64json(parts[0]) as { alg?: string; x5c?: string[] };
  if (header.alg !== 'ES256' || !Array.isArray(header.x5c) || header.x5c.length !== 3) throw new Error('bad header');
  const [leaf, mid, root] = header.x5c.map((c) => new crypto.X509Certificate(Buffer.from(c, 'base64')));
  if (root.fingerprint256 !== trust.rootSha256) throw new Error('untrusted root');
  if (!mid.verify(root.publicKey) || !leaf.verify(mid.publicKey)) throw new Error('broken chain');
  for (const c of [leaf, mid, root])
    if (now < new Date(c.validFrom) || now > new Date(c.validTo)) throw new Error('certificate expired');
  if (!leaf.raw.includes(LEAF_OID) || !mid.raw.includes(INTERMEDIATE_OID))
    throw new Error('not an App Store certificate');
  const ok = crypto.verify(
    'sha256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    { key: leaf.publicKey, dsaEncoding: 'ieee-p1363' },
    Buffer.from(parts[2], 'base64url'),
  );
  if (!ok) throw new Error('bad signature');
  return b64json(parts[1]) as T;
}

export interface AppleTransaction {
  originalTransactionId: string;
  transactionId: string;
  bundleId: string;
  productId: string;
  expiresDate?: number;
  revocationDate?: number;
  appAccountToken?: string;
  environment?: string;
  signedDate?: number;
}
interface AppleRenewal {
  autoRenewStatus?: number;
}
interface AppleNotification {
  notificationType: string;
  subtype?: string;
  signedDate?: number;
  data?: { bundleId?: string; signedTransactionInfo?: string; signedRenewalInfo?: string };
}

/**
 * Stores a verified transaction. The owner is, in order: the pilot already holding this subscription (an
 * Apple ID's subscription stays with the account that bought it), the pilot whose appAccountToken the app
 * set on the purchase, else `fallbackPilotId` (the signed-in pilot who sent it from the app).
 */
async function applyTransaction(
  db: Queryable,
  t: AppleTransaction,
  autoRenew: boolean,
  eventAt: number,
  fallbackPilotId: string | null,
): Promise<string | null> {
  if (t.bundleId !== APPLE_BUNDLE_ID) throw new HttpError(400, 'another app’s transaction');
  if (t.productId !== APPLE_PRODUCT_ID) return null;
  const [known] = await db.query(`SELECT pilot_id FROM subscriptions WHERE source = 'apple' AND external_id = $1`, [
    t.originalTransactionId,
  ]);
  const [byToken] = t.appAccountToken
    ? await db.query('SELECT id FROM pilots WHERE apple_account_token = $1', [t.appAccountToken.toLowerCase()])
    : [];
  const pilotId = known?.pilot_id ?? byToken?.id ?? fallbackPilotId;
  if (!pilotId) return null;
  await saveSubscription(db, {
    source: 'apple',
    externalId: t.originalTransactionId,
    pilotId,
    status: t.revocationDate ? 'revoked' : t.environment === 'Sandbox' ? 'sandbox' : 'active',
    periodEnd: t.revocationDate ? 0 : Number(t.expiresDate) || 0,
    autoRenew: !t.revocationDate && autoRenew,
    eventAt,
    data: t,
  });
  return pilotId;
}

/** POST from the app right after a purchase or restore: Transaction.jwsRepresentation. */
export async function applyAppTransaction(
  db: Queryable,
  jws: string,
  pilotId: string,
  trust: AppleTrust = APPLE_TRUST,
): Promise<string | null> {
  let t: AppleTransaction;
  try {
    t = verifyAppleJws<AppleTransaction>(jws, trust);
  } catch {
    throw new HttpError(400, 'not a valid App Store transaction');
  }
  // the app only knows a transaction is current; whether it renews arrives with Apple's notifications
  return applyTransaction(db, t, true, Number(t.signedDate) || Date.now(), pilotId);
}

/** App Store Server Notifications V2: { signedPayload }. Returns false for notifications we do not act on. */
export async function applyAppleNotification(
  db: Queryable,
  signedPayload: string,
  trust: AppleTrust = APPLE_TRUST,
): Promise<boolean> {
  let n: AppleNotification;
  let t: AppleTransaction | null;
  let renewal: AppleRenewal | null;
  try {
    n = verifyAppleJws<AppleNotification>(signedPayload, trust);
    t = n.data?.signedTransactionInfo ? verifyAppleJws<AppleTransaction>(n.data.signedTransactionInfo, trust) : null;
    renewal = n.data?.signedRenewalInfo ? verifyAppleJws<AppleRenewal>(n.data.signedRenewalInfo, trust) : null;
  } catch {
    throw new HttpError(400, 'not a valid App Store notification');
  }
  if (!t) return false; // TEST notifications, and summaries of renewal extensions
  const autoRenew = renewal ? renewal.autoRenewStatus === 1 : true;
  return !!(await applyTransaction(db, t, autoRenew, Number(n.signedDate) || Date.now(), null));
}
