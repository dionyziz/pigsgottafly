// Postgres errors by SQLSTATE (the same on Neon and PGlite), never by their message text.
// https://www.postgresql.org/docs/current/errcodes-appendix.html

export const SQLSTATE = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
  NOT_NULL_VIOLATION: '23502',
} as const;

/** The SQLSTATE of a database error, or null for anything else. */
export function sqlState(e: unknown): string | null {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : null;
}

/** The name of the constraint a database error is about ('' when it names none). */
export function constraintOf(e: unknown): string {
  const c = (e as { constraint?: unknown } | null)?.constraint;
  return typeof c === 'string' ? c : '';
}

/** A unique constraint was violated (optionally: that constraint). */
export function isUniqueViolation(e: unknown, constraint?: string): boolean {
  return sqlState(e) === SQLSTATE.UNIQUE_VIOLATION && (constraint === undefined || constraintOf(e) === constraint);
}

/** A row refers to something that is not there, or breaks a CHECK or UNIQUE rule: the client's fault (400). */
export function isConstraintViolation(e: unknown): boolean {
  const s = sqlState(e);
  return s === SQLSTATE.FOREIGN_KEY_VIOLATION || s === SQLSTATE.CHECK_VIOLATION || s === SQLSTATE.UNIQUE_VIOLATION;
}
