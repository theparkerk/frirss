import { describe, it, expect } from 'vitest';
import { feedAutoExtractOn } from './autoExtract';

describe('feedAutoExtractOn', () => {
  const feedSettings = { 'feed/1': { autoExtract: true }, 'feed/2': { layout: 'grid' } };

  it('follows the per-feed setting when the global switch is off', () => {
    expect(feedAutoExtractOn({ autoExtractAll: false, feedSettings }, 'feed/1')).toBe(true);
    expect(feedAutoExtractOn({ autoExtractAll: false, feedSettings }, 'feed/2')).toBe(false);
    expect(feedAutoExtractOn({ autoExtractAll: false, feedSettings }, 'feed/9')).toBe(false);
    expect(feedAutoExtractOn({ autoExtractAll: false, feedSettings }, undefined)).toBe(false);
  });

  it('covers every feed when the global switch is on', () => {
    expect(feedAutoExtractOn({ autoExtractAll: true, feedSettings }, 'feed/2')).toBe(true);
    expect(feedAutoExtractOn({ autoExtractAll: true, feedSettings }, 'feed/9')).toBe(true);
    expect(feedAutoExtractOn({ autoExtractAll: true, feedSettings }, undefined)).toBe(true);
  });
});
