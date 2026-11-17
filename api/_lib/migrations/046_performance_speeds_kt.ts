// Performance speeds in knots: the take-off table's lift-off IAS per mass (takeoff.rows[].liftoffIas)
// and the landing table's approach IAS (landing.approachIas) were free text such as
// '60 kt / 111 km/h / 69 MPH'. They become numbers of knots (liftoffIasKt, approachIasKt): the kt
// figure of the text, else its km/h or MPH figure converted and rounded, else a bare number;
// anything else becomes null.
import type { Queryable } from '../db.js';

const KMH_PER_KT = 1.852;
const MPH_PER_KT = 1.150779;

/** Knots from an AFM IAS text ('59 kt / 109 km/h / 68 MPH' → 59, '92 km/h' → 50), or null. */
export function iasKt(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 && v <= 500 ? Math.round(v) : null;
  if (typeof v !== 'string') return null;
  const s = v.replace(/,/g, '.');
  const unit = (re: RegExp) => {
    const m = re.exec(s);
    return m ? parseFloat(m[1]) : null;
  };
  const kt = unit(/(\d+(?:\.\d+)?)\s*(?:kts?|knots?)\b/i);
  const kmh = unit(/(\d+(?:\.\d+)?)\s*km\s*\/?\s*h\b/i);
  const mph = unit(/(\d+(?:\.\d+)?)\s*mph\b/i);
  const bare = /^\s*(\d+(?:\.\d+)?)\s*$/.exec(s);
  const k =
    kt ?? (kmh != null ? kmh / KMH_PER_KT : mph != null ? mph / MPH_PER_KT : bare ? parseFloat(bare[1]) : null);
  return k != null && k > 0 && k <= 500 ? Math.round(k) : null;
}

/** The performance document with its speeds in knots (unchanged when it has no text speeds). */
export function performanceKt(p: Record<string, unknown>): Record<string, unknown> {
  const out = { ...p };
  const takeoff = p.takeoff as Record<string, unknown> | undefined;
  if (takeoff && Array.isArray(takeoff.rows))
    out.takeoff = {
      ...takeoff,
      rows: takeoff.rows.map((r: Record<string, unknown>) => {
        if (!r || typeof r !== 'object' || !('liftoffIas' in r)) return r;
        const { liftoffIas, ...rest } = r;
        return { ...rest, liftoffIasKt: iasKt(liftoffIas) };
      }),
    };
  const landing = p.landing as Record<string, unknown> | undefined;
  if (landing && typeof landing === 'object' && 'approachIas' in landing) {
    const { approachIas, ...rest } = landing;
    out.landing = { ...rest, approachIasKt: iasKt(approachIas) };
  }
  return out;
}

export async function run(q: Queryable): Promise<void> {
  const rows = await q.query<{ id: string; performance: Record<string, unknown> }>(
    `SELECT id, performance FROM aircraft
     WHERE performance->'landing' ? 'approachIas'
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(performance#>'{takeoff,rows}') = 'array'
                     THEN performance#>'{takeoff,rows}' ELSE '[]'::jsonb END) r WHERE r ? 'liftoffIas')`,
  );
  for (const r of rows)
    await q.query(`UPDATE aircraft SET performance = $2::jsonb WHERE id = $1`, [
      r.id,
      JSON.stringify(performanceKt(r.performance)),
    ]);
}
