import { describe, expect, test } from 'vitest';

import {
  NEARBY_PAIRING_REQUIRES_PREMIUM,
  isNearbyPairingAllowed,
  isNearbyPairingInPlan,
} from '@/utils/access';

describe('isNearbyPairingInPlan', () => {
  test('every plan includes Nearby BookDrop device pairing', () => {
    expect(isNearbyPairingInPlan('free', false)).toBe(true);
    expect(isNearbyPairingInPlan('plus', false)).toBe(true);
    expect(isNearbyPairingInPlan('pro', false)).toBe(true);
    expect(isNearbyPairingInPlan('purchase', false)).toBe(true);
  });
});

describe('isNearbyPairingAllowed (premium paywall removed)', () => {
  test('pairing for confirmation-free drops is available to every plan', () => {
    expect(NEARBY_PAIRING_REQUIRES_PREMIUM).toBe(false);
    expect(isNearbyPairingAllowed('free', false)).toBe(true);
    expect(isNearbyPairingAllowed('plus', false)).toBe(true);
    expect(isNearbyPairingAllowed('pro', false)).toBe(true);
    expect(isNearbyPairingAllowed('purchase', false)).toBe(true);
  });

  test('the customization unlock is irrelevant once the paywall is off', () => {
    expect(isNearbyPairingAllowed('free', true)).toBe(true);
    expect(isNearbyPairingAllowed('purchase', true)).toBe(true);
  });
});
