// PGF.form731Panel, genDecPanel, operatorPanel and declarationText: the File & forms panels as the
// website's (form731/signatures.ts, gendec/send.ts, wbperf/send.ts), for the API's states.
import { describe, expect, test } from 'vitest';

import {
  form731Actions,
  personActions,
  signatureStatus,
  signatureSummary,
} from '../../../src/features/exports/form731/signatures';
import { genDecSendState } from '../../../src/features/exports/gendec/send';
import { operatorSendState } from '../../../src/features/exports/wbperf/send';
import { declarationText, form731Panel, genDecPanel, operatorPanel } from '../../../src/native/core';
import type { DeclarationsState } from '../../../src/shared/declarations';
import { fmtLocalDayTime } from '../../../src/shared/format';
import type { FormsState, SignatureState } from '../../../src/shared/forms';

const NOW = Date.parse('2026-11-20T10:00:00Z');
const H = 3600e3;

const person = (over: Partial<SignatureState>): SignatureState => ({
  key: 'PIC',
  role: 'PAX',
  name: '',
  signed: false,
  signedAt: null,
  needsResign: false,
  email: '',
  emailedAt: null,
  link: null,
  ...over,
});
const link = (over: Partial<NonNullable<SignatureState['link']>> = {}) => ({
  created: NOW - H,
  firstOpened: null,
  lastOpened: null,
  revoked: false,
  expires: NOW + 48 * H,
  ...over,
});

function forms(over: { signatures?: SignatureState[]; submission?: FormsState['form731']['submission'] } = {}) {
  const signatures = over.signatures ?? [
    person({ key: 'PIC', role: 'PIC', name: 'FIXTURE PILOT', signed: true, signedAt: NOW - 2 * H }),
    person({ key: 'pax-anna', name: 'ANNA PAPADOPOULOU', email: 'anna@example.com', link: link() }),
    person({ key: 'pax-nikos', name: 'NIKOS GEORGIOU', link: link({ lastOpened: NOW - H / 2 }) }),
    person({ key: 'seat:rear-right', name: 'MARIA KOSTA' }),
  ];
  return {
    form731: {
      content: { airport: 'LGTT', date: '2026-11-22', registration: 'SX-ASV', route: 'LGTT – LGSY', people: [] },
      signatures,
      allSigned: signatures.every((s) => s.signed),
      submission: over.submission ?? null,
      needed: true,
    },
    gendec: {
      content: { placeCount: 2 },
      submission: null,
      pilotSends: true,
      handling: {
        ends: [
          {
            role: 'departure',
            code: 'LGTT',
            icao: 'LGTT',
            handled: false,
            reason: 'LGTT: no handling (AIP AD 1.6.5.4)',
          },
          { role: 'destination', code: 'LGSY', icao: 'LGSY', handled: true, reason: 'LGSY: handling H24 (AIP AD 2.3)' },
        ],
        autoPilotSends: true,
        override: null,
        pilotSends: true,
      },
      picSignature: { name: 'FIXTURE PILOT', signedAt: NOW - 2 * H },
    },
    emailEnabled: true,
    emailReason: null,
  } as unknown as FormsState;
}

describe('form731Panel', () => {
  test('each person as the website lists them, with what can be done', () => {
    const st = forms();
    const p = form731Panel({ forms: st, links: { 'pax-anna': 'tok123' }, now: NOW });
    expect(p.summary).toBe(signatureSummary(st));
    expect(p.summary).toMatch(
      /^1 of 4 signed · ANNA has not opened the link · NIKOS opened \d\d:\d\d, not signed · MARIA: no link yet$/,
    );
    expect(p.tone).toBe('warn');
    expect(p.signatures).toEqual({ PIC: { name: 'FIXTURE PILOT', signedAt: NOW - 2 * H } });
    expect(p.people.map((x) => x.status)).toEqual(st.form731.signatures.map(signatureStatus));
    expect(p.people[0].status).toBe(`signed ${fmtLocalDayTime(NOW - 2 * H)}`);
    expect(p.people.map((x) => x.actions)).toEqual(
      st.form731.signatures.map((s) => personActions(s, s.key === 'pax-anna')),
    );
    // Anna: a link and an address; Nikos: a link, no address (a saved passenger: add one); Maria: seat only
    expect(p.people[1].actions).toEqual({ renew: true, revoke: true, email: true, addEmail: false });
    expect(p.people[2].actions).toEqual({ renew: true, revoke: true, email: false, addEmail: true });
    expect(p.people[3].actions).toEqual({ renew: false, revoke: false, email: false, addEmail: false });
    expect(p.people[2].addEmailPath).toBe('/passengers?edit=pax-nikos&fields=email');
    expect(p.people[1].link).toEqual({
      url: 'https://pigsgottafly.com/sign/tok123',
      text: 'Please sign Form 731 (persons boarding) for our flight on 2026-11-22, ANNA PAPADOPOULOU:',
    });
    expect(p.people[2].link).toBeNull();
    const web = form731Actions(st, NOW);
    expect({ request: p.request, emailAll: p.emailAll, send: p.send, sent: p.sent, note: p.note }).toEqual(web);
    expect(p.request).toEqual({ shown: true, enabled: true });
    expect(p.emailAll).toEqual({ shown: true, enabled: true, keys: ['pax-anna'], hint: null });
    expect(p.send).toEqual({ label: 'Send to HCAA', enabled: false, hint: 'Everyone has to sign first' });
  });

  test('all signed: Send; sent: no second send until the form changes', () => {
    const signatures = [
      person({ key: 'PIC', role: 'PIC', name: 'P', signed: true, signedAt: NOW }),
      person({ key: 'pax-anna', name: 'ANNA', signed: true, signedAt: NOW, link: link() }),
    ];
    const ready = form731Panel({ forms: forms({ signatures }), now: NOW });
    expect(ready.summary).toBe('2 of 2 signed');
    expect(ready.tone).toBe('ok');
    expect(ready.request.enabled).toBe(false);
    expect(ready.send).toEqual({ label: 'Send to HCAA', enabled: true, hint: null });
    const submission = { sentAt: NOW, messageId: 'm', to: '731@hcaa.gov.gr', changed: false };
    const sent = form731Panel({ forms: forms({ signatures, submission }), now: NOW });
    expect(sent.send).toEqual({ label: 'Re-send to HCAA', enabled: false, hint: null });
    expect(sent.sent).toBe(`Sent to 731@hcaa.gov.gr on ${fmtLocalDayTime(NOW)}`);
    const changed = form731Panel({ forms: forms({ signatures, submission: { ...submission, changed: true } }) });
    expect(changed.send.enabled).toBe(true);
    expect(changed.sent).toMatch(/ · changed since$/);
  });

  test('a revoked link: a new one, until a new one is shown; an expired one asks for links again', () => {
    const revoked = person({ key: 'pax-anna', name: 'ANNA', link: link({ revoked: true }) });
    expect(personActions(revoked, false)).toMatchObject({ renew: true, revoke: false });
    expect(personActions(revoked, true)).toMatchObject({ renew: false, revoke: false });
    const expired = person({ key: 'pax-anna', name: 'ANNA', link: link({ expires: NOW - 1 }) });
    const p = form731Panel({ forms: forms({ signatures: [expired] }), now: NOW });
    expect(p.request.enabled).toBe(true);
  });

  test('no e-mail from here: the reason, and nothing sends', () => {
    const st = { ...forms(), emailEnabled: false, emailReason: 'Only the flight’s owner sends its forms.' };
    const p = form731Panel(JSON.stringify({ forms: st, now: NOW }));
    expect(p.note).toBe('Only the flight’s owner sends its forms.');
    expect(p.send.hint).toBe('Only the flight’s owner sends its forms.');
    expect(p.emailAll.enabled).toBe(false);
  });
});

describe('genDecPanel', () => {
  test('the PIC sends it: the ends with their reasons, Send', () => {
    const st = forms();
    const p = genDecPanel({ forms: st });
    const { signature, pilotSends, override, ...web } = p;
    expect(web).toEqual(genDecSendState(st));
    expect(p.status).toBe('Not sent');
    expect(p.send).toEqual({ label: 'Send to HCAA', enabled: true, hint: null });
    expect(p.ends.map((e) => `${e.label} ${e.reason}`)).toEqual([
      'Departure LGTT: no handling (AIP AD 1.6.5.4)',
      'Destination LGSY: handling H24 (AIP AD 2.3)',
    ]);
    expect(p.handled).toBe(false);
    expect(p.automatic).toBeNull();
    expect(signature).toEqual({ name: 'FIXTURE PILOT', signedAt: NOW - 2 * H });
    expect(pilotSends).toBe(true);
    expect(override).toBeNull();
  });

  test('"Submitted by a handler" overrides; set back to the automatic decision it is automatic again', () => {
    const st = forms();
    expect(genDecPanel({ forms: st, handled: true }).override).toBe(true);
    expect(genDecPanel({ forms: st, handled: false }).override).toBeNull();
    const handled = {
      ...st,
      gendec: {
        ...st.gendec,
        pilotSends: false,
        handling: { ...st.gendec.handling, override: true, pilotSends: false },
      },
    } as FormsState;
    const p = genDecPanel({ forms: handled });
    expect(p.status).toBe('Handled');
    expect(p.send).toBeNull();
    expect(p.handled).toBe(true);
    expect(p.automatic).toBe('Automatic: you send it');
  });

  test('sent, then changed: Re-send', () => {
    const st = forms();
    const sub = { sentAt: NOW, messageId: 'm', to: 'gendec@hcaa.gov.gr', changed: false };
    const sent = genDecPanel({ forms: { ...st, gendec: { ...st.gendec, submission: sub } } });
    expect([sent.status, sent.tone, sent.send?.enabled]).toEqual(['Sent', 'ok', false]);
    const changed = genDecPanel({ forms: { ...st, gendec: { ...st.gendec, submission: { ...sub, changed: true } } } });
    expect([changed.status, changed.send?.label, changed.send?.enabled]).toEqual([
      'Changed since it was sent',
      'Re-send to HCAA',
      true,
    ]);
  });
});

describe('operatorPanel', () => {
  const op = { id: 'op1', name: 'Aeroclub', requiresWbPerf: true, declarationsEmail: 'ops@example.com' };
  const decl = (over: Partial<DeclarationsState> = {}): DeclarationsState => ({
    operator: op,
    submission: null,
    emailEnabled: true,
    emailReason: null,
    ...over,
  });

  test('nothing when the operator does not ask for the sheets', () => {
    expect(operatorPanel({ declarations: null })).toBeNull();
    expect(operatorPanel({ declarations: decl({ operator: { ...op, requiresWbPerf: false } }) })).toBeNull();
  });

  test('not sent, sent, changed since sent (the sheets or the address)', () => {
    const p = operatorPanel({ declarations: decl(), hash: 'h1' })!;
    expect(p).toEqual(operatorSendState(decl(), 'h1', true));
    expect([p.title, p.status, p.send.label, p.send.enabled, p.address]).toEqual([
      'Send to Aeroclub',
      'Not sent',
      'Send to Aeroclub',
      true,
      'ops@example.com',
    ]);
    const submission = { sentAt: NOW, to: 'ops@example.com', hash: 'h1', messageId: 'm' };
    const sent = operatorPanel({ declarations: decl({ submission }), hash: 'h1' })!;
    expect([sent.status, sent.tone, sent.send.enabled, sent.send.label]).toEqual(['Sent', 'ok', false, 'Re-send']);
    expect(operatorPanel({ declarations: decl({ submission }), hash: 'h2' })!.status).toBe('Changed since it was sent');
    const moved = decl({ submission, operator: { ...op, declarationsEmail: 'new@example.com' } });
    expect(operatorPanel({ declarations: moved, hash: 'h1' })!.changed).toBe(true);
    expect(operatorPanel({ declarations: decl(), ready: false })!.send.enabled).toBe(false);
  });

  test('no address: where to set it', () => {
    const p = operatorPanel({ declarations: decl({ operator: { ...op, declarationsEmail: '' } }) })!;
    expect(p.address).toBeNull();
    expect(p.addressPath).toBe('/operators/op1?focus=declarationsEmail');
    expect(p.send.enabled).toBe(false);
  });
});

test('declarationText: the text the server hashes, whatever order the fields came in', () => {
  const minimal = { wb: { rows: [] }, perf: { pages: [] } };
  const a = declarationText({ content: minimal }).text;
  expect(typeof a).toBe('string');
  expect(JSON.parse(a)).toMatchObject({ wb: expect.any(Object), perf: expect.any(Object) });
  expect(declarationText({ content: { perf: { pages: [] }, wb: { rows: [] } } }).text).toBe(a);
});
