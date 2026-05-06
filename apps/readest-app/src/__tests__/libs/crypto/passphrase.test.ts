import { describe, expect, test } from 'vitest';
import { EphemeralPassphraseStore, TauriPassphraseStore } from '@/libs/crypto/passphrase';

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

describe('TauriPassphraseStore (stub until plugin lands)', () => {
  test('stub: set throws NOT_IMPLEMENTED for v1', async () => {
    const store = new TauriPassphraseStore();
    await expect(store.set('x')).rejects.toThrow(/Tauri keychain backend not yet wired/);
  });

  test('stub: isAvailable returns false', () => {
    const store = new TauriPassphraseStore();
    expect(store.isAvailable()).toBe(false);
  });
});
