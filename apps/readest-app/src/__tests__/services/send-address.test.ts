import { describe, test, expect } from 'vitest';
import {
  slugFromIdentity,
  sanitizeSlug,
  isReservedSlug,
  generateAddressToken,
  generateSendAddress,
  buildSendAddress,
  isValidSendAddress,
  normalizeSenderEmail,
  parseSubjectTag,
} from '@/services/send/sendAddress';

describe('slugFromIdentity', () => {
  test('derives a slug from an email local part', () => {
    expect(slugFromIdentity('Jane.Doe@example.com')).toBe('janedoe');
  });

  test('derives a slug from a display name', () => {
    expect(slugFromIdentity('Jane Doe')).toBe('janedoe');
  });

  test('caps the slug length', () => {
    expect(slugFromIdentity('abcdefghijklmnopqrstuvwxyz').length).toBe(12);
  });

  test('falls back to "reader" when nothing usable remains', () => {
    expect(slugFromIdentity('!!!@example.com')).toBe('reader');
  });
});

describe('sanitizeSlug', () => {
  test('lowercases and strips non-alphanumerics', () => {
    expect(sanitizeSlug('Jane.Doe!')).toBe('janedoe');
  });

  test('caps the slug length at 12', () => {
    expect(sanitizeSlug('abcdefghijklmnopqrstuvwxyz').length).toBe(12);
  });

  test('returns empty when nothing usable remains', () => {
    expect(sanitizeSlug('!!! ###')).toBe('');
  });
});

describe('isReservedSlug', () => {
  test('flags role/system slugs', () => {
    expect(isReservedSlug('admin')).toBe(true);
    expect(isReservedSlug('info')).toBe(true);
    expect(isReservedSlug('support')).toBe(true);
  });

  test('allows ordinary slugs', () => {
    expect(isReservedSlug('janedoe')).toBe(false);
  });
});

describe('generateAddressToken', () => {
  test('produces a 5-char Crockford-base32 token', () => {
    const token = generateAddressToken();
    expect(token).toMatch(/^[0-9abcdefghjkmnpqrstvwxyz]{5}$/);
  });

  test('maps random bytes deterministically', () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(generateAddressToken(bytes)).toBe('01234');
  });
});

describe('generateSendAddress / buildSendAddress / isValidSendAddress', () => {
  test('generates a valid {slug}-{token} address from an identity', () => {
    const address = generateSendAddress('reader@example.com');
    expect(isValidSendAddress(address)).toBe(true);
    expect(address.startsWith('reader-')).toBe(true);
  });

  test('builds an address from an explicit slug', () => {
    const address = buildSendAddress('janedoe');
    expect(isValidSendAddress(address)).toBe(true);
    expect(address.startsWith('janedoe-')).toBe(true);
  });

  test('rejects malformed addresses', () => {
    expect(isValidSendAddress('no-token')).toBe(false);
    expect(isValidSendAddress('UPPER-abcde')).toBe(false);
    expect(isValidSendAddress('slug-toolongtoken')).toBe(false);
    expect(isValidSendAddress('slug-ab12')).toBe(false); // 4 chars, too short
  });
});

describe('normalizeSenderEmail', () => {
  test('lowercases and trims', () => {
    expect(normalizeSenderEmail('  Jane@Example.COM ')).toBe('jane@example.com');
  });
});

describe('parseSubjectTag', () => {
  test('extracts the first #tag from a subject', () => {
    expect(parseSubjectTag('My new book #scifi')).toBe('scifi');
  });

  test('returns undefined when no tag is present', () => {
    expect(parseSubjectTag('Just a subject')).toBeUndefined();
    expect(parseSubjectTag('')).toBeUndefined();
    expect(parseSubjectTag(null)).toBeUndefined();
  });

  test('supports unicode tags', () => {
    expect(parseSubjectTag('书 #科幻')).toBe('科幻');
  });
});
