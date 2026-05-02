import { describe, it, expect } from 'vitest';
import { generateShareToken, hashShareToken, isValidShareToken } from '@/libs/share-server';

describe('share-server', () => {
  describe('generateShareToken', () => {
    it('produces a 22-char alphanumeric raw token', async () => {
      const { raw, hash } = await generateShareToken();
      expect(raw).toMatch(/^[A-Za-z0-9]{22}$/);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces unique tokens across calls', async () => {
      const tokens = new Set<string>();
      for (let i = 0; i < 50; i++) {
        const { raw } = await generateShareToken();
        tokens.add(raw);
      }
      expect(tokens.size).toBe(50);
    });

    it('hash is deterministic for the same raw input', async () => {
      const { raw, hash } = await generateShareToken();
      const again = await hashShareToken(raw);
      expect(again).toBe(hash);
    });
  });

  describe('isValidShareToken', () => {
    it('accepts well-formed 22-char alphanumeric tokens', () => {
      expect(isValidShareToken('aBcDeFgHiJkLmNoPqRsTuV')).toBe(true);
      expect(isValidShareToken('0123456789abcdefABCDEF')).toBe(true);
    });

    it('rejects wrong-length tokens', () => {
      expect(isValidShareToken('short')).toBe(false);
      expect(isValidShareToken('aBcDeFgHiJkLmNoPqRsTuVextra')).toBe(false);
      expect(isValidShareToken('')).toBe(false);
    });

    it('rejects tokens with non-alphanumeric characters', () => {
      expect(isValidShareToken('aBcDeFgHiJkLmNoPqRsTu-')).toBe(false);
      expect(isValidShareToken('aBcDeFgHiJkLmNoPqRsTu_')).toBe(false);
      expect(isValidShareToken('aBcDeFgHiJkLmNoPqRsTu.')).toBe(false);
      expect(isValidShareToken('aBcDeFgHiJkLmNoPqRs Tuv')).toBe(false);
    });

    it('rejects non-string input', () => {
      expect(isValidShareToken(undefined)).toBe(false);
      expect(isValidShareToken(null)).toBe(false);
      expect(isValidShareToken(42)).toBe(false);
      expect(isValidShareToken({})).toBe(false);
    });
  });

  describe('hashShareToken', () => {
    it('produces a 64-char lowercase hex SHA-256 digest', async () => {
      const hash = await hashShareToken('aBcDeFgHiJkLmNoPqRsTuV');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('different inputs produce different hashes', async () => {
      const a = await hashShareToken('aBcDeFgHiJkLmNoPqRsTuV');
      const b = await hashShareToken('aBcDeFgHiJkLmNoPqRsTuW');
      expect(a).not.toBe(b);
    });

    it('matches a known SHA-256 vector for sanity', async () => {
      // Known test vector: sha256("abc") = ba7816bf...
      const hash = await hashShareToken('abc');
      expect(hash).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    });
  });
});
