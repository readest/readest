import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseBuddyReadDeepLink } from '@/hooks/useOpenBuddyReadLink';

describe('parseBuddyReadDeepLink', () => {
  it('parses yomi://buddy-read deep links', () => {
    expect(parseBuddyReadDeepLink('yomi://buddy-read?id=42')).toEqual({
      buddyReadId: 42,
      shareToken: null,
    });
    expect(
      parseBuddyReadDeepLink('yomi://buddy-read?id=42&shareToken=abc1234567890123456789'),
    ).toEqual({
      buddyReadId: 42,
      shareToken: 'abc1234567890123456789',
    });
    expect(parseBuddyReadDeepLink('yomi://buddy-read/42')).toEqual({
      buddyReadId: 42,
      shareToken: null,
    });
  });

  it('parses legacy readest://buddy-read deep links', () => {
    expect(parseBuddyReadDeepLink('readest://buddy-read?id=42')).toEqual({
      buddyReadId: 42,
      shareToken: null,
    });
    expect(
      parseBuddyReadDeepLink('readest://buddy-read?id=42&shareToken=abc1234567890123456789'),
    ).toEqual({
      buddyReadId: 42,
      shareToken: 'abc1234567890123456789',
    });
  });

  it('parses web buddy-read URLs', () => {
    expect(
      parseBuddyReadDeepLink('https://biblophile.com/yomi/buddy-read/join?id=42&token=token123'),
    ).toEqual({
      buddyReadId: 42,
      shareToken: 'token123',
    });
  });

  it('rejects invalid or malformed links', () => {
    expect(parseBuddyReadDeepLink('')).toBeNull();
    expect(parseBuddyReadDeepLink('yomi://unknown')).toBeNull();
    expect(parseBuddyReadDeepLink('not-a-url')).toBeNull();
  });
});
