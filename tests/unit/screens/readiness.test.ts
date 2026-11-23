// "Ready to fly": the checklist rows by stage, from the warnings, the NOTAMs and the paperwork.
import { describe, expect, test } from 'vitest';

import type { CalcWarning } from '../../../src/features/editor/panels/calc';
import { picMissingOf, readiness, stageSummary } from '../../../src/features/editor/panels/readiness';
import type { PersonField } from '../../../src/features/exports/fix';
import { EMPTY_PERSON } from '../../../src/shared';
import type { FilingState, NotamBriefing } from '../../../src/shared/briefing';
import { form731Needed, type FormsState } from '../../../src/shared/forms';

const base = {
  picMissing: [] as PersonField[],
  routePoints: 2,
  hasAircraft: true,
  warnings: [] as CalcWarning[],
  notams: null as NotamBriefing | null,
  notamsRead: false,
  filing: null as FilingState | null,
  forms: null as FormsState | null,
  declarations: null,
};
const byId = (items: ReturnType<typeof readiness>) => Object.fromEntries(items.map((x) => [x.id, x]));

describe('readiness', () => {
  test('a new flight: route and aircraft to do, the rest of the plan fine', () => {
    const r = byId(readiness({ ...base, routePoints: 0, hasAircraft: false }));
    expect([r.route.state, r.aircraft.state, r.fuel.state, r.wb.state]).toEqual(['todo', 'todo', 'ok', 'ok']);
    expect(r.route.text).toBe('Draw the route on the map.');
  });
  test("the PIC's missing details come first, each with the papers that need it and the way to add them", () => {
    const r = readiness({ ...base, picMissing: ['fullName', 'phone', 'idNumber'] });
    expect(r[0]).toMatchObject({
      id: 'profile',
      state: 'todo',
      label: 'Your details',
      text: 'The flight plan and Form 731 need your name, phone and ID or passport number.',
      link: { to: '/passengers?edit=me&fields=fullName,phone,idNumber', label: 'Add your name, phone and ID number' },
    });
    expect(readiness({ ...base, picMissing: ['idNumber'] })[0]).toMatchObject({
      text: 'Form 731 needs your ID or passport number.',
      link: { to: '/passengers?edit=me&fields=idNumber' },
    });
    // nothing missing (a pilot with all three, or a flight shared with them): no row
    expect(readiness(base).some((x) => x.id === 'profile')).toBe(false);
  });
  test("what the PIC lacks: the flight's PIC entry first, then the pilot's details", () => {
    const pilot = { ...EMPTY_PERSON, fullName: 'Test Pilot' };
    expect(picMissingOf([], pilot)).toEqual(['phone', 'idNumber']);
    expect(picMissingOf([], EMPTY_PERSON)).toEqual(['fullName', 'phone', 'idNumber']);
    const crew = [{ role: 'PIC' as const, snapshot: { ...EMPTY_PERSON, phone: '+30 1', idNumber: ' ' } }];
    expect(picMissingOf(crew, pilot)).toEqual(['idNumber']);
  });
  test('warnings go to their row: the worst sets the state and the text, with a count of the rest', () => {
    const warnings: CalcWarning[] = [
      { level: 'warn', area: 'wb', text: 'CG near the aft limit.' },
      { level: 'danger', area: 'manifest', text: 'Weight of Test Pilot is not set.' },
      { level: 'info', area: 'fuel', text: 'Fuel note.' },
      { level: 'danger', area: 'time', text: 'Landing 18:20Z is after sunset at the destination (17:10Z).' },
    ];
    const items = readiness({ ...base, warnings });
    const r = byId(items);
    expect(r.wb).toMatchObject({ state: 'danger', text: 'Weight of Test Pilot is not set. (+1 more)' });
    expect(r.fuel.state).toBe('ok'); // info is not a problem
    expect(r.time).toMatchObject({ stage: 'brief', state: 'danger' });
    expect(stageSummary(items, 'plan')).toEqual({ state: 'danger', open: 1 });
  });
  test('NOTAMs: to read until marked read; none relevant is fine; not loaded is to do', () => {
    const b = { status: 'ok', relevantCount: 3, notams: [], message: null } as unknown as NotamBriefing;
    expect(byId(readiness({ ...base, notams: b })).notams).toMatchObject({
      state: 'todo',
      text: '3 relevant to read.',
    });
    expect(byId(readiness({ ...base, notams: b, notamsRead: true })).notams.state).toBe('ok');
    expect(byId(readiness({ ...base, notams: { ...b, relevantCount: 0 } })).notams.state).toBe('ok');
    expect(byId(readiness(base)).notams.state).toBe('todo');
  });
  test('paperwork: the flight plan, Form 731, the GenDec only when the pilot sends it, the operator’s sheets when asked', () => {
    const filing = (status: string) => ({ filing: { status } }) as unknown as FilingState;
    expect(byId(readiness(base)).filing).toMatchObject({ state: 'todo', text: 'Not filed yet.' });
    expect(byId(readiness({ ...base, filing: filing('filed') })).filing.state).toBe('ok');
    expect(byId(readiness({ ...base, filing: filing('rejected') })).filing.state).toBe('danger');
    // by fax: delivered is filed, a failed fax is to be filed again, sending is not yet
    expect(byId(readiness({ ...base, filing: filing('delivered') })).filing).toMatchObject({
      state: 'ok',
      text: 'Delivered by fax.',
    });
    expect(byId(readiness({ ...base, filing: filing('failed') })).filing.state).toBe('danger');
    expect(byId(readiness({ ...base, filing: filing('sending') })).filing).toMatchObject({
      state: 'todo',
      text: 'Sending by fax.',
    });
    const forms = (o: { signed: boolean[]; sent?: boolean; changed?: boolean; pilotSends?: boolean }) =>
      ({
        form731: {
          signatures: o.signed.map((signed, i) => ({ key: `p${i}`, signed })),
          submission: o.sent ? { changed: !!o.changed } : null,
        },
        gendec: { pilotSends: !!o.pilotSends, submission: null },
      }) as unknown as FormsState;
    const r1 = byId(readiness({ ...base, forms: forms({ signed: [true, false] }) }));
    expect(r1.form731).toMatchObject({ state: 'todo', text: '1 signature missing, then send it.' });
    expect(r1.gendec).toBeUndefined();
    const r2 = byId(
      readiness({ ...base, forms: forms({ signed: [true], sent: true, changed: true, pilotSends: true }) }),
    );
    expect(r2.form731.state).toBe('warn');
    expect(r2.gendec.state).toBe('todo');
    // a PIC alone files no Form 731
    const solo = forms({ signed: [true] });
    solo.form731.needed = false;
    expect(byId(readiness({ ...base, forms: solo })).form731).toBeUndefined();
    expect(form731Needed([{ role: 'PIC' }])).toBe(false);
    expect(form731Needed([{ role: 'PIC' }, { role: 'PAX' }])).toBe(true);
    const decl = { operator: { name: 'Club', requiresWbPerf: true }, submission: null } as never;
    expect(byId(readiness({ ...base, declarations: decl })).operator).toMatchObject({ stage: 'file', state: 'todo' });
  });
});
