import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  installChromeMock,
  uninstallChromeMock,
  type ChromeMock,
} from '../__test-utils__/chromeMock';
import { clearToken, readToken, writeToken } from './auth';

let chromeMock: ChromeMock;

beforeEach(() => {
  chromeMock = installChromeMock();
});

afterEach(() => {
  uninstallChromeMock();
});

describe('readToken / writeToken / clearToken', () => {
  test('returns null when nothing is stored', async () => {
    const token = await readToken();
    expect(token).toBeNull();
  });

  test('round-trips a token with the captured timestamp', async () => {
    const before = Date.now();
    await writeToken('abc123');
    const after = Date.now();
    const stored = await readToken();
    expect(stored?.token).toBe('abc123');
    expect(stored?.capturedAt).toBeGreaterThanOrEqual(before);
    expect(stored?.capturedAt).toBeLessThanOrEqual(after);
  });

  test('clearToken wipes both keys', async () => {
    await writeToken('xyz');
    expect((await readToken())?.token).toBe('xyz');
    await clearToken();
    expect(await readToken()).toBeNull();
    expect(chromeMock.storage.local.remove).toHaveBeenCalledWith([
      'readestAccessToken',
      'readestTokenAt',
    ]);
  });

  test('treats a non-string stored value as missing', async () => {
    await chromeMock.storage.local.set({ readestAccessToken: 12345 });
    expect(await readToken()).toBeNull();
  });

  test('treats an empty-string stored value as missing', async () => {
    await chromeMock.storage.local.set({ readestAccessToken: '' });
    expect(await readToken()).toBeNull();
  });

  test('coerces a non-numeric capturedAt to 0', async () => {
    await chromeMock.storage.local.set({
      readestAccessToken: 'tok',
      readestTokenAt: 'not-a-number',
    });
    const stored = await readToken();
    expect(stored?.token).toBe('tok');
    expect(stored?.capturedAt).toBe(0);
  });

  test('writeToken sets capturedAt to Date.now()', async () => {
    const fixedNow = 1_700_000_000_000;
    const spy = vi.spyOn(Date, 'now').mockReturnValue(fixedNow);
    try {
      await writeToken('frozen');
      const stored = await readToken();
      expect(stored?.capturedAt).toBe(fixedNow);
    } finally {
      spy.mockRestore();
    }
  });
});
