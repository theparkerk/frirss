import { describe, it, expect } from 'vitest';
import { swipeOutcome } from './swipeOutcome';

const base = { threshold: 60, hasNext: true, hasPrev: true, swipeRightBack: false };

describe('swipeOutcome', () => {
  it('goes next / prev past the threshold, springs back under it', () => {
    expect(swipeOutcome({ ...base, dx: -80 })).toBe('next');
    expect(swipeOutcome({ ...base, dx: 80 })).toBe('prev');
    expect(swipeOutcome({ ...base, dx: 30 })).toBe('none');
    expect(swipeOutcome({ ...base, dx: -30 })).toBe('none');
  });

  it('springs back at the ends of the list', () => {
    expect(swipeOutcome({ ...base, dx: -80, hasNext: false })).toBe('none');
    expect(swipeOutcome({ ...base, dx: 80, hasPrev: false })).toBe('none');
  });

  it('with the preference on, a right swipe goes back to the list even mid-list or at the top', () => {
    expect(swipeOutcome({ ...base, dx: 80, swipeRightBack: true })).toBe('back');
    expect(swipeOutcome({ ...base, dx: 80, hasPrev: false, swipeRightBack: true })).toBe('back');
    expect(swipeOutcome({ ...base, dx: -80, swipeRightBack: true })).toBe('next');
    expect(swipeOutcome({ ...base, dx: 30, swipeRightBack: true })).toBe('none');
  });
});
