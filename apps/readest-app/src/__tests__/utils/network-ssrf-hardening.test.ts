import { describe, expect, it } from 'vitest';
import { isBlockedHost, isLanAddress } from '@/utils/network';

// Regression coverage for the secondary finding in GHSA-5g3f-mq2c-j65v:
// the old `isLanAddress` only blocked the literal `127.0.0.1` / `0.0.0.0` and
// missed whole ranges + internal hostname suffixes, so the unauthenticated
// `/api/kosync` proxy could still reach e.g. `http://127.0.0.2:6379/`.
// `isLanAddress` now delegates to the canonical `isBlockedHost`.
describe('isLanAddress — hardened ranges (previously bypassable)', () => {
  it('blocks the full 127.0.0.0/8 loopback range, not just 127.0.0.1', () => {
    expect(isLanAddress('http://127.0.0.2:6379/')).toBe(true);
    expect(isLanAddress('http://127.1.2.3/')).toBe(true);
  });

  it('blocks the full 0.0.0.0/8 range', () => {
    expect(isLanAddress('http://0.1.2.3/')).toBe(true);
  });

  it('blocks 198.18.0.0/15 benchmarking and 224.0.0.0/4 multicast/reserved', () => {
    expect(isLanAddress('http://198.18.0.1/')).toBe(true);
    expect(isLanAddress('http://198.19.255.255/')).toBe(true);
    expect(isLanAddress('http://225.0.0.1/')).toBe(true);
    expect(isLanAddress('http://240.0.0.1/')).toBe(true);
  });

  it('blocks internal hostname suffixes and bare single-label hosts', () => {
    expect(isLanAddress('http://metadata/')).toBe(true);
    expect(isLanAddress('http://db.internal/')).toBe(true);
    expect(isLanAddress('http://box.lan/')).toBe(true);
    expect(isLanAddress('http://host.localhost/')).toBe(true);
  });

  it('blocks IPv4-mapped / hex-mapped IPv6 pointing at private space', () => {
    expect(isLanAddress('http://[::ffff:127.0.0.1]/')).toBe(true);
    expect(isLanAddress('http://[::ffff:7f00:1]/')).toBe(true);
  });

  it('still allows ordinary public catalogs', () => {
    expect(isLanAddress('https://sync.koreader.rocks')).toBe(false);
    expect(isLanAddress('https://8.8.8.8')).toBe(false);
    expect(isLanAddress('https://opds.example.com/feed')).toBe(false);
  });

  it('treats invalid URLs / octets as non-LAN (URL parse rejects them)', () => {
    expect(isLanAddress('http://10.256.0.1')).toBe(false);
    expect(isLanAddress('not-a-url')).toBe(false);
    expect(isLanAddress('')).toBe(false);
  });
});

describe('isBlockedHost is exported from the canonical network helper', () => {
  it('matches the SSRF blocklist used by the proxies', () => {
    expect(isBlockedHost('169.254.169.254')).toBe(true);
    expect(isBlockedHost('127.0.0.2')).toBe(true);
    expect(isBlockedHost('example.com')).toBe(false);
  });
});
