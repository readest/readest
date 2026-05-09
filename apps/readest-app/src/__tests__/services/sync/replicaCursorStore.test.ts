import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createSettingsCursorStore } from '@/services/sync/replicaCursorStore';
import type { AppService } from '@/types/system';
import type { Hlc } from '@/types/replica';
import type { SystemSettings } from '@/types/settings';

const makeFakeAppService = (initial: Partial<SystemSettings> = {}) => {
  let settings = { ...initial } as SystemSettings;
  return {
    loadSettings: vi.fn(async () => settings),
    saveSettings: vi.fn(async (s: SystemSettings) => {
      settings = { ...s };
    }),
    getSettings: () => settings,
  };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('createSettingsCursorStore', () => {
  test('hydrates cache from settings.lastSyncedAtReplicas on init', async () => {
    const fake = makeFakeAppService({
      lastSyncedAtReplicas: { dictionary: 'cur-dict', font: 'cur-font' },
    });
    const store = createSettingsCursorStore(fake as unknown as AppService);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.get('dictionary')).toBe('cur-dict');
    expect(store.get('font')).toBe('cur-font');
  });

  test('get returns null when cursor not in settings', async () => {
    const fake = makeFakeAppService();
    const store = createSettingsCursorStore(fake as unknown as AppService);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.get('dictionary')).toBe(null);
  });

  test('set updates the cache synchronously', () => {
    const fake = makeFakeAppService();
    const store = createSettingsCursorStore(fake as unknown as AppService);
    store.set('dictionary', 'cur-1' as Hlc);
    expect(store.get('dictionary')).toBe('cur-1');
  });

  test('set debounces a save flush; no save fires immediately', () => {
    const fake = makeFakeAppService({ replicaDeviceId: 'dev-a' });
    const store = createSettingsCursorStore(fake as unknown as AppService, { debounceMs: 1000 });
    store.set('dictionary', 'cur-1' as Hlc);
    expect(fake.saveSettings).not.toHaveBeenCalled();
  });

  test('save fires after debounceMs', async () => {
    const fake = makeFakeAppService({ replicaDeviceId: 'dev-a' });
    const store = createSettingsCursorStore(fake as unknown as AppService, { debounceMs: 1000 });
    store.set('dictionary', 'cur-1' as Hlc);
    await vi.advanceTimersByTimeAsync(999);
    expect(fake.saveSettings).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(fake.saveSettings).toHaveBeenCalledOnce();
    const saved = fake.saveSettings.mock.calls[0]![0];
    expect(saved.lastSyncedAtReplicas).toEqual({ dictionary: 'cur-1' });
  });

  test('successive sets within debounce window collapse to one save', async () => {
    const fake = makeFakeAppService();
    const store = createSettingsCursorStore(fake as unknown as AppService, { debounceMs: 1000 });
    store.set('dictionary', 'a' as Hlc);
    await vi.advanceTimersByTimeAsync(500);
    store.set('dictionary', 'b' as Hlc);
    await vi.advanceTimersByTimeAsync(500);
    store.set('dictionary', 'c' as Hlc);
    await vi.advanceTimersByTimeAsync(1100);
    expect(fake.saveSettings).toHaveBeenCalledOnce();
    expect(fake.saveSettings.mock.calls[0]![0].lastSyncedAtReplicas).toEqual({ dictionary: 'c' });
  });

  test('save preserves other settings fields (load-merge-save round-trip)', async () => {
    const fake = makeFakeAppService({
      replicaDeviceId: 'dev-a',
      keepLogin: true,
    } as Partial<SystemSettings>);
    const store = createSettingsCursorStore(fake as unknown as AppService, { debounceMs: 100 });
    await vi.advanceTimersByTimeAsync(0);
    store.set('dictionary', 'cur' as Hlc);
    await vi.advanceTimersByTimeAsync(110);
    const saved = fake.saveSettings.mock.calls[0]![0];
    expect(saved.replicaDeviceId).toBe('dev-a');
    expect(saved.keepLogin).toBe(true);
    expect(saved.lastSyncedAtReplicas).toEqual({ dictionary: 'cur' });
  });

  test('save preserves cursors for other kinds', async () => {
    const fake = makeFakeAppService({
      lastSyncedAtReplicas: { font: 'cur-font' },
    });
    const store = createSettingsCursorStore(fake as unknown as AppService, { debounceMs: 100 });
    await vi.advanceTimersByTimeAsync(0);
    store.set('dictionary', 'cur-dict' as Hlc);
    await vi.advanceTimersByTimeAsync(110);
    const saved = fake.saveSettings.mock.calls[0]![0];
    expect(saved.lastSyncedAtReplicas).toEqual({ font: 'cur-font', dictionary: 'cur-dict' });
  });

  test('save error does not throw to caller (best-effort)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fake = makeFakeAppService();
    fake.saveSettings.mockRejectedValueOnce(new Error('disk full'));
    const store = createSettingsCursorStore(fake as unknown as AppService, { debounceMs: 100 });
    await vi.advanceTimersByTimeAsync(0);
    expect(() => store.set('dictionary', 'cur' as Hlc)).not.toThrow();
    await vi.advanceTimersByTimeAsync(110);
    await Promise.resolve();
  });

  test('hydrate failure does not break subsequent get/set', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fake = makeFakeAppService();
    fake.loadSettings.mockRejectedValueOnce(new Error('parse error'));
    const store = createSettingsCursorStore(fake as unknown as AppService);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.get('dictionary')).toBe(null);
    store.set('dictionary', 'cur' as Hlc);
    expect(store.get('dictionary')).toBe('cur');
  });
});
