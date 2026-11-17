// Speeds and flap settings for the MD 4.4 performance log, from the aircraft's AFM data.
//
// From the hangar record (any type): Vr = the AFM take-off table's lift-off IAS interpolated at the
// take-off mass; Vapp = the landing table's approach IAS; flaps from the tables; stall speeds.
// Vx, Vy and the glide speed are not in the hangar record (Aircraft has no speeds field yet), so
// they come from TYPE_SPEEDS for the types we have read the AFM of; otherwise they print blank.
import type { Aircraft } from '../../../shared';

export interface TypeSpeeds {
  /** Best angle of climb, flaps up, IAS kt. */
  vxKt: number;
  /** Best rate of climb at sea level and at 10 000 ft, IAS kt (linear in between). */
  vySlKt: number;
  vy10kKt: number;
  /** Glide, flaps up, IAS kt. */
  glideKt: number;
  source: string;
}

/**
 * Reims/Cessna F172M Flight Manual (Ed. 1 Sept 1972, Rev 6 Aug 1975), sections 2-4:
 *   - "If an obstruction dictates the use of a steep climb angle, climb at an obstacle clearance
 *     indicated airspeed of 121 km/h - 65 kts - 75 MPH with flaps retracted."
 *   - "The best rate-of-climb indicated airspeed range from 145 km/h - 78 kts - 90 MPH at sea level
 *     to 126 km/h - 68 kts - 78 MPH at 3048 m - 10,000 ft."
 *   - Engine failure during flight: "Glide Speed (IAS) - 129 km/h - 70 kts - 80 MPH."
 */
export const F172M_SPEEDS: TypeSpeeds = {
  vxKt: 65,
  vySlKt: 78,
  vy10kKt: 68,
  glideKt: 70,
  source: 'Reims/Cessna F172M AFM sections 2-4',
};

/** Type speeds for an aircraft, or null when we have not read its AFM. */
export function typeSpeeds(a: Pick<Aircraft, 'makeModel' | 'icaoType'>): TypeSpeeds | null {
  if (/\bF?172\s*M\b/i.test(a.makeModel || '')) return F172M_SPEEDS;
  return null;
}

export interface PerfSpeeds {
  vrKt: number | null;
  vrNote: string;
  vxKt: number | null;
  vyKt: number | null;
  vyNote: string;
  glideKt: number | null;
  vappKt: number | null;
  vappNote: string;
  flapsTakeoff: string;
  flapsLanding: string;
  /** Power-off stall IAS, wings level, flaps up / landing flaps; null when unknown. */
  vsKt: number | null;
  vsoKt: number | null;
  source: string;
}

/**
 * @param takeoffMassKg mass for the lift-off speed (null: the heaviest table row)
 * @param pressureAltFt for Vy (null: sea level)
 */
export function perfSpeeds(a: Aircraft | null, takeoffMassKg: number | null, pressureAltFt: number | null): PerfSpeeds {
  const out: PerfSpeeds = {
    vrKt: null,
    vrNote: '',
    vxKt: null,
    vyKt: null,
    vyNote: '',
    glideKt: null,
    vappKt: null,
    vappNote: '',
    flapsTakeoff: '',
    flapsLanding: '',
    vsKt: null,
    vsoKt: null,
    source: '',
  };
  if (!a) return out;
  const p = a.performance;
  const rows = [...(p?.takeoff?.rows || [])]
    .map((r) => ({ m: r.massKg, kt: r.liftoffIasKt }))
    .filter((r): r is { m: number; kt: number } => r.kt != null && r.m > 0)
    .sort((x, y) => x.m - y.m);
  if (rows.length) {
    const m = takeoffMassKg != null && isFinite(takeoffMassKg) ? takeoffMassKg : rows[rows.length - 1].m;
    let kt: number;
    if (m <= rows[0].m) kt = rows[0].kt;
    else if (m >= rows[rows.length - 1].m) kt = rows[rows.length - 1].kt;
    else {
      let i = 0;
      while (m > rows[i + 1].m) i++;
      const t = (m - rows[i].m) / (rows[i + 1].m - rows[i].m);
      kt = rows[i].kt + t * (rows[i + 1].kt - rows[i].kt);
    }
    out.vrKt = Math.round(kt);
    out.vrNote = `AFM lift-off IAS at ${Math.round(m)} kg`;
  }
  out.vappKt = p?.landing?.approachIasKt ?? null;
  if (out.vappKt != null)
    out.vappNote = `AFM short-field approach${p.landing.flaps ? `, flaps ${p.landing.flaps}` : ''}`;
  out.flapsTakeoff = p?.takeoff?.flaps || '';
  out.flapsLanding = p?.landing?.flaps || '';
  if (p?.stallIasKt) {
    out.vsKt = p.stallIasKt.flapsUp?.[0] ?? null;
    out.vsoKt = p.stallIasKt.flaps40?.[0] ?? null;
  }
  const ts = typeSpeeds(a);
  if (ts) {
    out.vxKt = ts.vxKt;
    out.glideKt = ts.glideKt;
    const pa = pressureAltFt != null && isFinite(pressureAltFt) ? Math.max(0, Math.min(10000, pressureAltFt)) : 0;
    out.vyKt = Math.round(ts.vySlKt + ((ts.vy10kKt - ts.vySlKt) * pa) / 10000);
    out.vyNote = `${ts.vySlKt} kt at sea level to ${ts.vy10kKt} kt at 10 000 ft`;
    out.source = ts.source;
  }
  return out;
}
