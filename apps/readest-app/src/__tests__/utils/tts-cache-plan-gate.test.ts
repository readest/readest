import { describe, expect, test } from 'vitest';

import { TTS_CACHE_REQUIRES_PREMIUM, isTTSCacheAllowed, isTTSCacheInPlan } from '@/utils/access';

describe('isTTSCacheInPlan', () => {
  test('every plan includes the offline TTS audio cache', () => {
    expect(isTTSCacheInPlan('free', false)).toBe(true);
    expect(isTTSCacheInPlan('plus', false)).toBe(true);
    expect(isTTSCacheInPlan('pro', false)).toBe(true);
    expect(isTTSCacheInPlan('purchase', false)).toBe(true);
  });
});

describe('isTTSCacheAllowed (premium paywall removed)', () => {
  test('offline TTS audio is available to every plan', () => {
    expect(TTS_CACHE_REQUIRES_PREMIUM).toBe(false);
    expect(isTTSCacheAllowed('free', false)).toBe(true);
    expect(isTTSCacheAllowed('plus', false)).toBe(true);
    expect(isTTSCacheAllowed('pro', false)).toBe(true);
    expect(isTTSCacheAllowed('purchase', false)).toBe(true);
  });

  test('the customization unlock is irrelevant once the paywall is off', () => {
    expect(isTTSCacheAllowed('free', true)).toBe(true);
    expect(isTTSCacheAllowed('purchase', true)).toBe(true);
  });
});
