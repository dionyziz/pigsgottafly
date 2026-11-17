// Migration 001–004 converts the v2 production schema without losing accounts, sessions or flights.
import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { describe, expect, test } from 'vitest';

import { createApi } from '../../api/_lib/app';
import { connect } from '../../api/_lib/db';
import { migrate, type Migration, MIGRATIONS } from '../../api/_lib/migrate';
import { legacyAtc, legacyLegOverrides } from '../../api/_lib/migrations/004_legacy_flights';
import {
  colours as FLEET_COLOURS_011,
  equipment as FLEET_EQUIPMENT_011,
} from '../../api/_lib/migrations/011_fleet_fpl_equipment';
import { iasKt, performanceKt } from '../../api/_lib/migrations/046_performance_speeds_kt';
import AERODROMES_JSON from '../../src/data/ref/aerodromes.json';
import type { AtcEntry } from '../../src/shared/types';
import { EXISTING_PILOT_PROFILE, fleetSeed } from '../../tools/build_seed';
import { CID, JWK } from './helpers';

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
  windyUrl: '',
  date: '2026-11-20',
  blockStart: '0930',
  aircraft: 'SX-ASG',
  aircraftOther: '',
  card: 'Magnetic compass',
  taxiMin: 10,
  model: 'gfs_seamless',
  variation: 5,
  fieldRadius: 2,
  fuelFlow: 30,
  fuelExtra: 4,
  title: '',
  waypoints: [
    { lat: 38.10861, lon: 23.78333, name: 'LGTT' },
    { lat: 38.16944, lon: 23.73556, name: 'ABLONAS' },
    { lat: 38.3, lon: 23.5, name: 'WP2' },
    { lat: 38.10861, lon: 23.78333, name: 'LGTT' },
  ],
  ov: { 'L1.alt': '3500', 'L2.tas': '95' },
  termManual: [],
  termHidden: [],
};

// The shipped 003, 011 and 014 target the owner's real address by its SHA-256 (not published
// here); the tests run the same SQL aimed at a test address instead.
const OWNER = 'Pilot@Example.com ';
const sha = (s: string) => crypto.createHash('sha256').update(s.trim().toLowerCase()).digest('hex');
const withOwner = (email: string, list: Migration[] = MIGRATIONS): Migration[] =>
  list.map((m) =>
    m.sql?.includes(EXISTING_PILOT_PROFILE.ownerEmailSha256)
      ? { ...m, sql: m.sql.split(EXISTING_PILOT_PROFILE.ownerEmailSha256).join(sha(email)) }
      : m,
  );
const upTo = (name: string) => MIGRATIONS.slice(0, MIGRATIONS.findIndex((m) => m.name === name) + 1);
/** The owner's aircraft as the API returns them, without ids, timestamps and the operator's id (018). */
async function ownerAircraft(db: Awaited<ReturnType<typeof connect>>, pilotId: string) {
  const { toAircraft } = await import('../../api/_lib/rows');
  const rows = await db.query(`SELECT * FROM aircraft WHERE pilot_id = $1 ORDER BY registration DESC`, [pilotId]);
  return rows.map((r) => {
    const { id: _i, created: _c, updated: _u, operatorId: _o, ...rest } = toAircraft(r);
    return { ...rest, operatorId: null };
  });
}

describe('migrations', () => {
  test('convert the v2 production schema', async () => {
    const db = await connect('memory://');
    await db.exec(V2);
    const token = 'tok-' + crypto.randomBytes(8).toString('hex');
    const hash = crypto.createHash('sha256').update(token).digest('base64url');
    await db.query(`INSERT INTO users VALUES ('u1', 'g-sub-1', $1, 'Real Pilot', '', 1, 2)`, [OWNER]);
    await db.query(`INSERT INTO users VALUES ('u2', 'g-sub-2', 'friend@example.com', 'A Friend', '', 3, 4)`);
    await db.query(`INSERT INTO sessions VALUES ($1, 'u1', $2)`, [hash, Date.now()]);
    await db.query(
      `INSERT INTO flights (id, owner, data, summary, version, created, updated, opened) VALUES ('f1', 'u1', $1::jsonb, $2::jsonb, 7, 10, 20, 30)`,
      [
        JSON.stringify(legacyData),
        JSON.stringify({ title: 'LGTT → ABLONAS → WP2 → LGTT', dist: 40, ete: 28, fuel: 20 }),
      ],
    );

    // two runners at once: the advisory lock serialises them, each migration applies once
    const list = withOwner(OWNER);
    const [x, y] = await Promise.all([migrate(db, list), migrate(db, list)]);
    expect([...x, ...y].sort()).toEqual(MIGRATIONS.map((m) => m.name).sort());
    expect(await migrate(db)).toEqual([]);

    // any other pre-existing account is marked seeded and gets nothing
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
    const ac = await db.query(
      `SELECT id, registration, mass_balance FROM aircraft WHERE pilot_id = 'u1' ORDER BY registration`,
    );
    expect(ac.map((r) => r.registration)).toEqual(['SX-ASG', 'SX-ASV']);
    expect(p.default_aircraft_id).toBe(ac[1].id);
    expect(ac[1].mass_balance.emptyMassKg).toBe(691.2);
    // 003 + 011 + 014: exactly the owner's aircraft as tools/build_seed.ts describes them today
    expect(await ownerAircraft(db, 'u1')).toEqual(
      fleetSeed().map((a) => ({
        ...a,
        equipment: { ...a.equipment, ...FLEET_EQUIPMENT_011 },
        colours: FLEET_COLOURS_011[a.registration],
      })),
    );
    // SX-ASG: colours from the club's photo, life vests from its weighing report (FPL item 19 A/, J/)
    const [asg] = await db.query(
      `SELECT colours, equipment, fuel, notes FROM aircraft WHERE pilot_id = 'u1' AND registration = 'SX-ASG'`,
    );
    expect(asg.colours).toBe('WHITE WITH BLACK RED STRIPES'); // 011, from the club's EuroFPL profile
    expect(asg.equipment.jackets).toEqual({ present: true, light: true, fluorescein: true, uhf: false, vhf: false });
    // 014: AVGAS and MOGAS approved, the seeded notes cleared
    expect(asg.fuel.types).toEqual([
      { type: 'AVGAS', densityKgPerL: 0.72 },
      { type: 'MOGAS', densityKgPerL: 0.75 },
    ]);
    expect(asg.notes).toBe('');

    // the old session still works, and the flight is converted
    const api = createApi({ db, googleClientId: CID, googleKeys: async () => [JWK] });
    const server = http.createServer((req, res) => api(req, res));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/`;
      const get = async (path: string) =>
        (await fetch(base + path, { headers: { cookie: `pgf_session=${token}` } })).json();
      const list = await get('flights');
      expect(list.map((f: any) => f.id)).toEqual(['f1']);
      const f = await get('flights/f1');
      expect(f).toMatchObject({
        date: '2026-11-20',
        blockOff: '09:30',
        taxiOutMin: 10,
        taxiInMin: 15,
        aircraftId: ac[0].id,
        version: 7,
        created: 10,
        opened: 30,
      });
      expect(f.options.windModel).toBe('gfs_seamless');
      expect(f.route.map((r: any) => [r.kind, r.refId, r.name])).toEqual([
        ['aerodrome', 'LGTT', 'LGTT'],
        ['vfr', 'LGAV/ABLONAS', 'ABLONAS'],
        ['custom', null, 'WP2'],
        ['aerodrome', 'LGTT', 'LGTT'],
      ]);
      expect(f.legOverrides).toEqual({ 'm1>m2': { altFt: 3500 }, 'm2>m3': { tasKt: 95 } });
      expect(f.crew).toEqual([
        {
          role: 'PIC',
          passengerId: null,
          seat: 'front-left',
          snapshot: expect.objectContaining({ fullName: 'Real Pilot' }),
          overrides: [],
        },
      ]);
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
      waypoints: [
        { lat: 38.10861, lon: 23.78333, name: 'LGTT' },
        { lat: 37.9364, lon: 23.9445, name: 'LGAV' },
      ],
      ov: {
        'T.ad-LGAV-arr.freq': 'TWR 118.1 / 118.675',
        'T.fis.field': 'FIS (Athinai)',
        'T.ad-LGTT.rwy': '03 / 21 grass?',
        'L0.ete': '0:20',
        'L0.alt': '2500',
        'T.m1.field': 'ACC Athinai',
        'T.m1.freq': '136.025',
        'T.m2.field': '',
      },
      termManual: ['m1', 'm2'],
      termHidden: [],
    };
    await db.query(
      `INSERT INTO flights (id, owner, data, summary, version, created, updated, opened) VALUES ('f2', 'u1', $1::jsonb, '{}'::jsonb, 1, 10, 20, 30)`,
      [JSON.stringify(data)],
    );
    await db.query(
      `INSERT INTO flights (id, owner, data, summary, version, created, updated, opened) VALUES ('f3', 'u1', $1::jsonb, '{}'::jsonb, 1, 10, 20, 30)`,
      [JSON.stringify(legacyData)],
    );
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
      {
        id: 'v2-m1',
        role: 'custom',
        group: 'ACC Athinai',
        callsign: 'ACC Athinai',
        service: '',
        primary: '136.025',
        backups: [],
        remark: '',
        sourceKey: null,
      },
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
      title: 'T'.repeat(500),
      blockStart: '2561',
      taxiMin: 9999,
      card: 'C'.repeat(300),
      waypoints: [
        { lat: 38.10861, lon: 23.78333, name: 'LGTT' },
        null,
        { lat: '38.3', lon: '23.5', name: 'N'.repeat(500) },
        { lat: 'x', lon: 23 },
        { lat: 200, lon: 23 },
        { lat: null, lon: 23 },
        { lat: 38.10861, lon: 23.78333, name: 'LGTT' },
      ],
      // L0: altitude and wind direction out of range (dropped), wind speed kept; L1: all valid
      ov: {
        'L0.alt': '999999',
        'L0.wd': '400',
        'L0.ws': '15',
        'L1.alt': '-2000',
        'L1.temp': '12,5',
        'L1.tas': '0',
        'T.m9.field': 'F'.repeat(400),
        'T.m9.freq': '122.5 ' + 'X'.repeat(600),
      },
      termManual: ['m9'],
    };
    await db.query(
      `INSERT INTO flights (id, owner, data, summary, version, created, updated, opened) VALUES ('f9', 'u1', $1::jsonb, $2::jsonb, 3, 10, 20, 30)`,
      [JSON.stringify(data), JSON.stringify({ title: 'S'.repeat(400), dist: 'abc', ete: -5, fuel: 1e9 })],
    );
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
      const put = await fetch(base + 'flights/f9', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ flight, version }),
      });
      expect(put.status).toBe(200);
    } finally {
      server.close();
      await db.close();
    }
  });

  test('legacyLegOverrides keeps only values PUT /flights accepts', () => {
    const route = [{ uid: 'a' }, { uid: 'b' }];
    expect(
      legacyLegOverrides(
        { 'L0.alt': '60000', 'L0.wd': '360', 'L0.ws': '251', 'L0.tas': 'fast', 'L0.temp': '−5' },
        route,
      ),
    ).toEqual({ 'a>b': { altFt: 60000, windDirDeg: 360, tempC: -5 } });
    expect(legacyLegOverrides({ 'L0.alt': '60001', 'L0.wd': '-1' }, route)).toEqual({});
  });

  test('legacyAtc: hidden rows, edited rows v3 does not generate, nothing edited', () => {
    const gen: AtcEntry[] = [
      {
        id: 'ad:LGTT:A',
        role: 'departure',
        group: 'LGTT',
        callsign: 'TATOI TOWER',
        service: 'TWR',
        primary: '122.650',
        backups: [],
        remark: '',
        sourceKey: 'ad:LGTT:TATOI TOWER',
      },
      {
        id: 'as:ATHINAI TMA:X',
        role: 'airspace',
        group: 'ATHINAI TMA',
        callsign: 'ATHINAI APPROACH',
        service: 'APP',
        primary: '118.6',
        backups: [],
        remark: '',
        sourceKey: 'as:ATHINAI TMA:ATHINAI APPROACH',
      },
      {
        id: 'fis:A',
        role: 'fis',
        group: 'FIS',
        callsign: 'ATHINAI INFORMATION',
        service: 'INFO',
        primary: '124.4',
        backups: [],
        remark: '',
        sourceKey: 'fis:ATHINAI INFORMATION',
      },
    ];
    const ads = [{ id: 'LGTT', icao: 'LGTT' }];
    expect(
      legacyAtc({ ov: { 'L0.alt': '3000', 'T.dist': '40' }, termHidden: [], termManual: [] }, gen, ads),
    ).toBeNull();
    const r = legacyAtc(
      {
        ov: { 'T.dep.field': 'Field X', 'T.dep.freq': '123.5 A/A' },
        termHidden: ['as-ATHINAI-TMA', 'fis'],
        termManual: [],
      },
      gen,
      ads,
    )!;
    expect(r.map((e) => e.id)).toEqual(['ad:LGTT:A', 'v2-dep']);
    expect(r[1]).toMatchObject({ role: 'custom', callsign: 'Field X', primary: '123.5', sourceKey: null });
    expect(r[1].remark).toMatch(/123\.5 A\/A/);
  });

  test('013 (shared aircraft) on a database stopped at 012 keeps aircraft, flights and defaults', async () => {
    const db = await connect('memory://');
    const upTo012 = MIGRATIONS.filter((m) => m.name < '013');
    expect(upTo012.at(-1)!.name).toBe('012_ref_ad_hours_2609');
    await migrate(db, upTo012);
    await db.query(
      `INSERT INTO pilots (id, email, created, last_login, seeded_at) VALUES ('p1', 'one@example.com', 1, 1, 1), ('p2', 'two@example.com', 1, 1, 1)`,
    );
    const ac = (id: string, pilot: string, reg: string) =>
      db.query(
        `INSERT INTO aircraft (id, pilot_id, registration, cruise_tas_kt, pattern_tas_kt, fuel, mass_balance, performance, equipment, created, updated)
       VALUES ($1, $2, $3, 95, 80, '{}', '{}', '{}', '{}', 1, 1)`,
        [id, pilot, reg],
      );
    await ac('a1', 'p1', 'SX-ONE');
    await ac('a2', 'p2', 'SX-TWO');
    await db.query(`UPDATE pilots SET default_aircraft_id = 'a1' WHERE id = 'p1'`);
    await db.query(
      `INSERT INTO flights (id, pilot_id, date, aircraft_id, created, updated) VALUES ('f1', 'p1', '2026-11-20', 'a1', 1, 1)`,
    );
    // before 013 a flight cannot use another pilot's aircraft
    await expect(
      db.query(
        `INSERT INTO flights (id, pilot_id, date, aircraft_id, created, updated) VALUES ('f2', 'p1', '2026-11-20', 'a2', 1, 1)`,
      ),
    ).rejects.toThrow();

    expect(await migrate(db)).toEqual(MIGRATIONS.filter((m) => m.name >= '013').map((m) => m.name));
    expect((await db.query(`SELECT aircraft_id FROM flights WHERE id = 'f1'`))[0].aircraft_id).toBe('a1');
    expect((await db.query(`SELECT default_aircraft_id FROM pilots WHERE id = 'p1'`))[0].default_aircraft_id).toBe(
      'a1',
    );
    const fks = await db.query<{ t: string; d: string }>(
      `SELECT conrelid::regclass::text AS t, pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE contype = 'f' AND confrelid = 'aircraft'::regclass ORDER BY 1, 2`,
    );
    expect(fks.filter((f) => f.t === 'flights' || f.t === 'pilots').map((f) => f.d)).toEqual([
      'FOREIGN KEY (aircraft_id) REFERENCES aircraft(id) ON DELETE SET NULL',
      'FOREIGN KEY (default_aircraft_id) REFERENCES aircraft(id) ON DELETE SET NULL',
    ]);
    // now a flight and a default may reference a shared aircraft (the API checks access) …
    await db.query(
      `INSERT INTO aircraft_shares (aircraft_id, pilot_id, role, created, created_by) VALUES ('a2', 'p1', 'view', 2, 'p2')`,
    );
    await db.query(
      `INSERT INTO flights (id, pilot_id, date, aircraft_id, created, updated) VALUES ('f2', 'p1', '2026-11-20', 'a2', 1, 1)`,
    );
    await db.query(`UPDATE pilots SET default_aircraft_id = 'a2' WHERE id = 'p1'`);
    await expect(
      db.query(`INSERT INTO aircraft_shares (aircraft_id, pilot_id, role, created) VALUES ('a2', 'p1', 'edit', 3)`),
    ).rejects.toThrow();
    await expect(
      db.query(`INSERT INTO aircraft_shares (aircraft_id, pilot_id, role, created) VALUES ('a1', 'p2', 'admin', 3)`),
    ).rejects.toThrow();
    // … and deleting the aircraft still clears it everywhere and drops its shares
    await db.query(`DELETE FROM aircraft WHERE id = 'a2'`);
    expect((await db.query(`SELECT aircraft_id FROM flights WHERE id = 'f2'`))[0].aircraft_id).toBeNull();
    expect(
      (await db.query(`SELECT default_aircraft_id FROM pilots WHERE id = 'p1'`))[0].default_aircraft_id,
    ).toBeNull();
    expect(await db.query(`SELECT * FROM aircraft_shares`)).toEqual([]);
    await db.close();
  });

  test('014 on a database at 012 with the seeded owner: fuels, notes and sources; edits are kept; other pilots converted', async () => {
    const db = await connect('memory://');
    await db.exec(V2);
    await db.query(`INSERT INTO users VALUES ('u1', 'g-sub-1', $1, 'Real Pilot', '', 1, 2)`, [OWNER]);
    await db.query(`INSERT INTO users VALUES ('u2', 'g-sub-2', 'friend@example.com', 'A Friend', '', 3, 4)`);
    await migrate(db, withOwner(OWNER, upTo('012_ref_ad_hours_2609')));
    // as production is at 012: the old one-fuel shape, the seeded texts
    const [before] = await db.query(
      `SELECT fuel, notes, mass_balance, performance, compass_cards FROM aircraft WHERE pilot_id = 'u1' AND registration = 'SX-ASV'`,
    );
    expect(before.fuel).toMatchObject({ type: 'AVGAS', densityKgPerL: 0.72 });
    expect(before.notes).toMatch(/^Report prints 103\.97 cm/);
    expect(before.mass_balance.weighingSource).toMatch(/trn-docs\//);
    expect(before.performance.factors.source).toBe('Aeroclub Mesogeion MD 4.4 performance log');
    expect(before.compass_cards[0].source).toMatch(/\.pdf$/);
    // the pilot edited SX-ASG's notes; a friend made an aircraft from the template, MOGAS-only
    await db.query(`UPDATE aircraft SET notes = 'my own note' WHERE pilot_id = 'u1' AND registration = 'SX-ASG'`);
    const tpl = fleetSeed()[0];
    await db.query(
      `INSERT INTO aircraft (id, pilot_id, registration, make_model, icao_type, wake, serial, operator, home_base, colours, cruise_tas_kt, pattern_tas_kt,
      fuel, mass_balance, performance, equipment, compass_cards, notes, created, updated)
      VALUES ('acf', 'u2', 'SX-FRD', '', 'C172', 'L', '', '', '', '', 90, 70, $1::jsonb, $2::jsonb, $3::jsonb, $4::jsonb, '[]'::jsonb, 'Report prints 103.97 cm', 1, 1)`,
      [
        JSON.stringify({ ...before.fuel, type: 'MOGAS', densityKgPerL: 0.75 }),
        JSON.stringify(tpl.massBalance),
        JSON.stringify(before.performance),
        JSON.stringify(tpl.equipment),
      ],
    );
    const flights = await db.query(`SELECT count(*)::int AS n FROM flights`);

    // (later migrations, e.g. 017's reference data, run too)
    expect((await migrate(db, withOwner(OWNER))).filter((n) => n < '016')).toEqual([
      '013_aircraft_shares',
      '014_aircraft_fuels_provenance',
      '015_aircraft_photo_documents',
    ]);
    const asv = (await ownerAircraft(db, 'u1')).find((a) => a.registration === 'SX-ASV')!;
    const seed = fleetSeed().find((a) => a.registration === 'SX-ASV')!;
    expect(asv).toEqual({
      ...seed,
      equipment: { ...seed.equipment, ...FLEET_EQUIPMENT_011 },
      colours: FLEET_COLOURS_011['SX-ASV'],
    });
    expect(asv.notes).toBe('');
    expect(asv.massBalance.weighingSource).toBe('DAS (EL.145.0078) weight and balance report, 14-11-2024');
    expect(asv.massBalance.envelopes.utility!.notes).toBe('No rear passengers, no baggage.');
    expect(asv.performance.factors.source).toBe('');
    expect(asv.compassCards.map((c) => c.source)).toEqual(['']);
    const [asg] = await db.query(`SELECT notes FROM aircraft WHERE pilot_id = 'u1' AND registration = 'SX-ASG'`);
    expect(asg.notes).toBe('my own note');
    const [frd] = await db.query(`SELECT fuel, notes, performance FROM aircraft WHERE id = 'acf'`);
    expect(frd.fuel.types).toEqual([{ type: 'MOGAS', densityKgPerL: 0.75 }]);
    expect(frd.fuel.type).toBeUndefined();
    expect(frd.notes).toBe('Report prints 103.97 cm'); // not the owner's aircraft: notes untouched
    expect(frd.performance.factors.source).toBe(''); // the template caption goes everywhere
    expect(frd.performance.takeoff.source).toBe(
      'AFM 5-8 Table 5: take-off distance, flaps retracted, hard surface runway',
    );
    expect(await db.query(`SELECT count(*)::int AS n FROM flights`)).toEqual(flights);
    // running its SQL again changes nothing
    const snap = await db.query(`SELECT * FROM aircraft ORDER BY id`);
    await db.exec(withOwner(OWNER).find((m) => m.name === '014_aircraft_fuels_provenance')!.sql!);
    expect((await db.query(`SELECT * FROM aircraft ORDER BY id`)).map(({ updated: _u, ...r }) => r)).toEqual(
      snap.map(({ updated: _u, ...r }) => r),
    );
    await db.close();
  });

  test('018 (operators) on a database at 017 with the seeded owner: one operator per distinct operator text, linked', async () => {
    const db = await connect('memory://');
    await db.exec(V2);
    await db.query(`INSERT INTO users VALUES ('u1', 'g-sub-1', $1, 'Real Pilot', '', 1, 2)`, [OWNER]);
    await db.query(`INSERT INTO users VALUES ('u2', 'g-sub-2', 'friend@example.com', 'A Friend', '', 3, 4)`);
    await migrate(db, withOwner(OWNER, upTo('017_ref_areas_2609')));
    const ins = (id: string, pilot: string, reg: string, operator: string, remarks: string) =>
      db.query(
        `INSERT INTO aircraft (id, pilot_id, registration, operator, cruise_tas_kt, pattern_tas_kt, fuel, mass_balance, performance, equipment, created, updated)
       VALUES ($1, $2, $3, $4, 95, 80, '{}', '{}', '{}', $5::jsonb, 1, 1)`,
        [id, pilot, reg, operator, JSON.stringify({ remarks })],
      );
    await ins('f1', 'u2', 'SX-FR1', ' Friends Club ', 'OPR TEL 210 1234567');
    await ins('f2', 'u2', 'SX-FR2', 'FRIENDS CLUB', 'call the club first'); // same operator (case, spaces)
    await ins('f3', 'u2', 'SX-FR3', '', '');
    await ins('f4', 'u2', 'SX-FR4', 'Other Owner', 'OPR TEL +30 210 0000000 and ask for Bob'); // not only numbers: no phone
    expect(await migrate(db, withOwner(OWNER))).toEqual(
      MIGRATIONS.slice(MIGRATIONS.findIndex((m) => m.name === '018_operators')).map((m) => m.name),
    );

    const ops = await db.query(`SELECT pilot_id, name, phone FROM operators ORDER BY pilot_id, name`);
    expect(ops).toEqual([
      { pilot_id: 'u1', name: 'Aeroclub Mesogeion', phone: '+302108169910 +306974776230' },
      { pilot_id: 'u2', name: 'Friends Club', phone: '210 1234567' },
      { pilot_id: 'u2', name: 'Other Owner', phone: '' },
    ]);
    const link = await db.query(
      `SELECT a.registration, o.name FROM aircraft a LEFT JOIN operators o ON o.id = a.operator_id ORDER BY a.registration`,
    );
    expect(link).toEqual([
      { registration: 'SX-ASG', name: 'Aeroclub Mesogeion' },
      { registration: 'SX-ASV', name: 'Aeroclub Mesogeion' },
      { registration: 'SX-FR1', name: 'Friends Club' },
      { registration: 'SX-FR2', name: 'Friends Club' },
      { registration: 'SX-FR3', name: null },
      { registration: 'SX-FR4', name: 'Other Owner' },
    ]);
    // the owner's aircraft are otherwise unchanged
    const asv = (await ownerAircraft(db, 'u1')).find((a) => a.registration === 'SX-ASV')!;
    const seed = fleetSeed().find((a) => a.registration === 'SX-ASV')!;
    expect(asv).toEqual({
      ...seed,
      equipment: { ...seed.equipment, ...FLEET_EQUIPMENT_011 },
      colours: FLEET_COLOURS_011['SX-ASV'],
    });
    // the forms' check constraints now take the W&B and performance sheets
    await db.query(
      `INSERT INTO flights (id, pilot_id, date, created, updated) VALUES ('fl', 'u1', '2026-11-20', 1, 1)`,
    );
    await db.query(
      `INSERT INTO form_submissions (flight_id, pilot_id, form, sent_at, message_id, to_addr, text_hash) VALUES ('fl', 'u1', 'wbperf', 1, 'm', 'ops@example.com', 'h')`,
    );
    await expect(
      db.query(
        `INSERT INTO form_submissions (flight_id, pilot_id, form, sent_at, message_id, to_addr, text_hash) VALUES ('fl', 'u1', 'other', 1, 'm', 'x', 'h')`,
      ),
    ).rejects.toThrow();
    await db.close();
  });

  test('030–032 (e-mail log, rate limits) on a database at 018 with the seeded owner, and on one at 030 with sends', async () => {
    const db = await connect('memory://');
    await db.exec(V2);
    await db.query(`INSERT INTO users VALUES ('u1', 'g-sub-1', $1, 'Real Pilot', '', 1, 2)`, [OWNER]);
    await migrate(db, withOwner(OWNER, upTo('018_operators')));
    const [ac] = await db.query(`SELECT id FROM aircraft WHERE pilot_id = 'u1' ORDER BY registration LIMIT 1`);
    await db.query(
      `INSERT INTO aircraft_attachments (id, pilot_id, aircraft_id, name, mime, size, data, created, kind, chunks, complete)
      VALUES ('old-upload', 'u1', $1, 'x.pdf', 'application/pdf', 10, '', 1, 'document', 1, FALSE)`,
      [ac.id],
    );
    // 030 alone first, with a send logged the old way
    await migrate(db, withOwner(OWNER, upTo('030_mail_log')));
    await db.query(`INSERT INTO mail_log (id, pilot_id, flight_id, form, at) VALUES ('ml1', 'u1', 'fx', '731', 5)`);
    expect(await migrate(db, withOwner(OWNER))).toEqual(
      MIGRATIONS.slice(MIGRATIONS.findIndex((m) => m.name === '031_mail_log_details')).map((m) => m.name),
    );
    expect(await db.query(`SELECT id, pilot_id, form, recipient, subject, result, message_id FROM mail_log`)).toEqual([
      { id: 'ml1', pilot_id: 'u1', form: '731', recipient: '', subject: '', result: 'sent', message_id: null },
    ]);
    // the app's own messages have no pilot; results are checked
    await db.query(
      `INSERT INTO mail_log (id, pilot_id, flight_id, form, at, recipient, subject, result) VALUES ('ml2', NULL, NULL, 'signup-more', 6, 'a@b', 's', 'pending')`,
    );
    await expect(
      db.query(`INSERT INTO mail_log (id, form, at, result) VALUES ('ml3', 'x', 7, 'lost')`),
    ).rejects.toThrow();
    await db.query(
      `INSERT INTO rate_limits (bucket, subject, pilot_id, tokens, updated) VALUES ('login', 'ip:1.2.3.4', NULL, 5, 1), ('metar', 'p:u1', 'u1', 3, 1)`,
    );
    await db.query(`DELETE FROM pilots WHERE id = 'u1'`);
    expect(await db.query(`SELECT bucket FROM rate_limits`)).toEqual([{ bucket: 'login' }]);
    expect(await db.query(`SELECT id FROM mail_log`)).toEqual([{ id: 'ml2' }]);
    await db.close();

    // straight from 018 to the end
    const db2 = await connect('memory://');
    await db2.exec(V2);
    await db2.query(`INSERT INTO users VALUES ('u1', 'g-sub-1', $1, 'Real Pilot', '', 1, 2)`, [OWNER]);
    await migrate(db2, withOwner(OWNER, upTo('018_operators')));
    expect(await migrate(db2, withOwner(OWNER))).toEqual([
      '030_mail_log',
      '031_mail_log_details',
      '032_rate_limits',
      '040_app_errors',
      '042_crew_overrides',
      '043_aircraft_placeholder',
      '044_weather_cache',
      '045_passenger_email',
      '046_performance_speeds_kt',
      '047_pilot_files',
    ]);
    expect((await db2.query(`SELECT count(*)::int AS n FROM aircraft WHERE pilot_id = 'u1'`))[0].n).toBeGreaterThan(0);
    // 043: every existing aircraft got a placeholder picture 1–3
    for (const r of await db2.query<{ placeholder: number }>(`SELECT placeholder FROM aircraft`))
      expect([1, 2, 3]).toContain(r.placeholder);
    await db2.close();
  });

  test('042–044 on a database at 040 (production) with the seeded owner and a converted flight', async () => {
    const db = await connect('memory://');
    await db.exec(V2);
    await db.query(`INSERT INTO users VALUES ('u1', 'g-sub-1', $1, 'Real Pilot', '', 1, 2)`, [OWNER]);
    await db.query(
      `INSERT INTO flights (id, owner, data, summary, version, created, updated, opened) VALUES ('f1', 'u1', $1::jsonb, '{}'::jsonb, 7, 10, 20, 30)`,
      [JSON.stringify(legacyData)],
    );
    await migrate(db, withOwner(OWNER, upTo('040_app_errors')));
    const crewBefore = await db.query(
      `SELECT flight_id, role, seat, snapshot FROM flight_crew ORDER BY flight_id, role`,
    );
    expect(crewBefore.length).toBeGreaterThan(0);
    const acBefore = await db.query(`SELECT id, registration, mass_balance FROM aircraft ORDER BY id`);
    expect(acBefore.length).toBeGreaterThan(0);

    expect(await migrate(db, withOwner(OWNER))).toEqual([
      '042_crew_overrides',
      '043_aircraft_placeholder',
      '044_weather_cache',
      '045_passenger_email',
      '046_performance_speeds_kt',
      '047_pilot_files',
    ]);
    expect(await migrate(db, withOwner(OWNER))).toEqual([]);
    // 042: manifest rows kept, nothing edited on the flight yet
    const crew = await db.query(
      `SELECT flight_id, role, seat, snapshot, overrides FROM flight_crew ORDER BY flight_id, role`,
    );
    expect(crew).toEqual(crewBefore.map((r) => ({ ...r, overrides: [] })));
    // 043: aircraft kept, each with a placeholder picture 1–3; new aircraft get one too, out of range refused
    const ac = await db.query<{ id: string; registration: string; mass_balance: unknown; placeholder: number }>(
      `SELECT id, registration, mass_balance, placeholder FROM aircraft ORDER BY id`,
    );
    expect(ac.map(({ placeholder: _p, ...r }) => r)).toEqual(acBefore);
    for (const r of ac) expect([1, 2, 3]).toContain(r.placeholder);
    await expect(db.query(`UPDATE aircraft SET placeholder = 4 WHERE id = $1`, [ac[0].id])).rejects.toThrow();
    // 044: empty forecast cache and budget
    expect(await db.query(`SELECT * FROM weather_cache`)).toEqual([]);
    expect(await db.query(`SELECT * FROM weather_budget`)).toEqual([]);
    await db.query(
      `INSERT INTO weather_cache (model, endpoint, run, kind, loc, day, data, fetched, expires) VALUES ('ecmwf_ifs025', 'forecast', 1, 'wind', '38.25,23.75', '2026-11-20', '{}', 1, 2)`,
    );
    await db.query(`INSERT INTO weather_budget (day) VALUES ('2026-11-20')`);
    expect(await db.query(`SELECT calls, requests FROM weather_budget`)).toEqual([{ calls: 0, requests: 0 }]);

    // the converted flight still loads through the API with its manifest
    const token = 'tok-' + crypto.randomBytes(8).toString('hex');
    await db.query(`INSERT INTO sessions (token_hash, pilot_id, created) VALUES ($1, 'u1', $2)`, [
      crypto.createHash('sha256').update(token).digest('base64url'),
      Date.now(),
    ]);
    const api = createApi({ db, googleClientId: CID, googleKeys: async () => [JWK] });
    const server = http.createServer((req, res) => api(req, res));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/`;
      const res = await fetch(base + 'flights/f1', { headers: { cookie: `pgf_session=${token}` } });
      expect(res.status).toBe(200);
      const f = await res.json();
      expect(f.crew).toEqual([expect.objectContaining({ role: 'PIC', overrides: [] })]);
      const hangar = await (await fetch(base + 'aircraft', { headers: { cookie: `pgf_session=${token}` } })).json();
      expect(hangar.map((a: any) => [a.id, a.placeholder]).sort()).toEqual(ac.map((r) => [r.id, r.placeholder]).sort());
    } finally {
      server.close();
      await db.close();
    }
  });

  test('046: AFM speed texts become knots', () => {
    expect(iasKt('60 kt / 111 km/h / 69 MPH')).toBe(60);
    expect(iasKt('59 kts')).toBe(59);
    expect(iasKt('50 knots')).toBe(50);
    expect(iasKt('92 km/h / 57 MPH')).toBe(50);
    expect(iasKt('111 km/h')).toBe(60);
    expect(iasKt('69 MPH')).toBe(60);
    expect(iasKt('62.5')).toBe(63);
    expect(iasKt(55)).toBe(55);
    for (const v of ['', 'fast', 'Vr', null, undefined, '0 kt', '9999 kt', {}]) expect(iasKt(v), String(v)).toBeNull();
    expect(
      performanceKt({
        takeoff: { flaps: '0°', rows: [{ massKg: 750, liftoffIas: '50 kt / 92 km/h / 57 MPH', headwindKt: [0] }] },
        landing: { massKg: 1043, approachIas: 'about sixty' },
        factors: { source: '' },
        stallIasKt: null,
      }),
    ).toEqual({
      takeoff: { flaps: '0°', rows: [{ massKg: 750, liftoffIasKt: 50, headwindKt: [0] }] },
      landing: { massKg: 1043, approachIasKt: null },
      factors: { source: '' },
      stallIasKt: null,
    });
  });

  test('046 on a database at 045: the speed texts of every aircraft become knots, the rest unchanged', async () => {
    const db = await connect('memory://');
    await db.exec(V2);
    await db.query(`INSERT INTO users VALUES ('u1', 'g-sub-1', $1, 'Real Pilot', '', 1, 2)`, [OWNER]);
    await migrate(db, withOwner(OWNER, upTo('045_passenger_email')));
    // a second aircraft, made before 046 with its own texts
    const [asv] = await db.query<{ id: string; performance: any }>(
      `SELECT id, performance FROM aircraft WHERE registration = 'SX-ASV'`,
    );
    expect(asv.performance.landing.approachIas).toBe('60 kt / 111 km/h / 69 MPH');
    const other = structuredClone(asv.performance);
    other.takeoff.rows[0].liftoffIas = '100 km/h';
    other.takeoff.rows[1].liftoffIas = '';
    other.landing.approachIas = '70 MPH';
    await db.query(
      `INSERT INTO aircraft (id, pilot_id, registration, make_model, icao_type, wake, serial, operator, home_base, colours,
         cruise_tas_kt, pattern_tas_kt, climb_tas_kt, fuel, mass_balance, performance, equipment, compass_cards, notes, created, updated)
       SELECT 'other', pilot_id, 'SX-XXX', make_model, icao_type, wake, serial, operator, home_base, colours,
         cruise_tas_kt, pattern_tas_kt, climb_tas_kt, fuel, mass_balance, $1::jsonb, equipment, compass_cards, notes, 1, 2
       FROM aircraft WHERE id = $2`,
      [JSON.stringify(other), asv.id],
    );
    const before = await db.query(`SELECT * FROM aircraft ORDER BY id`);

    expect(await migrate(db, withOwner(OWNER))).toEqual(['046_performance_speeds_kt', '047_pilot_files']);
    expect(await migrate(db, withOwner(OWNER))).toEqual([]);
    const after = await db.query<any>(`SELECT * FROM aircraft ORDER BY id`);
    expect(after.map(({ performance: _p, ...r }) => r)).toEqual(before.map(({ performance: _p, ...r }) => r));
    const perf = Object.fromEntries(after.map((r) => [r.registration, r.performance]));
    for (const reg of ['SX-ASV', 'SX-ASG']) {
      expect(perf[reg].takeoff.rows.map((r: any) => r.liftoffIasKt)).toEqual([50, 55, 59]);
      expect(perf[reg].landing.approachIasKt).toBe(60);
      expect(JSON.stringify(perf[reg])).not.toMatch(/liftoffIas"|approachIas"/);
    }
    expect(perf['SX-XXX'].takeoff.rows.map((r: any) => r.liftoffIasKt)).toEqual([54, null, 59]);
    expect(perf['SX-XXX'].landing.approachIasKt).toBe(61);
    // all else as it was
    const strip = (p: any) => ({
      ...p,
      takeoff: { ...p.takeoff, rows: p.takeoff.rows.map(({ liftoffIas: _a, liftoffIasKt: _b, ...r }: any) => r) },
      landing: (({ approachIas: _a, approachIasKt: _b, ...r }: any) => r)(p.landing),
    });
    expect(after.map((r) => strip(r.performance))).toEqual(before.map((r) => strip(r.performance)));
    // the converted aircraft load through the API's checks unchanged
    const { toAircraft } = await import('../../api/_lib/rows');
    const { checkPerformance } = await import('../../api/_lib/aircraftDoc');
    for (const r of after) expect(checkPerformance(toAircraft(r).performance)).toEqual(r.performance);
    await db.close();
  });

  test('a fresh database migrates cleanly and pilots signing up later get no seed', async () => {
    const db = await connect('memory://');
    await migrate(db);
    await db.query(`INSERT INTO pilots (id, email, created, last_login, seeded_at) VALUES ('n', '', 1, 1, 1)`);
    expect(await db.query(`SELECT * FROM aircraft`)).toEqual([]);
    const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM ref_aerodromes`);
    expect(n).toBeGreaterThan(50);
    // 012: every aerodrome's operational hours, exactly as shipped to the client
    const docs = new Map(
      (await db.query<{ id: string; doc: any }>(`SELECT id, doc FROM ref_aerodromes WHERE airac = '2609'`)).map((r) => [
        r.id,
        r.doc,
      ]),
    );
    for (const a of AERODROMES_JSON as any[]) expect(docs.get(a.id), a.id).toEqual(a);
    expect(docs.get('LGAV').hours.handling).toMatchObject({ text: 'H24', source: 'LGAV AD 2.3' });
    expect((await db.query(`SELECT name FROM schema_migrations ORDER BY name`)).map((r) => r.name)).toEqual(
      MIGRATIONS.map((m) => m.name).sort(),
    );
    expect(await db.query(`SELECT * FROM mail_log`)).toEqual([]);
    expect(await db.query(`SELECT * FROM rate_limits`)).toEqual([]);
    expect(await db.query(`SELECT * FROM app_errors`)).toEqual([]);
    // 042–044 on a fresh database
    expect(await db.query(`SELECT * FROM weather_cache`)).toEqual([]);
    expect(await db.query(`SELECT * FROM weather_budget`)).toEqual([]);
    expect(
      (
        await db.query(
          `SELECT column_name FROM information_schema.columns WHERE table_name = 'flight_crew' AND column_name = 'overrides'`,
        )
      ).length,
    ).toBe(1);
    expect(
      (
        await db.query(
          `SELECT column_name FROM information_schema.columns WHERE table_name = 'aircraft' AND column_name = 'placeholder'`,
        )
      ).length,
    ).toBe(1);
    expect(MIGRATIONS.map((m) => m.name).slice(-10)).toEqual([
      '030_mail_log',
      '031_mail_log_details',
      '032_rate_limits',
      '040_app_errors',
      '042_crew_overrides',
      '043_aircraft_placeholder',
      '044_weather_cache',
      '045_passenger_email',
      '046_performance_speeds_kt',
      '047_pilot_files',
    ]);
    await db.close();
  });
});

import { expect as eRace, test as tRace } from 'vitest';

import { connect as connectRace } from '../../api/_lib/db';
import { migrate as migrateRace, MIGRATIONS as LIST } from '../../api/_lib/migrate';
tRace('a migration already applied by another instance is skipped, not re-run', async () => {
  const db = await connectRace('memory://');
  await migrateRace(db);
  // simulate a second instance that read an older state: forget nothing, re-run the whole list
  eRace(await migrateRace(db, LIST)).toEqual([]);
});
