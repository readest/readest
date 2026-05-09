import { describe, it, expect } from 'vitest';
import { buildShareUrl, parseShareDeepLink } from '@/utils/share';

describe('buildShareUrl', () => {
  it('builds the canonical https URL for a token', () => {
    expect(buildShareUrl('aBcDeFgHiJkLmNoPqRsTuV')).toBe(
      'https://web.readest.com/s/aBcDeFgHiJkLmNoPqRsTuV',
    );
  });
});

describe('parseShareDeepLink', () => {
  const VALID_TOKEN = 'aBcDeFgHiJkLmNoPqRsTuV';

  it('parses readest://share/{token}', () => {
    expect(parseShareDeepLink(`readest://share/${VALID_TOKEN}`)).toEqual({ token: VALID_TOKEN });
  });

  it('parses https://web.readest.com/s/{token}', () => {
    expect(parseShareDeepLink(`https://web.readest.com/s/${VALID_TOKEN}`)).toEqual({
      token: VALID_TOKEN,
    });
  });

  it('parses *.readest.com subdomains for preview deploys', () => {
    expect(parseShareDeepLink(`https://staging.readest.com/s/${VALID_TOKEN}`)).toEqual({
      token: VALID_TOKEN,
    });
  });

  it('rejects tokens of the wrong length', () => {
    expect(parseShareDeepLink('readest://share/short')).toBeNull();
    expect(parseShareDeepLink(`readest://share/${VALID_TOKEN}extra`)).toBeNull();
  });

  it('rejects tokens with disallowed characters', () => {
    // Underscore and hyphen are explicitly NOT in the alphabet.
    const bad = 'aBcDeFgHiJkLmNoPqRsTu-';
    expect(parseShareDeepLink(`readest://share/${bad}`)).toBeNull();
  });

  it('rejects URLs from third-party hosts', () => {
    expect(parseShareDeepLink(`https://evil.example.com/s/${VALID_TOKEN}`)).toBeNull();
  });

  it('rejects readest:// URLs whose host is not "share"', () => {
    expect(parseShareDeepLink(`readest://book/${VALID_TOKEN}`)).toBeNull();
    expect(parseShareDeepLink(`readest://annotation/${VALID_TOKEN}`)).toBeNull();
  });

  it('rejects nested or extra path segments', () => {
    expect(parseShareDeepLink(`https://web.readest.com/s/${VALID_TOKEN}/extra`)).toBeNull();
    expect(parseShareDeepLink(`https://web.readest.com/extra/s/${VALID_TOKEN}`)).toBeNull();
  });

  it('returns null for malformed input', () => {
    expect(parseShareDeepLink('')).toBeNull();
    expect(parseShareDeepLink('not-a-url')).toBeNull();
    expect(parseShareDeepLink('ftp://web.readest.com/s/' + VALID_TOKEN)).toBeNull();
  });
});
