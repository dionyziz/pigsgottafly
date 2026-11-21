// Out and back: a flight page (the editor, File & forms) links to another page to fix something (a
// passenger's e-mail, the profile, the aircraft, the operator) with ?back=<where the pilot was>. That
// page shows "← Back to Form 731" at the top (FlowBack, in the Shell) and, when it was opened to fix
// one thing (the passenger dialog), goes back by itself once that is done.
import { useCallback } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';

import { EXPORT_LABEL, EXPORT_REDIRECTS } from '../shared/constants';

export const BACK_PARAM = 'back';

/** An in-app path ('/…', not '//host', no scheme), else null. */
export function safePath(p: string | null | undefined): string | null {
  if (!p || !p.startsWith('/') || p.startsWith('//') || p.startsWith('/\\')) return null;
  try {
    const base = 'https://app.invalid';
    return new URL(p, base).origin === base ? p : null;
  } catch {
    return null;
  }
}

/** Where a link from this location comes back to: the same page, without one-off params (focus). */
export function backTarget(pathname: string, search = '', hash = ''): string {
  const q = new URLSearchParams(search);
  q.delete('focus');
  q.delete(BACK_PARAM);
  const s = q.toString();
  return pathname + (s ? `?${s}` : '') + hash;
}

/** `to` with ?back=; links within the flight pages are left alone. */
export function withBack(to: string, back: string | null): string {
  if (!back || !safePath(back) || to.startsWith('/flights/')) return to;
  const hash = to.indexOf('#');
  const [path, frag] = hash < 0 ? [to, ''] : [to.slice(0, hash), to.slice(hash)];
  return `${path}${path.includes('?') ? '&' : '?'}${BACK_PARAM}=${encodeURIComponent(back)}${frag}`;
}

/** "Back to Form 731", "Back to the flight". */
export function backLabel(path: string): string {
  const p = path.split(/[?#]/)[0].replace(/\/+$/, '');
  const exp = /^\/flights\/[^/]+\/export\/([^/]+)$/.exec(p);
  if (exp) {
    const kind = Object.hasOwn(EXPORT_REDIRECTS, exp[1]) ? EXPORT_REDIRECTS[exp[1]] : exp[1];
    return Object.hasOwn(EXPORT_LABEL, kind) ? `Back to ${EXPORT_LABEL[kind as keyof typeof EXPORT_LABEL]}` : 'Back';
  }
  if (/^\/flights\/[^/]+$/.test(p)) return 'Back to the flight';
  return 'Back';
}

/** Adds ?back=<this page> to a link out of it. */
export function useWithBack(): (to: string) => string {
  const { pathname, search, hash } = useLocation();
  const back = backTarget(pathname, search, hash);
  return useCallback((to: string) => withBack(to, back), [back]);
}

/** This page's ?back= (null when none or not in-app) and going there (in place of this page). */
export function useBack(): { back: string | null; goBack: () => void } {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const back = safePath(params.get(BACK_PARAM));
  const goBack = useCallback(() => {
    if (back) void navigate(back, { replace: true });
  }, [back, navigate]);
  return { back, goBack };
}
