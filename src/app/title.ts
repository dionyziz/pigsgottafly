// The browser tab's title follows the page: "<page> · Pig's Gotta Fly". Every route has a name
// (routeTitle, set by <RouteTitle/> in App); a page about one thing (a flight, a form of it, an
// aircraft, an operator) names it with usePageTitle, which runs after RouteTitle and wins.
import { useEffect } from 'react';
import { useLocation } from 'react-router';

export const APP_NAME = "Pig's Gotta Fly";

const ROUTES: [RegExp, string][] = [
  [/^\/$/, 'Flights'],
  [/^\/flights\/new\/?$/, 'New flight'],
  [/^\/flights\/[^/]+\/export(\/|$)/, 'File & forms'],
  [/^\/flights\/[^/]+\/?$/, 'Flight'],
  [/^\/profile(\/|$)/, 'Profile'],
  [/^\/hangar\/?$/, 'Hangar'],
  [/^\/hangar\/./, 'Aircraft'],
  [/^\/operators\/?$/, 'Operators'],
  [/^\/operators\/./, 'Operator'],
  [/^\/passengers(\/|$)/, 'Passengers'],
  [/^\/waypoints(\/|$)/, 'Waypoints'],
  [/^\/admin\/errors(\/|$)/, 'Errors'],
  [/^\/admin\/mail(\/|$)/, 'Mail'],
  [/^\/admin(\/|$)/, 'Admin'],
  [/^\/about\/licenses\/?$/, 'Open-source licenses'],
  [/^\/about(\/|$)/, 'About'],
  [/^\/privacy(\/|$)/, 'Privacy Policy'],
  [/^\/terms(\/|$)/, 'Terms'],
  [/^\/support(\/|$)/, 'Support'],
  [/^\/sign\//, 'Sign Form 731'],
];

/** The tab title of these parts, most specific first: ('Form 731', 'LGTT → LGSY') → "Form 731 · LGTT → LGSY · Pig's Gotta Fly". */
export function pageTitle(...parts: (string | null | undefined | false)[]): string {
  return [...parts.map((p) => (p || '').trim()).filter(Boolean), APP_NAME].join(' · ');
}

/** The name of a route (pathname), or null for one without a name of its own. */
export function routeTitle(pathname: string): string | null {
  return ROUTES.find(([re]) => re.test(pathname))?.[1] ?? null;
}

export function RouteTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = pageTitle(routeTitle(pathname));
  }, [pathname]);
  return null;
}

/** A page's own title (parts as in pageTitle); nothing while the parts are not known yet. */
export function usePageTitle(...parts: (string | null | undefined | false)[]) {
  const { pathname } = useLocation();
  const title = parts.some((p) => p && p.trim()) ? pageTitle(...parts) : null;
  useEffect(() => {
    if (title) document.title = title;
  }, [title, pathname]);
}

/** A flight's name for titles: its title, else its route ("LGTT → LGSY", "Local flight · LGTT") and date. */
export function flightTitle(f: {
  title?: string | null;
  date?: string | null;
  route?: { kind?: string; name?: string }[];
}): string {
  if (f.title && f.title.trim()) return f.title.trim();
  const ads = (f.route || []).filter((p) => p.kind === 'aerodrome');
  const from = ads[0]?.name;
  const to = ads.length > 1 ? ads[ads.length - 1]?.name : undefined;
  // a round trip with points between is a navigation flight, not a local one (src/shared/local.ts)
  const local = from && from === to && (f.route || []).length === 2;
  const route = from && to ? (local ? `Local flight · ${from}` : `${from} → ${to}`) : from || '';
  return [route, f.date || ''].filter(Boolean).join(' · ') || 'Untitled flight';
}
