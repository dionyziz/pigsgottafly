// The core's operator editor, list and documents against the website's modules (operators/model.ts,
// hangar/documents.ts).
import { describe, expect, test } from 'vitest';

import { documentDetail, documentPickError } from '../../../src/features/hangar/documents';
import {
  normalizedOperator,
  operatorHead,
  operatorPeople,
  operatorRow,
  validateOperator,
} from '../../../src/features/operators/model';
import { documents, newOperator, operatorForm, operatorList } from '../../../src/native/core';
import { EMPTY_OPERATOR, type OperatorItem, type OperatorPerson } from '../../../src/shared';
import type { AircraftFile } from '../../../src/shared/types';

const json = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const owner = { pilotId: 'me', name: 'Fixture Pilot', email: 'pilot@example.com' };
const OP: OperatorItem = {
  ...EMPTY_OPERATOR,
  id: 'op-1',
  name: 'AEROCLUB MESOGEION',
  phone: '+30 210 000',
  email: 'ops@example.com',
  requiresWbPerf: true,
  declarationsEmail: 'ops@example.com',
  created: 0,
  updated: 0,
  access: { role: 'owner', owner, viaAircraft: [] },
  aircraft: [{ id: 'a1', registration: 'SX-ASV' }],
};
const PEOPLE: OperatorPerson[] = [
  { ...owner, role: 'owner', added: null, via: [], direct: true },
  { pilotId: 'x', name: '', email: 'x@example.com', role: 'view', added: 1, via: ['SX-ASV'], direct: false },
];

describe('operatorForm: the operator editor', () => {
  test('the fields, the body, the head and the people, as the website', () => {
    const out = operatorForm({ operator: OP, people: PEOPLE, myId: 'me' });
    expect(out.issues).toEqual([]);
    expect(out.body).toEqual(json(normalizedOperator(out.input)));
    expect(out.input).not.toHaveProperty('id');
    expect(out.head).toEqual(json(operatorHead(OP)));
    expect(out.head).toMatchObject({ subtitle: 'SX-ASV', readOnly: false, canDelete: true, chip: null });
    expect(out.people).toEqual(json(operatorPeople(PEOPLE, 'me')));
    expect(out.people?.map((p) => p.label)).toEqual(['Owner', 'Viewer · through SX-ASV']);
    expect(out.people?.[0].self).toBe(true);
  });

  test('an edited draft: issues hold the body back; the saved body is trimmed', () => {
    const bad = { ...OP, name: ' ', declarationsEmail: '' };
    const out = operatorForm({ operator: OP, draft: bad });
    expect(out.issues).toEqual(validateOperator(bad));
    expect(out.issues.map((i) => i.field)).toEqual(['name', 'declarationsEmail']);
    expect(out.body).toBeNull();
    const good = operatorForm({ operator: OP, draft: { ...OP, name: '  Aero  ', email: ' a@b.gr ' } });
    expect(good.body).toMatchObject({ name: 'Aero', email: 'a@b.gr' });
  });

  test('a viewer: read only, shared by its owner', () => {
    const viewed = {
      ...OP,
      access: { role: 'view' as const, owner: { ...owner, name: 'Olga' }, viaAircraft: ['SX-ASV'] },
    };
    const head = operatorForm({ operator: viewed }).head;
    expect(head).toMatchObject({ readOnly: true, canDelete: false, viewOnly: 'Shared by Olga' });
    expect(head.chip?.text).toBe('Shared by Olga · Viewer');
  });
});

describe('the list, a new operator, documents', () => {
  test('operatorList', () => {
    expect(operatorList({ operators: [OP] }).rows).toEqual(json([operatorRow(OP)]));
    expect(operatorList({ operators: [OP] }).rows[0]).toMatchObject({
      contact: '+30 210 000 · ops@example.com',
      aircraft: 'SX-ASV',
      flags: [{ label: 'W&B + performance' }],
    });
  });

  test('newOperator', () => {
    expect(newOperator({ name: '  ' })).toEqual({ body: null, error: 'Enter the operator’s name.' });
    expect(newOperator({ name: ' Aero ' }).body).toEqual({ ...EMPTY_OPERATOR, name: 'Aero' });
  });

  test('documents', () => {
    const f: AircraftFile = {
      id: 'f1',
      kind: 'document',
      title: 'Manual',
      name: 'manual.pdf',
      mime: 'application/pdf',
      size: 3 * 1048576,
      chunks: 2,
      uploaded: Date.parse('2026-11-15T10:00:00Z'),
    };
    const out = documents({ documents: [f] });
    expect(out.rows).toEqual([{ id: 'f1', title: 'Manual', detail: documentDetail(f) }]);
    expect(out.rows[0].detail).toBe('manual.pdf · 3.0 MB · 2026-11-15');
    expect(out.hint).toBe('Up to 80.0 MB');
    const pick = { type: 'application/pdf', size: 1000, name: 'Ops Manual.PDF' };
    expect(documents({ pick }).start).toEqual({
      kind: 'document',
      name: 'Ops Manual.PDF',
      title: 'Ops Manual',
      mime: 'application/pdf',
      size: 1000,
    });
    expect(documents({ pick, title: ' OM-A ' }).start?.title).toBe('OM-A');
    const png = { type: 'image/png', size: 1, name: 'x.png' };
    expect(documents({ pick: png })).toMatchObject({ pickError: documentPickError(png), start: null });
    expect(documents({ pick: { ...pick, size: 81 * 1048576 } }).pickError).toBe(
      'The file is 81.0 MB; the limit is 80.0 MB.',
    );
    expect(documents({ rename: { title: 'Manual', typed: ' Manual ' } }).renamed).toBeNull();
    expect(documents({ rename: { title: 'Manual', typed: 'OM-A' } }).renamed).toBe('OM-A');
  });
});
