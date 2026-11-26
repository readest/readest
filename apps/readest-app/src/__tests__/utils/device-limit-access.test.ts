// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDeviceLimit } from '@/utils/access';

const jwt = (claims: Record<string, unknown>) =>
  `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getDeviceLimit', () => {
  it('limits the Free plan to three devices', () => {
    expect(getDeviceLimit(jwt({ plan: 'free' }))).toBe(3);
    expect(getDeviceLimit(jwt({}))).toBe(3);
  });

  it.each([
    ['Plus', { plan: 'plus' }],
    ['Pro', { plan: 'pro' }],
    ['a storage purchase', { plan: 'free', storage_purchased_bytes: 1024 }],
    ['the Full Customization unlock', { plan: 'free', customization_purchased: true }],
  ])('has no limit with %s', (_name, claims) => {
    expect(getDeviceLimit(jwt(claims))).toBeNull();
  });

  it('has no limit on a self-hosted deployment', () => {
    vi.stubEnv('SELF_HOSTED', 'true');
    expect(getDeviceLimit(jwt({ plan: 'free' }))).toBeNull();
  });
});
