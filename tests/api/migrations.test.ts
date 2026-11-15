// Migration 001–004 converts the v2 production schema without losing accounts, sessions or flights.
import crypto from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { connect } from '../../api/_lib/db';
import { migrate, MIGRATIONS } from '../../api/_lib/migrate';
import { createApi } from '../../api/_lib/app';
import { CID, JWK } from './helpers';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

// The v2 schema exactly as api/_lib/db.mjs created it.
const V2 = `
CREATE TABLE users (id TEXT PRIMARY KEY, google_sub TEXT UNIQUE, email TEXT NOT NULL, name TEXT NOT NULL DEFAULT '',
  picture TEXT NOT NULL DEFAULT '', created BIGINT NOT NULL, last_login BIGINT NOT NULL);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created BIGINT NOT NULL);
CREATE INDEX sessions_user ON sessions (user_id);
CREATE TABLE flights (id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, data JSONB NOT NULL,
  summary JSONB NOT NULL DEFAULT '{}', version INTEGER NOT NULL DEFAULT 1, created BIGINT NOT NULL, updated BIGINT NOT NULL,
  opened BIGINT NOT NULL DEFAULT 0, deleted BOOLEAN NOT NULL DEFAULT FALSE);
CREATE INDEX flights_owner ON flights (owner, deleted);`;

const legacyData = {
  windyUrl: '', date: '2026-11-20', blockStart: '0930', aircraft: 'SX-ASG', aircraftOther: '', card: 'Magnetic compass',
  taxiMin: 10, model: 'gfs_seamless', variation: 5, fieldRadius: 2, fuelFlow: 30, fuelExtra: 4, title: '',
  waypoints: [
    { lat: 38.10861, lon: 23.78333, name: 'LGTT' },
    { lat: 38.16944, lon: 23.73556, name: 'ABLONAS' },
    { lat: 38.3, lon: 23.5, name: 'WP2' },
    { lat: 38.10861, lon: 23.78333, name: 'LGTT' },
  ],
  ov: { 'L1.alt': '3500', 'L2.tas': '95' }, termManual: [], termHidden: [],
};

describe('migrations', () => {
  test('convert the v2 production schema', async () => {
    const db = await connect('memory://');
    await db.exec(V2);
    const token = 'tok-' + crypto.randomBytes(8).toString('hex');
    const hash = crypto.createHash('sha256').update(token).digest('base64url');
    await db.query(`INSERT INTO users VALUES ('u1', 'g-sub-1', 'pilot@example.com', 'Real Pilot', '', 1, 2)`);
    await db.query(`INSERT INTO sessions VALUES ($1, 'u1', $2)`, [hash, Date.now()]);
    await db.query(`INSERT INTO flights (id, owner, data, summary, version, created, updated, opened) VALUES ('f1', 'u1', $1::jsonb, $2::jsonb, 7, 10, 20, 30)`,
      [JSON.stringify(legacyData), JSON.stringify({ title: 'LGTT → ABLONAS → WP2 → LGTT', dist: 40, ete: 28, fuel: 20 })]);

    // two runners at once: the advisory lock serialises them, each migration applies once
    const [x, y] = await Promise.all([migrate(db), migrate(db)]);
    expect([...x, ...y].sort()).toEqual(MIGRATIONS.map((m) => m.name).sort());
    expect(await migrate(db)).toEqual([]);

    const [p] = await db.query(`SELECT * FROM pilots WHERE id = 'u1'`);
    expect(p).toMatchObject({ email: 'pilot@example.com', full_name: 'Real Pilot', home_aerodrome: 'LGTT', google_sub: 'g-sub-1' });
    expect(p.settings).toMatchObject({ taxiOutMin: 15, taxiInMin: 15, reserveMin: 60 });
    const ac = await db.query(`SELECT id, registration, mass_balance FROM aircraft WHERE pilot_id = 'u1' ORDER BY registration`);
    expect(ac.map((r) => r.registration)).toEqual(['SX-ASG', 'SX-ASV']);
    expect(p.default_aircraft_id).toBe(ac[1].id);
    expect(ac[1].mass_balance.emptyMassKg).toBe(691.2);

    // the old session still works, and the flight is converted
    const api = createApi({ db, googleClientId: CID, googleKeys: async () => [JWK] });
    const server = http.createServer((req, res) => api(req, res));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/`;
      const get = async (path: string) => (await fetch(base + path, { headers: { cookie: `pgf_session=${token}` } })).json();
      const list = await get('flights');
      expect(list.map((f: any) => f.id)).toEqual(['f1']);
      const f = await get('flights/f1');
      expect(f).toMatchObject({ date: '2026-11-20', blockOff: '09:30', taxiOutMin: 10, taxiInMin: 15, aircraftId: ac[0].id, version: 7, created: 10, opened: 30 });
      expect(f.options.windModel).toBe('gfs_seamless');
      expect(f.route.map((r: any) => [r.kind, r.refId, r.name])).toEqual([
        ['aerodrome', 'LGTT', 'LGTT'], ['vfr', 'LGAV/ABLONAS', 'ABLONAS'], ['custom', null, 'WP2'], ['aerodrome', 'LGTT', 'LGTT']]);
      expect(f.legOverrides).toEqual({ 'm1>m2': { altFt: 3500 }, 'm2>m3': { tasKt: 95 } });
      expect(f.crew).toEqual([{ role: 'PIC', passengerId: null, seat: 'front-left', snapshot: expect.objectContaining({ fullName: 'Real Pilot' }) }]);
      expect(f.summary).toMatchObject({ title: 'LGTT → ABLONAS → WP2 → LGTT', distNm: 40, aircraft: 'SX-ASG' });
    } finally {
      server.close();
      await db.close();
    }
  });

  test('a fresh database migrates cleanly and pilots signing up later get no seed', async () => {
    const db = await connect('memory://');
    await migrate(db);
    await db.query(`INSERT INTO pilots (id, email, created, last_login, seeded_at) VALUES ('n', '', 1, 1, 1)`);
    expect(await db.query(`SELECT * FROM aircraft`)).toEqual([]);
    const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM ref_aerodromes`);
    expect(n).toBeGreaterThan(50);
    await db.close();
  });
});
