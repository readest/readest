import { describe, expect, test } from 'vitest';
import {
  PIN_LENGTH,
  PIN_SALT_BYTES,
  generatePinSalt,
  hashPin,
  isValidPin,
  verifyPin,
} from '@/libs/crypto/applock';

const HEX_RE = /^[0-9a-f]+$/;

describe('app-lock PIN crypto', () => {
  test('generatePinSalt returns hex of expected length', () => {
    const salt = generatePinSalt();
    expect(salt).toMatch(HEX_RE);
    expect(salt.length).toBe(PIN_SALT_BYTES * 2);
  });

  test('generatePinSalt returns a fresh salt each call', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) seen.add(generatePinSalt());
    expect(seen.size).toBe(20);
  });

  test('hashPin is deterministic for the same pin and salt', async () => {
    const salt = generatePinSalt();
    const a = await hashPin('1234', salt);
    const b = await hashPin('1234', salt);
    expect(a).toBe(b);
  });

  test('hashPin output is hex of fixed length (32 bytes / 64 chars)', async () => {
    const hash = await hashPin('0000', generatePinSalt());
    expect(hash).toMatch(HEX_RE);
    expect(hash.length).toBe(64);
  });

  test('hashPin produces different output for different pins', async () => {
    const salt = generatePinSalt();
    const a = await hashPin('1234', salt);
    const b = await hashPin('1235', salt);
    expect(a).not.toBe(b);
  });

  test('hashPin produces different output for different salts', async () => {
    const a = await hashPin('1234', generatePinSalt());
    const b = await hashPin('1234', generatePinSalt());
    expect(a).not.toBe(b);
  });

  test('verifyPin accepts the correct pin', async () => {
    const salt = generatePinSalt();
    const hash = await hashPin('4242', salt);
    expect(await verifyPin('4242', salt, hash)).toBe(true);
  });

  test('verifyPin rejects an incorrect pin', async () => {
    const salt = generatePinSalt();
    const hash = await hashPin('4242', salt);
    expect(await verifyPin('4243', salt, hash)).toBe(false);
  });

  test('verifyPin rejects a hash that was generated with a different salt', async () => {
    const saltA = generatePinSalt();
    const saltB = generatePinSalt();
    const hash = await hashPin('1234', saltA);
    expect(await verifyPin('1234', saltB, hash)).toBe(false);
  });

  test('isValidPin enforces 4 ASCII digits', () => {
    expect(isValidPin('1234')).toBe(true);
    expect(isValidPin('0000')).toBe(true);
    expect(isValidPin('123')).toBe(false);
    expect(isValidPin('12345')).toBe(false);
    expect(isValidPin('12a4')).toBe(false);
    expect(isValidPin('')).toBe(false);
    expect(isValidPin(' 1234')).toBe(false);
    expect(isValidPin(`${PIN_LENGTH}`.padStart(PIN_LENGTH + 1, '0'))).toBe(false);
  });
});
