// In flight: where the aircraft is along the route (src/native/progress.ts).
import type { Flight } from '../../shared';
import { progress as progressOf } from '../progress';
import type { computeFlight } from './flight';
import { arg, type Json, plain } from './shared';

/**
 * Where the aircraft is along the route (src/native/progress.ts). `computed` is computeFlight's
 * answer for the flight; `position` a GPS fix { lat, lon, altFt?, trackDeg?, gsKt?, time }.
 */
export function progress(
  input: Json<{
    flight?: Pick<Flight, 'route'> | null;
    computed: ReturnType<typeof computeFlight>;
    position: Parameters<typeof progressOf>[0]['position'];
    lastLegIndex?: number | null;
  }>,
) {
  const i = arg(input);
  const c = i.computed;
  const navLegs = (c?.navlog?.legs ?? []) as {
    altFt: number | null;
    gs?: number | null;
    mh?: number | null;
    ch?: number | null;
  }[];
  return plain(
    progressOf({
      legs: (c?.legs ?? []).map((l) => ({ from: l.from, to: l.to, distNm: l.distNm, variation: l.variation })),
      navlog: (c?.legs ?? []).map((l, k) => navLegs[k] ?? { altFt: l.altFt ?? null }),
      atc: c?.atc ?? null,
      position: i.position,
      lastLegIndex: i.lastLegIndex ?? null,
      local: c?.local
        ? { aerodrome: { name: c.local.aerodrome, lat: c.local.lat, lon: c.local.lon }, landingMs: c.times.landingMs }
        : null,
    }),
  );
}
