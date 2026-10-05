import { describe, expect, test } from 'vitest';

import {
  ABS_OFFLINE_REQUIRES_PREMIUM,
  isAbsOfflineAllowed,
  isAbsOfflineInPlan,
} from '@/utils/access';

describe('isAbsOfflineInPlan', () => {
  test('every plan includes offline Audiobookshelf downloads', () => {
    expect(isAbsOfflineInPlan('free', false)).toBe(true);
    expect(isAbsOfflineInPlan('plus', false)).toBe(true);
    expect(isAbsOfflineInPlan('pro', false)).toBe(true);
    expect(isAbsOfflineInPlan('purchase', false)).toBe(true);
  });
});

describe('isAbsOfflineAllowed (premium paywall removed)', () => {
  test('offline Audiobookshelf downloads are available to every plan', () => {
    expect(ABS_OFFLINE_REQUIRES_PREMIUM).toBe(false);
    expect(isAbsOfflineAllowed('free', false)).toBe(true);
    expect(isAbsOfflineAllowed('plus', false)).toBe(true);
    expect(isAbsOfflineAllowed('pro', false)).toBe(true);
    expect(isAbsOfflineAllowed('purchase', false)).toBe(true);
  });

  test('the customization unlock is irrelevant once the paywall is off', () => {
    expect(isAbsOfflineAllowed('free', true)).toBe(true);
    expect(isAbsOfflineAllowed('purchase', true)).toBe(true);
  });
});
