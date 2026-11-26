// The AIRAC in effect: the latest loaded cycle whose effective date has come (0000 UTC), else the earliest
// loaded. Cycles are loaded by migration ahead of their date and switch on by themselves; ref_airac.current is
// no longer read. The clients pick with the same rule from their own copies (src/shared/ref.ts cycleOn).
import { airacDay, type RefAirac } from '../../src/shared/ref.js';
import type { Queryable } from './db.js';

export const AIRAC_CYCLE_DAYS = 28;

export async function airacInEffect(db: Queryable, now: number = Date.now()): Promise<RefAirac | null> {
  const [r] = await db.query<RefAirac>(
    `SELECT id, name, effective FROM ref_airac ORDER BY (effective <= $1) DESC,
       CASE WHEN effective <= $1 THEN effective END DESC, effective ASC LIMIT 1`,
    [airacDay(now)],
  );
  return r ?? null;
}

/** The cycle after the one in effect, when it is loaded already. */
export async function nextAirac(db: Queryable, now: number = Date.now()): Promise<RefAirac | null> {
  const [r] = await db.query<RefAirac>(
    `SELECT id, name, effective FROM ref_airac WHERE effective > $1 ORDER BY effective ASC LIMIT 1`,
    [airacDay(now)],
  );
  return r ?? null;
}
