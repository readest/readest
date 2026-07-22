import { describe, expect, test } from 'vitest';

import { TTS_CACHE_REQUIRES_PREMIUM, isTTSCacheAllowed, isTTSCacheInPlan } from '@/utils/access';

describe('isTTSCacheInPlan', () => {
  test('any paid plan can use the offline TTS audio cache', () => {
    expect(isTTSCacheInPlan('plus')).toBe(true);
    expect(isTTSCacheInPlan('pro')).toBe(true);
    expect(isTTSCacheInPlan('purchase')).toBe(true); // lifetime
  });

  test('free plan cannot', () => {
    expect(isTTSCacheInPlan('free')).toBe(false);
  });
});

describe('isTTSCacheAllowed (premium paywall)', () => {
  test('downloading TTS audio for offline playback requires a paid plan', () => {
    expect(TTS_CACHE_REQUIRES_PREMIUM).toBe(true);
    expect(isTTSCacheAllowed('free')).toBe(false);
    expect(isTTSCacheAllowed('plus')).toBe(true);
    expect(isTTSCacheAllowed('pro')).toBe(true);
    expect(isTTSCacheAllowed('purchase')).toBe(true);
  });
});
