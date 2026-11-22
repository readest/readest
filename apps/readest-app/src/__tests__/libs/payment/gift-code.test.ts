// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { generateGiftCode, normalizeGiftCode, formatGiftCode } from '@/libs/payment/gift/code';

describe('gift code', () => {
  it('generates 16 Crockford base32 characters, unique across 1000', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const code = generateGiftCode();
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/);
      codes.add(code);
    }
    expect(codes.size).toBe(1000);
  });

  it('normalizes case, separators and look-alike letters', () => {
    expect(normalizeGiftCode(' abcd-efgh ijkl-mnoo ')).toBe('ABCDEFGH1JK1MN00');
  });

  it('formats in groups of four', () => {
    expect(formatGiftCode('ABCDEFGHJKMNPQRS')).toBe('ABCD-EFGH-JKMN-PQRS');
  });
});
