import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

const h = vi.hoisted(() => {
  const makeStore = <T,>(state: T) => {
    const fn = <R,>(selector?: (s: T) => R) => (selector ? selector(state) : state) as R | T;
    (fn as unknown as { getState: () => T }).getState = () => state;
    return fn as { (): T; <R>(selector: (s: T) => R): R; getState: () => T };
  };
  type Session = { refreshToken: string; apiToken: string };
  return {
    makeStore,
    store: {
      settings: {
        pagebound: {
          enabled: true,
          email: '',
          refreshToken: 'refresh',
          apiToken: 'api',
          lastSyncedAt: 0,
          autoSync: false,
        },
      },
      setSettings: vi.fn(),
      saveSettings: vi.fn(async () => {}),
    },
    config: { progress: [5, 100] as [number, number], pagebound: undefined as unknown },
    pushProgress: vi.fn(),
    onSessionChange: null as ((session: Session) => Promise<void> | void) | null,
    listeners: new Map<string, Set<(e: CustomEvent) => void>>(),
  };
});

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/store/settingsStore', () => ({ useSettingsStore: h.makeStore(h.store) }));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: h.makeStore({
    getConfig: () => h.config,
    getBookData: () => ({ book: { hash: 'h1' } }),
    setConfig: vi.fn(),
    saveConfig: vi.fn(async () => {}),
  }),
}));
vi.mock('@/store/readerProgressStore', () => ({ useBookProgress: () => null }));
vi.mock('@/services/pagebound', () => ({
  PageboundClient: class {
    constructor(_session: unknown, onSessionChange: typeof h.onSessionChange) {
      h.onSessionChange = onSessionChange;
    }
    pushProgress() {
      return h.pushProgress();
    }
  },
}));
vi.mock('@/utils/event', () => ({
  eventDispatcher: {
    on: (name: string, fn: (e: CustomEvent) => void) => {
      const set = h.listeners.get(name) ?? new Set();
      set.add(fn);
      h.listeners.set(name, set);
    },
    off: (name: string, fn: (e: CustomEvent) => void) => h.listeners.get(name)?.delete(fn),
    dispatch: () => {},
  },
}));

import { usePageboundSync } from '@/app/reader/hooks/usePageboundSync';

const pushManually = () =>
  h.listeners
    .get('pagebound-push-progress')
    ?.forEach((fn) => fn(new CustomEvent('pagebound-push-progress', { detail: { bookKey: 'b' } })));

const LINK = { bookId: 1, uuid: 'u', title: 'T' };

beforeEach(() => {
  h.pushProgress.mockReset();
  h.store.saveSettings.mockClear();
  h.store.settings.pagebound = {
    ...h.store.settings.pagebound,
    enabled: true,
    refreshToken: 'refresh',
  };
});
afterEach(() => cleanup());

test('a push requested while one is in flight does not reach Pagebound again', async () => {
  let finish!: (link: typeof LINK) => void;
  h.pushProgress.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
  renderHook(() => usePageboundSync('b'));

  pushManually();
  pushManually();
  await act(async () => finish(LINK));
  expect(h.pushProgress).toHaveBeenCalledTimes(1);

  h.pushProgress.mockResolvedValue(LINK);
  await act(async () => pushManually());
  expect(h.pushProgress).toHaveBeenCalledTimes(2);
});

test('a session renewed after the account changed is not saved over it', async () => {
  h.pushProgress.mockResolvedValue(LINK);
  renderHook(() => usePageboundSync('b'));
  await act(async () => pushManually());

  // The user disconnected (or signed in again) while the renewal was running.
  h.store.settings.pagebound = { ...h.store.settings.pagebound, enabled: false, refreshToken: '' };
  h.store.saveSettings.mockClear();
  await act(async () => h.onSessionChange!({ refreshToken: 'stale', apiToken: 'stale' }));

  expect(h.store.saveSettings).not.toHaveBeenCalled();
});
