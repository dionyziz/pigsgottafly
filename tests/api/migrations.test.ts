// Migration 001–004 converts the v2 production schema without losing accounts, sessions or flights.
import crypto from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { connect } from '../../api/_lib/db';
import { migrate, MIGRATIONS, type Migration } from '../../api/_lib/migrate';
import { seedSql } from '../../tools/build_seed';
import { legacyAtc, legacyLegOverrides } from '../../api/_lib/migrations/004_legacy_flights';
import type { AtcEntry } from '../../src/shared/types';
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

// The shipped 003 targets the owner's real address by its SHA-256 (not published here); the tests
// run the same generated SQL aimed at a test address instead.
const OWNER = 'Pilot@Example.com ';
const sha = (s: string) => crypto.createHash('sha256').update(s.trim().toLowerCase()).digest('hex');
const withOwner = (email: string): Migration[] =>
  MIGRATIONS.map((m) => (m.name === '003_existing_pilot_data' ? { ...m, sql: seedSql(sha(email)) } : m));

describe('migrations', () => {
  test('convert the v2 production schema', async () => {
    const db = await connect('memory://');
    await db.exec(V2);
    const token = 'tok-' + crypto.randomBytes(8).toString('hex');
    const hash = crypto.createHash('sha256').update(token).digest('base64url');
    await db.query(`INSERT INTO users VALUES ('u1', 'g-sub-1', $1, 'Real Pilot', '', 1, 2)`, [OWNER]);
    await db.query(`INSERT INTO users VALUES ('u2', 'g-sub-2', 'friend@example.com', 'A Friend', '', 3, 4)`);
    await db.query(`INSERT INTO sessions VALUES ($1, 'u1', $2)`, [hash, Date.now()]);
    await db.query(`INSERT INTO flights (id, owner, data, summary, version, created, updated, opened) VALUES ('f1', 'u1', $1::jsonb, $2::jsonb, 7, 10, 20, 30)`,
      [JSON.stringify(legacyData), JSON.stringify({ title: 'LGTT → ABLONAS → WP2 → LGTT', dist: 40, ete: 28, fuel: 20 })]);

    // two runners at once: the advisory lock serialises them, each migration applies once
    const list = withOwner(OWNER);
    const [x, y] = await Promise.all([migrate(db, list), migrate(db, list)]);
    expect([...x, ...y].sort()).toEqual(MIGRATIONS.map((m) => m.name).sort());
    expect(await migrate(db)).toEqual([]);

    // any other pre-existing account is marked seeded and gets nothing (pilot correction 1)
    const [friend] = await db.query(`SELECT * FROM pilots WHERE id = 'u2'`);
    expect(friend.home_aerodrome).toBeNull();
    expect(friend.default_aircraft_id).toBeNull();
    expect(friend.seeded_at).not.toBeNull();
    expect(friend.settings?.taxiOutMin ?? null).toBeNull();
    expect(friend.settings?.reserveMin ?? null).toBeNull();
    expect(await db.query(`SELECT id FROM aircraft WHERE pilot_id = 'u2'`)).toEqual([]);

    const [p] = await db.query(`SELECT * FROM pilots WHERE id = 'u1'`);
    expect(p).toMatchObject({ email: OWNER, full_name: 'Real Pilot', home_aerodrome: 'LGTT', google_sub: 'g-sub-1' });
    expect(p.settings).toMatchObject({ taxiOutMin: 15, taxiInMin: 15, reserveMin: 60 });
    const ac = await db.query(`SELECT id, registration, mass_balance FROM aircraft WHERE pilot_id = 'u1' ORDER BY registration`);
    expect(ac.map((r) => r.registration)).toEqual(['SX-ASG', 'SX-ASV']);
    expect(p.default_aircraft_id).toBe(ac[1].id);
    expect(ac[1].mass_balance.emptyMassKg).toBe(691.2);
    // SX-ASG: colours from the club's photo, life vests from its weighing report (FPL item 19 A/, J/)
    const [asg] = await db.query(`SELECT colours, equipment FROM aircraft WHERE pilot_id = 'u1' AND registration = 'SX-ASG'`);
    expect(asg.colours).toBe('WHITE RED BLACK STRIPES');
    expect(asg.equipment.jackets).toEqual({ present: true, light: false, fluorescein: false, uhf: false, vhf: false });

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

  test('the shipped 003 seeds no account but the owner', async () => {
    const db = await connect('memory://');
    await db.exec(V2);
    await db.query(`INSERT INTO users VALUES ('u1', 'g-sub-1', 'pilot@example.com', 'Real Pilot', '', 1, 2)`);
    await migrate(db);
    const [p] = await db.query(`SELECT * FROM pilots WHERE id = 'u1'`);
    expect(p.home_aerodrome).toBeNull();
    expect(p.seeded_at).not.toBeNull();
    expect(await db.query(`SELECT id FROM aircraft`)).toEqual([]);
    await db.close();
  });

  test('v2 ATC / terminal-information edits survive the conversion', async () => {
    const db = await connect('memory://');
    await db.exec(V2);
    await db.query(`INSERT INTO users VALUES ('u1', 'g-sub-1', $1, 'Real Pilot', '', 1, 2)`, [OWNER]);
    const data = {
      ...legacyData,
      waypoints: [{ lat: 38.10861, lon: 23.78333, name: 'LGTT' }, { lat: 37.9364, lon: 23.9445, name: 'LGAV' }],
      ov: { 'T.ad-LGAV-arr.freq': 'TWR 118.1 / 118.675', 'T.fis.field': 'FIS (Athinai)', 'T.ad-LGTT.rwy': '03 / 21 grass?', 'L0.ete': '0:20', 'L0.alt': '2500',
        'T.m1.field': 'ACC Athinai', 'T.m1.freq': '136.025', 'T.m2.field': '' },
      termManual: ['m1', 'm2'], termHidden: [],
    };
    await db.query(`INSERT INTO flights (id, owner, data, summary, version, created, updated, opened) VALUES ('f2', 'u1', $1::jsonb, '{}'::jsonb, 1, 10, 20, 30)`, [JSON.stringify(data)]);
    await db.query(`INSERT INTO flights (id, owner, data, summary, version, created, updated, opened) VALUES ('f3', 'u1', $1::jsonb, '{}'::jsonb, 1, 10, 20, 30)`, [JSON.stringify(legacyData)]);
    await migrate(db, withOwner(OWNER));
    const [f2] = await db.query(`SELECT atc, leg_overrides FROM flights WHERE id = 'f2'`);
    const [f3] = await db.query(`SELECT atc FROM flights WHERE id = 'f3'`);
    expect(f3.atc).toBeNull(); // untouched v2 list: generated by the editor
    const atc = f2.atc as AtcEntry[];
    const lgav = atc.filter((e) => e.sourceKey?.startsWith('ad:LGAV'));
    expect(lgav).toHaveLength(1);
    expect(lgav[0]).toMatchObject({ role: 'destination', primary: '118.1', backups: ['118.675'] });
    expect(lgav[0].remark).toMatch(/TWR 118\.1 \/ 118\.675/);
    expect(atc.filter((e) => e.role === 'fis').every((e) => e.group === 'FIS (Athinai)')).toBe(true);
    expect(atc.find((e) => e.sourceKey?.startsWith('ad:LGTT'))!.remark).toMatch(/RWY 03 \/ 21 grass\?/);
    expect(atc.filter((e) => e.sourceKey === null)).toEqual([
      { id: 'v2-m1', role: 'custom', group: 'ACC Athinai', callsign: 'ACC Athinai', service: '', primary: '136.025', backups: [], remark: '', sourceKey: null },
    ]);
    expect(f2.leg_overrides).toEqual({ 'm0>m1': { altFt: 2500 } });
    await db.close();
  });

  test('a malformed v2 flight converts within the PUT checks, so the editor can save it back', async () => {
    const db = await connect('memory://');
    await db.exec(V2);
    const token = 'tok-' + crypto.randomBytes(8).toString('hex');
    const hash = crypto.createHash('sha256').update(token).digest('base64url');
    await db.query(`INSERT INTO users VALUES ('u1', 'g-sub-1', $1, 'Real Pilot', '', 1, 2)`, [OWNER]);
    await db.query(`INSERT INTO sessions VALUES ($1, 'u1', $2)`, [hash, Date.now()]);
    const data = {
      ...legacyData,
      title: 'T'.repeat(500), blockStart: '2561', taxiMin: 9999, card: 'C'.repeat(300),
      waypoints: [
        { lat: 38.10861, lon: 23.78333, name: 'LGTT' }, null, { lat: '38.3', lon: '23.5', name: 'N'.repeat(500) },
        { lat: 'x', lon: 23 }, { lat: 200, lon: 23 }, { lat: null, lon: 23 }, { lat: 38.10861, lon: 23.78333, name: 'LGTT' },
      ],
      // L0: altitude and wind direction out of range (dropped), wind speed kept; L1: all valid
      ov: { 'L0.alt': '999999', 'L0.wd': '400', 'L0.ws': '15', 'L1.alt': '-2000', 'L1.temp': '12,5', 'L1.tas': '0',
        'T.m9.field': 'F'.repeat(400), 'T.m9.freq': '122.5 ' + 'X'.repeat(600) },
      termManual: ['m9'],
    };
    await db.query(`INSERT INTO flights (id, owner, data, summary, version, created, updated, opened) VALUES ('f9', 'u1', $1::jsonb, $2::jsonb, 3, 10, 20, 30)`,
      [JSON.stringify(data), JSON.stringify({ title: 'S'.repeat(400), dist: 'abc', ete: -5, fuel: 1e9 })]);
    await migrate(db, withOwner(OWNER));

    const api = createApi({ db, googleClientId: CID, googleKeys: async () => [JWK] });
    const server = http.createServer((req, res) => api(req, res));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/`;
      const headers = { cookie: `pgf_session=${token}`, 'content-type': 'application/json' };
      const f = await (await fetch(base + 'flights/f9', { headers })).json();
      expect(f.route.map((p: any) => p.uid)).toEqual(['m0', 'm1', 'm2']);
      expect(f.route[1]).toMatchObject({ kind: 'custom', lat: 38.3, lon: 23.5 });
      expect(f.route[1].name).toHaveLength(60);
      expect(f.legOverrides).toEqual({ 'm0>m1': { windKt: 15 }, 'm1>m2': { tempC: 12.5 } });
      expect(f).toMatchObject({ blockOff: '', taxiOutMin: 15 });
      expect(f.title).toHaveLength(200);
      expect(f.options.compassCard).toHaveLength(100);
      expect(f.summary).toMatchObject({ distNm: null, eteMin: null, fuelL: null });
      const custom = f.atc.find((e: AtcEntry) => e.id === 'v2-m9');
      expect(custom).toMatchObject({ primary: '122.5' });
      expect(custom.group).toHaveLength(200);
      expect(custom.remark).toHaveLength(500);

      // what the editor does on every change: the whole document back
      const { id: _i, version, created: _c, updated: _u, opened: _o, deleted: _d, ...flight } = f;
      const put = await fetch(base + 'flights/f9', { method: 'PUT', headers, body: JSON.stringify({ flight, version }) });
      expect(put.status).toBe(200);
    } finally {
      server.close();
      await db.close();
    }
  });

  test('legacyLegOverrides keeps only values PUT /flights accepts', () => {
    const route = [{ uid: 'a' }, { uid: 'b' }];
    expect(legacyLegOverrides({ 'L0.alt': '60000', 'L0.wd': '360', 'L0.ws': '251', 'L0.tas': 'fast', 'L0.temp': '−5' }, route))
      .toEqual({ 'a>b': { altFt: 60000, windDirDeg: 360, tempC: -5 } });
    expect(legacyLegOverrides({ 'L0.alt': '60001', 'L0.wd': '-1' }, route)).toEqual({});
  });

  test('legacyAtc: hidden rows, edited rows v3 does not generate, nothing edited', () => {
    const gen: AtcEntry[] = [
      { id: 'ad:LGTT:A', role: 'departure', group: 'LGTT', callsign: 'TATOI TOWER', service: 'TWR', primary: '122.650', backups: [], remark: '', sourceKey: 'ad:LGTT:TATOI TOWER' },
      { id: 'as:ATHINAI TMA:X', role: 'airspace', group: 'ATHINAI TMA', callsign: 'ATHINAI APPROACH', service: 'APP', primary: '118.6', backups: [], remark: '', sourceKey: 'as:ATHINAI TMA:ATHINAI APPROACH' },
      { id: 'fis:A', role: 'fis', group: 'FIS', callsign: 'ATHINAI INFORMATION', service: 'INFO', primary: '124.4', backups: [], remark: '', sourceKey: 'fis:ATHINAI INFORMATION' },
    ];
    const ads = [{ id: 'LGTT', icao: 'LGTT' }];
    expect(legacyAtc({ ov: { 'L0.alt': '3000', 'T.dist': '40' }, termHidden: [], termManual: [] }, gen, ads)).toBeNull();
    const r = legacyAtc({ ov: { 'T.dep.field': 'Field X', 'T.dep.freq': '123.5 A/A' }, termHidden: ['as-ATHINAI-TMA', 'fis'], termManual: [] }, gen, ads)!;
    expect(r.map((e) => e.id)).toEqual(['ad:LGTT:A', 'v2-dep']);
    expect(r[1]).toMatchObject({ role: 'custom', callsign: 'Field X', primary: '123.5', sourceKey: null });
    expect(r[1].remark).toMatch(/123\.5 A\/A/);
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
