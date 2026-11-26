// A cycle loaded ahead of its date switches on by itself at 0000 UTC on that date (AIP-UPDATE.md): the API's
// AIRAC in effect (api/_lib/airac.ts), the clients' (src/shared/ref.ts cycleOn), and the shipped cycle lists. A
// flight is planned with the cycle in effect on its own date (flightAiracDay) on the website, the API and the core.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';

import { airacInEffect, nextAirac } from '../../api/_lib/airac';
import type { Db } from '../../api/_lib/db';
import { flightContext } from '../../api/_lib/flightContext';
import { aipLinksOn } from '../../src/data/aipLinks';
import { CYCLE, refOfFlight } from '../../src/data/ref';
import { CYCLES } from '../../src/data/ref/cycles';
import { CYCLES as CORE_CYCLES } from '../../src/data/ref/cycles/core';
import { refOf } from '../../src/native/core/shared';
import { airacDay, cycleOn, flightAiracDay } from '../../src/shared/ref';
import { client, googleClaims, signToken, startApi } from './helpers';

let apiBase = '';
const cycle = (id: string, effective: string) => ({ airac: { id, name: id, effective } });

describe('the rule', () => {
  const list = [cycle('2611', '2026-12-24'), cycle('2610', '2026-11-26')];
  test('the latest cycle whose date has come; before any, the earliest', () => {
    expect(cycleOn(list, '2026-12-23').airac.id).toBe('2610');
    expect(cycleOn(list, '2026-12-24').airac.id).toBe('2611');
    expect(cycleOn(list, '2027-06-01').airac.id).toBe('2611');
    expect(cycleOn(list, '2026-01-01').airac.id).toBe('2610');
  });
  test('the day is UTC, unless pinned', () => {
    const prev = process.env.PGF_AIRAC_DATE;
    delete process.env.PGF_AIRAC_DATE;
    try {
      expect(airacDay(Date.parse('2026-12-23T23:59:59Z'))).toBe('2026-12-23');
      expect(airacDay(Date.parse('2026-12-24T00:00:00Z'))).toBe('2026-12-24');
    } finally {
      process.env.PGF_AIRAC_DATE = prev;
    }
  });
  test('the website and the core ship the same cycles; tests run on the newest', () => {
    expect(CYCLES.map((c) => c.airac.id)).toEqual(CORE_CYCLES.map((c) => c.airac.id));
    expect(CYCLE.airac.id).toBe(
      CYCLES.map((c) => c.airac.id)
        .sort()
        .at(-1),
    );
  });
});

describe('a flight is planned with the cycle of its date, not of the day it is planned', () => {
  const [prior, next] = CYCLES.slice(-2).map((c) => c.airac);
  const before = new Date(Date.parse(next.effective) - 86400e3).toISOString().slice(0, 10);
  test('the rule: the flight’s date, else today', () => {
    expect(flightAiracDay('2027-03-04')).toBe('2027-03-04');
    expect(flightAiracDay('', Date.parse('2026-12-01T12:00:00Z'))).toBe(airacDay(Date.parse('2026-12-01T12:00:00Z')));
  });
  test('the website: reference data, sunset tables and eAIP links', () => {
    expect(refOfFlight(before).airac.id).toBe(prior.id);
    expect(refOfFlight(next.effective).airac.id).toBe(next.id);
    expect(refOfFlight(next.effective).aip.base).toBe(aipLinksOn(next.effective).base);
    expect(refOfFlight(before).aip.base).not.toBe(refOfFlight(next.effective).aip.base);
    expect(refOfFlight(next.effective).sun).toBe(CYCLES.at(-1)!.sun);
  });
  test('the native core: the bundle the app picked for the flight decides the eAIP and the tables', () => {
    const bundle = (a: typeof prior) => ({
      ...refOfFlight(a.effective).ref,
      adAirspaces: undefined,
      navaids: undefined,
    });
    expect(refOf(bundle(prior)).aip.airac.id).toBe(prior.id);
    expect(refOf(bundle(next)).aip.airac.id).toBe(next.id);
    expect(refOf(bundle(next)).sunTables).toBe(CORE_CYCLES.find((c) => c.airac.id === next.id)!.sun);
  });
});

describe('the API', () => {
  let api: Awaited<ReturnType<typeof startApi>>;
  let db: Db;
  const prev = process.env.PGF_AIRAC_DATE;
  beforeAll(async () => {
    api = await startApi();
    apiBase = api.base;
    db = (await api.server.ready).db;
  });
  afterEach(() => {
    process.env.PGF_AIRAC_DATE = prev;
  });
  afterAll(() => api.close());

  test('every shipped cycle is loaded; the next one serves from its date, not before', async () => {
    const loaded = (await db.query<{ id: string }>('SELECT id FROM ref_airac')).map((r) => r.id);
    for (const c of CYCLES) expect(loaded).toContain(c.airac.id);
    const [prior, next] = CYCLES.slice(-2).map((c) => c.airac);
    const c = client(api.base);
    await c.login('sub-airac', 'airac@example.com');

    process.env.PGF_AIRAC_DATE = new Date(Date.parse(next.effective) - 86400e3).toISOString().slice(0, 10);
    expect((await airacInEffect(db))!.id).toBe(prior.id);
    expect((await nextAirac(db))!.id).toBe(next.id);
    expect((await c.call('GET', 'ref/airac')).body.id).toBe(prior.id);

    process.env.PGF_AIRAC_DATE = next.effective;
    expect((await c.call('GET', 'ref/airac')).body.id).toBe(next.id);
    const r = await fetch(api.base + 'ref/bundle', {
      headers: { cookie: await signIn('sub-airac', 'airac@example.com') },
    });
    expect(r.headers.get('etag')).toBe(`"ref-${next.id}-1"`);
  });

  test('a flight dated in the next cycle is computed with it while today is still in the one before', async () => {
    const [prior, next] = CYCLES.slice(-2).map((c) => c.airac);
    process.env.PGF_AIRAC_DATE = new Date(Date.parse(next.effective) - 86400e3).toISOString().slice(0, 10);
    const c = client(api.base);
    await c.login('sub-airac-3', 'airac3@example.com');
    const me = (await c.call('GET', 'me')).body;
    const later = (await c.call('POST', 'flights', { date: next.effective })).body;
    const now = (await c.call('POST', 'flights', { date: process.env.PGF_AIRAC_DATE })).body;
    expect((await flightContext(db, me.id, later.id)).ref.airac).toBe(next.id);
    expect((await flightContext(db, me.id, now.id)).ref.airac).toBe(prior.id);

    const cycles = (await c.call('GET', 'ref/cycles')).body;
    expect(cycles.map((a: { id: string }) => a.id)).toEqual([prior.id, next.id]);
    expect((await c.call('GET', 'ref/bundle?airac=' + next.id)).body.airac.id).toBe(next.id);
    expect((await c.call('GET', 'ref/bundle?date=' + next.effective)).body.airac.id).toBe(next.id);
    expect((await c.call('GET', 'ref/bundle')).body.airac.id).toBe(prior.id);
    expect((await c.call('GET', 'ref/bundle?airac=0000')).status).toBe(404);
    expect((await c.call('GET', 'ref/bundle?date=tomorrow')).status).toBe(400);

    process.env.PGF_AIRAC_DATE = next.effective;
    expect((await c.call('GET', 'ref/cycles')).body.map((a: { id: string }) => a.id)).toEqual([next.id]);
  });

  test('a client keeps the bundle no later than the next cycle’s start', async () => {
    const next = CYCLES.at(-1)!.airac;
    // the day before the newest cycle: it is the next one, and the bundle must not outlive its start
    process.env.PGF_AIRAC_DATE = new Date(Date.parse(next.effective) - 86400e3).toISOString().slice(0, 10);
    const r = await fetch(api.base + 'ref/bundle', {
      headers: { cookie: await signIn('sub-airac-2', 'airac2@example.com') },
    });
    const maxAge = Number(/max-age=(\d+)/.exec(r.headers.get('cache-control') ?? '')?.[1]);
    const untilNext = Math.floor((Date.parse(next.effective + 'T00:00:00Z') - Date.now()) / 1000);
    expect(maxAge).toBe(Math.max(0, Math.min(86400, untilNext)));
  });
});

async function signIn(sub: string, email: string): Promise<string> {
  const r = await fetch(apiBase + 'login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: signToken(googleClaims(sub, email)) }),
  });
  return (r.headers.get('set-cookie') ?? '').split(';')[0];
}
