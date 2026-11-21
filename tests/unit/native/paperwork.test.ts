// PGF.paperwork: the File & forms rows, as the website's checklist shows them (readiness.ts paperwork).
import { expect, test } from 'vitest';

import { paperwork as webPaperwork } from '../../../src/features/editor/panels/readiness';
import { paperwork } from '../../../src/native/core';

// the states as the API answers them, with only the fields the rows read
type Input = Partial<Parameters<typeof webPaperwork>[0]>;
const cases = {
  'nothing loaded': {},
  'filed, Form 731 to sign, GenDec to send, operator sheets sent': {
    filing: { filing: { status: 'filed' } },
    forms: {
      form731: { signatures: [{ signed: true }, { signed: false }], submission: null },
      gendec: { pilotSends: true, submission: null },
    },
    declarations: { operator: { name: 'Aeroclub', requiresWbPerf: true }, submission: { sent: 1 } },
  },
  'rejected, Form 731 changed since sent': {
    filing: { filing: { status: 'rejected' } },
    forms: { form731: { signatures: [], submission: { changed: true } }, gendec: { pilotSends: false } },
    declarations: null,
  },
} as unknown as Record<string, Input>;

for (const [name, input] of Object.entries(cases))
  test(`${name}: the website's rows`, () => {
    const web = webPaperwork({
      filing: null,
      forms: null,
      declarations: null,
      ...input,
    });
    expect(paperwork(input)).toEqual(JSON.parse(JSON.stringify(web)));
    expect(paperwork(JSON.stringify(input))).toEqual(paperwork(input));
  });

test('the rows say what is left to do', () => {
  const rows = paperwork(cases['filed, Form 731 to sign, GenDec to send, operator sheets sent']);
  expect(rows.map((r) => [r.id, r.state, r.text])).toEqual([
    ['filing', 'ok', 'Filed.'],
    ['form731', 'todo', '1 signature missing, then send it.'],
    ['gendec', 'todo', 'No handler at one end: send it yourself.'],
    ['operator', 'ok', 'Sent.'],
  ]);
});
