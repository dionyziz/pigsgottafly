// The client error reporter's gate (src/app/errorReporter.ts): dedupe, the per-page cap, noise
// filtering and scrubbing; and the URL scrubbing shared with the server (src/shared/monitoring.ts).
import { describe, expect, test } from 'vitest';
import { createReporter } from '../../../src/app/errorReporter';
import { scrubText, scrubUrl, type ClientErrorReport } from '../../../src/shared/monitoring';

function setup(max = 20) {
  let t = 1_000_000;
  const out: ClientErrorReport[] = [];
  const report = createReporter((r) => out.push(r), { now: () => t, max });
  return { report, out, advance: (ms: number) => { t += ms; } };
}

describe('client error reporter', () => {
  test('the same error is sent once per 10 minutes', () => {
    const { report, out, advance } = setup();
    const e = { source: 'error' as const, message: 'x is undefined', stack: 'TypeError: x\n    at f (a.js:1:1)' };
    expect(report(e)).toBe(true);
    for (let i = 0; i < 100; i++) expect(report(e)).toBe(false); // a render loop
    advance(9 * 60e3);
    expect(report(e)).toBe(false);
    advance(2 * 60e3);
    expect(report(e)).toBe(true);
    expect(out).toHaveLength(2);
    // a different message, or the same from elsewhere, is another error
    expect(report({ ...e, message: 'y is undefined' })).toBe(true);
    expect(report({ ...e, stack: 'TypeError: x\n    at g (b.js:2:2)' })).toBe(true);
  });

  test('at most max reports per page, even when all differ', () => {
    const { report, out } = setup(5);
    for (let i = 0; i < 50; i++) report({ source: 'rejection', message: `failure ${i}` });
    expect(out).toHaveLength(5);
  });

  test('stale chunks, extensions and browser noise are not reported', () => {
    const { report, out } = setup();
    expect(report({ source: 'react', message: 'Failed to fetch dynamically imported module: https://x/assets/a.js' })).toBe(false);
    expect(report({ source: 'error', message: 'Script error.' })).toBe(false);
    expect(report({ source: 'error', message: 'ResizeObserver loop completed with undelivered notifications.' })).toBe(false);
    expect(report({ source: 'error', message: 'boom', stack: 'at x (chrome-extension://abc/content.js:1:1)' })).toBe(false);
    expect(out).toHaveLength(0);
  });

  test('scrubbed before sending: path only, ids masked, no e-mails', () => {
    const { report, out } = setup();
    report({ source: 'api', message: 'failed for a@b.com', method: 'PUT', status: 502, apiPath: '/api/flights/fl_Xk3abcdEF?x=1', url: 'https://pigsgottafly.com/flights/fl_Xk3abcdEF/export/navlog?token=s3cret#x' });
    expect(out[0]).toMatchObject({ message: 'failed for <email>', apiPath: '/api/flights/:id', url: '/flights/:id/export/navlog' });
  });
});

describe('scrubbing', () => {
  test('urls', () => {
    expect(scrubUrl('/sign/AbCdEfGhIjKlMnOpQrStUvWx')).toBe('/sign/:id');
    expect(scrubUrl('/hangar/ac_123456')).toBe('/hangar/:id');
    expect(scrubUrl('/flights/123')).toBe('/flights/:id');
    expect(scrubUrl('/flights/new')).toBe('/flights/new');
    expect(scrubUrl('/flights/x/export/form731')).toBe('/flights/x/export/form731');
    expect(scrubUrl('/waypoints?q=LGTT')).toBe('/waypoints');
    expect(scrubUrl(null)).toBeNull();
  });
  test('text', () => {
    expect(scrubText('mail pilot@example.com now')).toBe('mail <email> now');
    expect(scrubText('Bearer abc.def')).toBe('Bearer <redacted>');
    expect(scrubText('tok a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7 end')).toBe('tok <token> end');
  });
});
