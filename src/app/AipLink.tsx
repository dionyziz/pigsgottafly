// An AIP reference ('AD 2 LGAV', 'ENR 5.1', 'LGAV AD 2.3') as a link to the official AIP Greece PDF of that
// section (src/data/aipLinks.ts), opening in a new tab.
import { Fragment, type ReactNode } from 'react';
import { aipUrl } from '../data/aipLinks';

export function AipLink({
  refText,
  children,
  className,
}: {
  refText: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={aipUrl(refText)}
      target="_blank"
      rel="noopener noreferrer"
      className={'aip-link' + (className ? ' ' + className : '')}
      data-testid="aip-link"
      title={`Open AIP Greece ${refText} (PDF)`}
    >
      {children ?? <>AIP {refText}</>}
      <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true" className="aip-link-ext">
        <path
          d="M4 1.5H1.5v7h7V6M6 1.5h2.5V4M8.5 1.5 4.5 5.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </a>
  );
}

/**
 * AIP references inside a text ('LGTT closed at 16:20Z: … (AIP AD 1.6.5.3).', 'LGAV: handling H24 (AIP AD 2.3)')
 * as links to their PDFs. 'AD 2.x' without an aerodrome takes the nearest ICAO before it in the text.
 */
export const AIP_REF_RE =
  /\b(?:LG[A-Z]{2} )?(?:AD 2(?:\.\d+)*(?: LG[A-Z]{2})?|AD [013](?:\.\d+)+|(?:ENR|GEN) \d(?:\.\d+)+)/g;

export function aipRefParts(text: string): { text: string; ref?: string }[] {
  const out: { text: string; ref?: string }[] = [];
  let at = 0;
  for (const m of text.matchAll(AIP_REF_RE)) {
    const s = m[0],
      i = m.index ?? 0;
    let ref: string | null = s;
    if (/^AD 2\b/.test(s) && !/LG[A-Z]{2}/.test(s)) {
      const before = [...text.slice(0, i).matchAll(/\bLG[A-Z]{2}\b/g)].pop();
      ref = before ? `${before[0]} ${s}` : null;
    }
    if (!ref) continue;
    if (i > at) out.push({ text: text.slice(at, i) });
    out.push({ text: s, ref });
    at = i + s.length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

export function AipRefText({ text }: { text: string }) {
  return (
    <>
      {aipRefParts(text).map((p, i) =>
        p.ref ? (
          <AipLink key={i} refText={p.ref}>
            {p.text}
          </AipLink>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </>
  );
}
