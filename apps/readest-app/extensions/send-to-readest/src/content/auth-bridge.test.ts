import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  installChromeMock,
  uninstallChromeMock,
  type ChromeMock,
} from '../__test-utils__/chromeMock';

/**
 * `auth-bridge.ts` is a side-effect content script — its module-load
 * IIFE syncs the token immediately and installs a `storage` event
 * listener. We use `vi.resetModules()` between cases so each `import`
 * re-runs that IIFE against the test's fresh localStorage.
 */

let chromeMock: ChromeMock;
let addEventListenerSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  chromeMock = installChromeMock();
  localStorage.clear();
  addEventListenerSpy = vi.spyOn(window, 'addEventListener');
  vi.resetModules();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  addEventListenerSpy.mockRestore();
  uninstallChromeMock();
  localStorage.clear();
});

describe('auth-bridge — token extraction', () => {
  test('writes a fresh token to chrome.storage when localStorage has a Supabase session', async () => {
    localStorage.setItem(
      'sb-projectref-auth-token',
      JSON.stringify({ access_token: 'abc-token', refresh_token: 'r' }),
    );
    await import('./auth-bridge');

    expect(chromeMock.storage.local.set).toHaveBeenCalledTimes(1);
    const call = chromeMock.storage.local.set.mock.calls[0]![0] as Record<string, unknown>;
    expect(call['readestAccessToken']).toBe('abc-token');
    expect(typeof call['readestTokenAt']).toBe('number');
  });

  test('clears the stored token when no Supabase session is present', async () => {
    // Pre-seed the extension storage so we can confirm clearing.
    await chromeMock.storage.local.set({
      readestAccessToken: 'stale',
      readestTokenAt: 12345,
    });
    chromeMock.storage.local.remove.mockClear();

    await import('./auth-bridge');
    expect(chromeMock.storage.local.remove).toHaveBeenCalledWith([
      'readestAccessToken',
      'readestTokenAt',
    ]);
  });

  test('ignores keys not matching the Supabase auth-token pattern', async () => {
    localStorage.setItem('unrelated-key', JSON.stringify({ access_token: 'nope' }));
    localStorage.setItem('sb-foo-something-else', JSON.stringify({ access_token: 'nope2' }));

    await import('./auth-bridge');
    // No valid sb-...-auth-token entry → should clear, not set.
    expect(chromeMock.storage.local.set).not.toHaveBeenCalled();
    expect(chromeMock.storage.local.remove).toHaveBeenCalled();
  });

  test('tolerates malformed JSON in a matching key', async () => {
    localStorage.setItem('sb-bad-auth-token', '{not valid json');

    await expect(import('./auth-bridge')).resolves.toBeDefined();
    // The malformed entry counts as "no token found" → clear.
    expect(chromeMock.storage.local.remove).toHaveBeenCalled();
  });

  test('skips entries whose access_token is missing or not a string', async () => {
    localStorage.setItem('sb-x-auth-token', JSON.stringify({ access_token: 42 }));
    localStorage.setItem('sb-y-auth-token', JSON.stringify({}));

    await import('./auth-bridge');
    expect(chromeMock.storage.local.set).not.toHaveBeenCalled();
  });

  test('picks any matching key when several exist (first one wins is fine)', async () => {
    localStorage.setItem('sb-alpha-auth-token', JSON.stringify({ access_token: 'alpha-token' }));
    localStorage.setItem('sb-beta-auth-token', JSON.stringify({ access_token: 'beta-token' }));

    await import('./auth-bridge');
    expect(chromeMock.storage.local.set).toHaveBeenCalledTimes(1);
    const stored = (chromeMock.storage.local.set.mock.calls[0]![0] as Record<string, unknown>)[
      'readestAccessToken'
    ];
    expect(['alpha-token', 'beta-token']).toContain(stored);
  });

  test('installs a `storage` event listener for token rotation', async () => {
    await import('./auth-bridge');
    const calls = addEventListenerSpy.mock.calls.filter((c) => c[0] === 'storage');
    expect(calls.length).toBe(1);
  });

  test('polls for same-page token writes that do not fire a storage event', async () => {
    await import('./auth-bridge');
    chromeMock.storage.local.set.mockClear();
    chromeMock.storage.local.remove.mockClear();

    localStorage.setItem(
      'sb-projectref-auth-token',
      JSON.stringify({ access_token: 'same-page-token' }),
    );
    await vi.advanceTimersByTimeAsync(5_000);

    expect(chromeMock.storage.local.set).toHaveBeenCalledTimes(1);
    expect(
      (chromeMock.storage.local.set.mock.calls[0]![0] as Record<string, unknown>)[
        'readestAccessToken'
      ],
    ).toBe('same-page-token');
  });

  test('storage event with a non-sb key is ignored', async () => {
    await import('./auth-bridge');
    chromeMock.storage.local.set.mockClear();
    chromeMock.storage.local.remove.mockClear();

    const handler = addEventListenerSpy.mock.calls.find((c) => c[0] === 'storage')?.[1] as (
      e: StorageEvent,
    ) => void;
    handler(new StorageEvent('storage', { key: 'theme', newValue: 'dark' }));

    expect(chromeMock.storage.local.set).not.toHaveBeenCalled();
    expect(chromeMock.storage.local.remove).not.toHaveBeenCalled();
  });

  test('storage event with a matching key re-syncs the token', async () => {
    await import('./auth-bridge');
    chromeMock.storage.local.set.mockClear();

    localStorage.setItem('sb-rotated-auth-token', JSON.stringify({ access_token: 'new-token' }));
    const handler = addEventListenerSpy.mock.calls.find((c) => c[0] === 'storage')?.[1] as (
      e: StorageEvent,
    ) => void;
    handler(new StorageEvent('storage', { key: 'sb-rotated-auth-token', newValue: 'x' }));

    expect(chromeMock.storage.local.set).toHaveBeenCalledTimes(1);
    expect(
      (chromeMock.storage.local.set.mock.calls[0]![0] as Record<string, unknown>)[
        'readestAccessToken'
      ],
    ).toBe('new-token');
  });
});
