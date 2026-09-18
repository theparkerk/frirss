import type { FeedSetting } from '../stores/uiStore';

/** The two knobs that decide whether a feed opens with the full article. */
export interface AutoExtractPrefs {
  /** Global switch: every feed extracts, whatever its own setting says. */
  autoExtractAll: boolean;
  feedSettings: Record<string, FeedSetting>;
}

/**
 * True when articles from `feedId` should be extracted automatically.
 *
 * Per-feed « Auto full article » used to be the only way in — one context menu
 * at a time, which does not scale to hundreds of feeds. The global switch
 * (Preferences → General) sits on top: per-feed settings still exist and take
 * over again the moment the switch is turned off.
 */
export function feedAutoExtractOn(prefs: AutoExtractPrefs, feedId: string | undefined): boolean {
  if (prefs.autoExtractAll) return true;
  return !!(feedId && prefs.feedSettings[feedId]?.autoExtract);
}
