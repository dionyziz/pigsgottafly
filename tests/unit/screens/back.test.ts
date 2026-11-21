import { describe, expect, it } from 'vitest';

import { backLabel, backTarget, safePath, withBack } from '../../../src/app/back';
import { nextPath } from '../../../src/features/profile/ProfilePage';

describe('out and back (?back=)', () => {
  it('takes in-app paths only', () => {
    expect(safePath('/flights/f1/export/form731')).toBe('/flights/f1/export/form731');
    expect(safePath('/flights/f1?x=1#y')).toBe('/flights/f1?x=1#y');
    for (const bad of [null, undefined, '', 'flights/f1', '//evil.example', '/\\evil.example', 'https://evil.example'])
      expect(safePath(bad)).toBeNull();
    expect(safePath('javascript:alert(1)')).toBeNull();
  });

  it('comes back to the same page, without its one-off focus', () => {
    expect(backTarget('/flights/f1/export/form731')).toBe('/flights/f1/export/form731');
    expect(backTarget('/flights/f1', '?focus=fob&x=1', '#a')).toBe('/flights/f1?x=1#a');
    expect(backTarget('/flights/f1', '?back=%2Fprofile')).toBe('/flights/f1');
  });

  it('adds the way back to links out of a flight', () => {
    const back = '/flights/f1/export/form731';
    expect(withBack('/passengers?edit=p1&fields=email', back)).toBe(
      '/passengers?edit=p1&fields=email&back=%2Fflights%2Ff1%2Fexport%2Fform731',
    );
    expect(withBack('/profile', '/flights/f1')).toBe('/profile?back=%2Fflights%2Ff1');
    expect(withBack('/hangar/a1#mb', '/flights/f1')).toBe('/hangar/a1?back=%2Fflights%2Ff1#mb');
    // within the flight, and without a safe target: unchanged
    expect(withBack('/flights/f1?focus=fob', back)).toBe('/flights/f1?focus=fob');
    expect(withBack('/profile', null)).toBe('/profile');
    expect(withBack('/profile', '//evil.example')).toBe('/profile');
  });

  it('names where it goes back to', () => {
    expect(backLabel('/flights/f1/export/form731')).toBe('Back to Form 731');
    expect(backLabel('/flights/f1/export/gendec?x=1')).toBe('Back to General Declaration');
    expect(backLabel('/flights/f1/export/wb')).toBe('Back to Weight & balance and performance');
    expect(backLabel('/flights/f1')).toBe('Back to the flight');
    expect(backLabel('/flights/f1?x=1')).toBe('Back to the flight');
    expect(backLabel('/flights/f1/export/nope')).toBe('Back');
    expect(backLabel('/hangar')).toBe('Back');
  });

  it('the first-use profile goes on to ?next= the same way', () => {
    expect(nextPath('/flights/f1/export/form731')).toBe('/flights/f1/export/form731');
    expect(nextPath('/\\evil.example')).toBe('/');
    expect(nextPath('/profile?focus=phone')).toBe('/');
  });
});
