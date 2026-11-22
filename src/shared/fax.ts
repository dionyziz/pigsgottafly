// A flight plan faxed to an ATS reporting office (api/_lib/filers/fax.ts): what the fax's pages
// show, drawn by the PDF page (src/pdf/main.tsx) in headless Chromium (api/_lib/sheetPdf.ts):
//   kind 'file'    a cover page (to the unit, from the pilot, the flight, how to reach the pilot)
//                  and the filled ICAO flight plan form, drawn from the filed FPL message
//   kind 'delay'   a cover page with the DLA message
//   kind 'cancel'  a cover page with the CNL message
// The server builds it from the stored plan and the pilot's profile; the page only bounds it.

export type FaxKind = 'file' | 'delay' | 'cancel';

export interface FaxDestination {
  /** E.164, '+302103532635'. */
  number: string;
  /** 'Athens Central AIS'. */
  unit: string;
}

export interface FplFaxContent {
  kind: FaxKind;
  to: FaxDestination;
  from: { name: string; phone: string; email: string };
  /** The ICAO FPL message as filed, '(FPL-…)'. */
  fpl: string;
  /** AFTN addressees the pilot reviewed (written on the form). */
  addresses: string[];
  /** The message this fax carries: the FPL, or its DLA / CNL. */
  message: string;
  /** Epoch ms. */
  sentAt: number;
  /** The PIC's e-signature on the form ("filed by"). */
  signature: { name: string; signedAt: number } | null;
}

type Obj = Record<string, unknown>;
const str = (v: unknown, max: number): string =>
  (typeof v === 'string' ? v : '')
    // eslint-disable-next-line no-control-regex -- control characters are what this strips (newlines kept)
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .slice(0, max);

export function fplFaxContentOf(input: unknown): FplFaxContent {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('content must be an object');
  const c = input as Obj;
  const kind: FaxKind = c.kind === 'delay' || c.kind === 'cancel' ? c.kind : 'file';
  const to = (c.to ?? {}) as Obj;
  const from = (c.from ?? {}) as Obj;
  const sig = c.signature as Obj | null | undefined;
  return {
    kind,
    to: { number: str(to.number, 20), unit: str(to.unit, 80) },
    from: { name: str(from.name, 100), phone: str(from.phone, 40), email: str(from.email, 200) },
    fpl: str(c.fpl, 4000),
    addresses: (Array.isArray(c.addresses) ? c.addresses : []).slice(0, 50).map((a) => str(a, 8)),
    message: str(c.message, 4000),
    sentAt: Number.isFinite(c.sentAt) ? Number(c.sentAt) : 0,
    signature:
      sig && typeof sig.name === 'string' && Number.isFinite(sig.signedAt)
        ? { name: str(sig.name, 100), signedAt: Number(sig.signedAt) }
        : null,
  };
}
