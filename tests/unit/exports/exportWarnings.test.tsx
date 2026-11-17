// @vitest-environment jsdom
// The one warnings box of the exports (src/features/exports/WarningList.tsx ExportWarnings): the
// shared WarningList, each warning with a link to where it is fixed.
import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, test } from 'vitest';

import { ExportWarnings } from '../../../src/features/exports/WarningList';

afterEach(cleanup);
const at = (node: ReactNode) =>
  render(
    <MemoryRouter initialEntries={['/flights/f1/export/navlog']}>
      <Routes>
        <Route path="/flights/:id/export/:kind" element={node} />
      </Routes>
    </MemoryRouter>,
  ).container.innerHTML;

describe('ExportWarnings', () => {
  test('nothing without warnings', () => {
    expect(at(<ExportWarnings warnings={[]} />)).toBe('');
  });

  test('planning warnings link to the editor; given fixes win; classify=false leaves plain text', () => {
    const html = at(
      <ExportWarnings
        warnings={[
          'Block start time not set.',
          'Something about the weather',
          { text: 'Colours missing', fix: { kind: 'aircraft', focus: 'colours' } },
        ]}
        aircraftId="ac1"
        title="Check"
        testId="w"
      />,
    );
    expect(html).toContain('class="export-warnings warn no-print"');
    expect(html).toContain('data-testid="w"');
    expect(html).toContain('<strong class="export-warnings-title">Check</strong>');
    expect(html).toContain('href="/flights/f1?focus=blockOff"');
    expect(html).toContain('href="/hangar/ac1?focus=colours"');
    expect(html.match(/data-testid="warning-fix"/g)).toHaveLength(2);

    const plain = at(<ExportWarnings warnings={['Block start time not set.']} classify={false} level="danger" />);
    expect(plain).toContain('export-warnings danger');
    expect(plain).toContain('<li class="danger">');
    expect(plain).not.toContain('warning-fix');
  });
});
