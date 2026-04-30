import { describe, it, expect } from 'vitest';
import { isLanAddress } from '@/utils/network';

/**
 * Tests for SSRF protection in the kosync proxy.
 * The proxy must reject requests to private/internal addresses.
 * See: https://github.com/readest/readest/security/code-scanning/14
 */
describe('isLanAddress – SSRF edge cases for proxy', () => {
  // 0.0.0.0 routes to localhost on many systems
  it('returns true for 0.0.0.0', () => {
    expect(isLanAddress('http://0.0.0.0')).toBe(true);
    expect(isLanAddress('http://0.0.0.0:8080')).toBe(true);
  });

  // Cloud metadata endpoint (169.254.x.x is already covered, but test the exact AWS one)
  it('returns true for cloud metadata IP 169.254.169.254', () => {
    expect(isLanAddress('http://169.254.169.254')).toBe(true);
    expect(isLanAddress('http://169.254.169.254/latest/meta-data/')).toBe(true);
  });

  // IPv6 loopback with brackets (URL standard format)
  it('returns true for bracket-wrapped IPv6 loopback [::1]', () => {
    expect(isLanAddress('http://[::1]')).toBe(true);
    expect(isLanAddress('http://[::1]:8080')).toBe(true);
  });

  // IPv6 link-local with brackets
  it('returns true for bracket-wrapped IPv6 link-local [fe80::1]', () => {
    expect(isLanAddress('http://[fe80::1]')).toBe(true);
  });

  // IPv6 unique local with brackets
  it('returns true for bracket-wrapped IPv6 unique local [fc00::1] and [fd00::1]', () => {
    expect(isLanAddress('http://[fc00::1]')).toBe(true);
    expect(isLanAddress('http://[fd00::abc]')).toBe(true);
  });

  // Public addresses should still return false
  it('returns false for public addresses', () => {
    expect(isLanAddress('https://sync.koreader.rocks')).toBe(false);
    expect(isLanAddress('https://8.8.8.8')).toBe(false);
    expect(isLanAddress('http://[2001:db8::1]')).toBe(false);
  });
});
