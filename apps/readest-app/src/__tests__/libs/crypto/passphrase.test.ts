import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const invokeMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

let isTauriAppPlatformValue = false;
vi.mock('@/services/environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/environment')>();
  return {
    ...actual,
    isTauriAppPlatform: () => isTauriAppPlatformValue,
  };
});

import {
  EphemeralPassphraseStore,
  TauriPassphraseStore,
  __resetPassphraseStoreForTests,
  createPassphraseStore,
  upgradeToKeychainIfAvailable,
} from '@/libs/crypto/passphrase';

beforeEach(() => {
  invokeMock.mockReset();
  __resetPassphraseStoreForTests();
  isTauriAppPlatformValue = false;
});

afterEach(() => {
  __resetPassphraseStoreForTests();
});

describe('EphemeralPassphraseStore', () => {
  test('set then get returns the same passphrase', async () => {
    const store = new EphemeralPassphraseStore();
    await store.set('correct horse battery staple');
    expect(await store.get()).toBe('correct horse battery staple');
  });

  test('initial state: get returns null', async () => {
    const store = new EphemeralPassphraseStore();
    expect(await store.get()).toBe(null);
  });

  test('clear empties the store', async () => {
    const store = new EphemeralPassphraseStore();
    await store.set('abc');
    await store.clear();
    expect(await store.get()).toBe(null);
  });

  test('isAvailable returns true (always)', () => {
    const store = new EphemeralPassphraseStore();
    expect(store.isAvailable()).toBe(true);
  });

  test('two instances are independent (per-tab semantic)', async () => {
    const a = new EphemeralPassphraseStore();
    const b = new EphemeralPassphraseStore();
    await a.set('alpha');
    await b.set('beta');
    expect(await a.get()).toBe('alpha');
    expect(await b.get()).toBe('beta');
  });

  test('set replaces previous value', async () => {
    const store = new EphemeralPassphraseStore();
    await store.set('first');
    await store.set('second');
    expect(await store.get()).toBe('second');
  });
});

describe('TauriPassphraseStore', () => {
  test('set delegates to plugin:native-bridge|set_sync_passphrase', async () => {
    invokeMock.mockResolvedValue({ success: true });
    const store = new TauriPassphraseStore();
    await store.set('hunter2');
    expect(invokeMock).toHaveBeenCalledWith('plugin:native-bridge|set_sync_passphrase', {
      payload: { passphrase: 'hunter2' },
    });
  });

  test('set throws CRYPTO_UNAVAILABLE when the bridge reports failure', async () => {
    invokeMock.mockResolvedValue({ success: false, error: 'OSStatus -25300' });
    const store = new TauriPassphraseStore();
    await expect(store.set('hunter2')).rejects.toMatchObject({
      name: 'SyncError',
      code: 'CRYPTO_UNAVAILABLE',
    });
  });

  test('get returns the saved passphrase', async () => {
    invokeMock.mockResolvedValue({ passphrase: 'hunter2' });
    const store = new TauriPassphraseStore();
    expect(await store.get()).toBe('hunter2');
  });

  test('get returns null when keychain has no entry (empty response)', async () => {
    invokeMock.mockResolvedValue({});
    const store = new TauriPassphraseStore();
    expect(await store.get()).toBeNull();
  });

  test('get returns null when bridge reports an error (fail-soft)', async () => {
    invokeMock.mockResolvedValue({ error: 'OSStatus -25291' });
    const store = new TauriPassphraseStore();
    expect(await store.get()).toBeNull();
  });

  test('clear delegates to plugin:native-bridge|clear_sync_passphrase', async () => {
    invokeMock.mockResolvedValue({ success: true });
    const store = new TauriPassphraseStore();
    await store.clear();
    expect(invokeMock).toHaveBeenCalledWith('plugin:native-bridge|clear_sync_passphrase');
  });

  test('isAvailable returns true (true availability is gated by upgrade probe)', () => {
    expect(new TauriPassphraseStore().isAvailable()).toBe(true);
  });
});

describe('createPassphraseStore + upgradeToKeychainIfAvailable', () => {
  test('returns ephemeral on web; upgrade is a no-op (no keychain probe)', async () => {
    isTauriAppPlatformValue = false;
    const store = createPassphraseStore();
    expect(store).toBeInstanceOf(EphemeralPassphraseStore);
    const upgraded = await upgradeToKeychainIfAvailable();
    expect(upgraded).toBe(store);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  test('upgrades to TauriPassphraseStore on Tauri when keychain probe succeeds', async () => {
    isTauriAppPlatformValue = true;
    invokeMock.mockResolvedValue({ available: true });
    expect(createPassphraseStore()).toBeInstanceOf(EphemeralPassphraseStore);
    const upgraded = await upgradeToKeychainIfAvailable();
    expect(upgraded).toBeInstanceOf(TauriPassphraseStore);
    // Subsequent createPassphraseStore returns the upgraded singleton.
    expect(createPassphraseStore()).toBe(upgraded);
  });

  test('falls back to ephemeral when probe reports unavailable', async () => {
    isTauriAppPlatformValue = true;
    invokeMock.mockResolvedValue({ available: false, error: 'sandbox' });
    const initial = createPassphraseStore();
    const upgraded = await upgradeToKeychainIfAvailable();
    expect(upgraded).toBe(initial);
    expect(upgraded).toBeInstanceOf(EphemeralPassphraseStore);
  });

  test('falls back to ephemeral when probe throws', async () => {
    isTauriAppPlatformValue = true;
    invokeMock.mockRejectedValue(new Error('bridge unreachable'));
    const initial = createPassphraseStore();
    const upgraded = await upgradeToKeychainIfAvailable();
    expect(upgraded).toBe(initial);
    expect(upgraded).toBeInstanceOf(EphemeralPassphraseStore);
  });
});
