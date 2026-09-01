import { describe, it, expect, vi, afterEach } from 'vitest';
import { jwtDecode } from 'jwt-decode';
import { getCustomizationPurchased, isCustomizationAllowed, isSelfHosted } from '@/utils/access';

vi.mock('jwt-decode', () => ({ jwtDecode: vi.fn() }));

const mockToken = (claims: Record<string, unknown>) => {
  (jwtDecode as unknown as ReturnType<typeof vi.fn>).mockReturnValue(claims);
  return 'token';
};

describe('getCustomizationPurchased', () => {
  it('reads the claim minted by custom_access_token_hook', () => {
    expect(getCustomizationPurchased(mockToken({ customization_purchased: true }))).toBe(true);
  });

  it('is false when the claim is absent, so old tokens do not unlock it', () => {
    expect(getCustomizationPurchased(mockToken({ plan: 'free' }))).toBe(false);
  });
});

describe('isCustomizationAllowed', () => {
  it('allows an explicit purchase on any plan', () => {
    expect(isCustomizationAllowed('free', true)).toBe(true);
  });

  it('allows subscription tiers without a separate purchase', () => {
    expect(isCustomizationAllowed('plus', false)).toBe(true);
    expect(isCustomizationAllowed('pro', false)).toBe(true);
  });

  // `getUserProfilePlan` reports 'purchase' for anyone holding ANY one-time
  // purchase, which is how a storage add-on presents. Treating that as
  // entitlement would hand Full Customization to every storage buyer.
  it('does not treat a storage-only buyer as entitled', () => {
    expect(isCustomizationAllowed('purchase', false)).toBe(false);
  });

  it('denies a free user who has not bought it', () => {
    expect(isCustomizationAllowed('free', false)).toBe(false);
  });
});

// A self-hosted deployment has no store to buy from, and the operator already
// runs the infrastructure the paywall funds, so everything is unlocked.
describe('self-hosted deployments', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is off by default', () => {
    expect(isSelfHosted()).toBe(false);
  });

  it('unlocks premium for a signed-in free user with no purchase', () => {
    vi.stubEnv('SELF_HOSTED', 'true');
    expect(isCustomizationAllowed('free', false)).toBe(true);
  });

  it('unlocks premium with no login at all, where the plan reads free', () => {
    vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', 'true');
    expect(isCustomizationAllowed('free', false)).toBe(true);
  });

  // `??` stops at an empty string, so a blank SELF_HOSTED would mask the
  // public variable and silently re-lock a self-hosted deployment.
  it('falls through an explicitly empty SELF_HOSTED', () => {
    vi.stubEnv('SELF_HOSTED', '');
    vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', 'true');
    expect(isSelfHosted()).toBe(true);
  });
});
