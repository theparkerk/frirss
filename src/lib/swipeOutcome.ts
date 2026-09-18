/** What a finished horizontal swipe in the reading pane should do. */
export type SwipeOutcome = 'next' | 'prev' | 'back' | 'none';

export interface SwipeInput {
  /** Final horizontal travel, px (negative = leftwards). */
  dx: number;
  /** Distance that commits a gesture, px. */
  threshold: number;
  hasNext: boolean;
  hasPrev: boolean;
  /** Preference: a right swipe returns to the list instead of the previous article. */
  swipeRightBack: boolean;
}

/**
 * Left past the threshold → next article. Right past the threshold → back to
 * the list when the preference says so (whatever the position in the list),
 * otherwise the previous article. Anything else springs back.
 */
export function swipeOutcome({ dx, threshold, hasNext, hasPrev, swipeRightBack }: SwipeInput): SwipeOutcome {
  if (dx < -threshold) return hasNext ? 'next' : 'none';
  if (dx > threshold) {
    if (swipeRightBack) return 'back';
    return hasPrev ? 'prev' : 'none';
  }
  return 'none';
}
