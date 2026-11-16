// Database errors are classified by SQLSTATE (api/_lib/pgErrors.ts), not by their message text.
import { describe, expect, test } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { constraintOf, isConstraintViolation, isUniqueViolation, sqlState, SQLSTATE } from '../../api/_lib/pgErrors';

async function errorOf(db: PGlite, q: string): Promise<unknown> {
  try { await db.query(q); } catch (e) { return e; }
  throw new Error('no error: ' + q);
}

describe('pgErrors', () => {
  test('unique, check and foreign-key violations; anything else is not one', async () => {
    const db = new PGlite();
    await db.exec('CREATE TABLE a (id int PRIMARY KEY, v int CHECK (v > 0)); CREATE TABLE b (id int REFERENCES a(id));');
    const dup = await errorOf(db, 'INSERT INTO a VALUES (1, 1), (1, 2)');
    expect(sqlState(dup)).toBe(SQLSTATE.UNIQUE_VIOLATION);
    expect(isUniqueViolation(dup)).toBe(true);
    expect(isUniqueViolation(dup, 'a_pkey')).toBe(true);
    expect(isUniqueViolation(dup, 'other')).toBe(false);
    expect(constraintOf(dup)).toBe('a_pkey');
    expect(sqlState(await errorOf(db, 'INSERT INTO a VALUES (2, -1)'))).toBe(SQLSTATE.CHECK_VIOLATION);
    const fk = await errorOf(db, 'INSERT INTO b VALUES (9)');
    expect(sqlState(fk)).toBe(SQLSTATE.FOREIGN_KEY_VIOLATION);
    expect(isConstraintViolation(fk)).toBe(true);
    const syntax = await errorOf(db, 'SELEC 1');
    expect(isConstraintViolation(syntax)).toBe(false);
    // a message that only looks like a constraint violation is not one
    expect(isConstraintViolation(new Error('duplicate key value violates unique constraint "x"'))).toBe(false);
    expect(sqlState(null)).toBeNull();
    await db.close();
  });
});
