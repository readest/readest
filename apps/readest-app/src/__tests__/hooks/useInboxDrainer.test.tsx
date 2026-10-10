import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { AppService } from '@/types/system';
import type { EnvConfigType } from '@/services/environment';

const appService = {} as AppService;
const envConfig = {} as EnvConfigType;
const user = { id: 'u1' };

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService, envConfig }),
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user }),
}));
vi.mock('@/services/environment', () => ({
  getAPIBaseUrl: () => 'https://api.test/api',
  isTauriAppPlatform: () => true,
}));
vi.mock('@/utils/fetch', () => ({ fetchWithAuth: vi.fn() }));
vi.mock('@/services/ingestService', () => ({ ingestFile: vi.fn() }));
vi.mock('@/services/send/conversion/conversionWorker', () => ({
  convertToEpubWithWorker: vi.fn(),
  convertFileIfNeeded: vi.fn(),
}));
vi.mock('@/services/send/devicePrefs', () => ({ isInboxDrainEnabled: () => true }));
vi.mock('@/services/send/inboxDrainer', () => ({
  DEFAULT_MAX_ITEMS_PER_PASS: 5,
  drainInbox: vi.fn(async () => ({ processed: 0, failed: 0 })),
}));

import { drainInbox } from '@/services/send/inboxDrainer';
import { useInboxDrainer } from '@/hooks/useInboxDrainer';

const mockedDrain = vi.mocked(drainInbox);

const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const setVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
};

// The throttle outlives the hook (it must survive remounts), so each test
// starts an hour after the previous one to clear it.
let clock = Date.UTC(2026, 0, 1);

beforeEach(() => {
  vi.useFakeTimers();
  clock += 60 * 60_000;
  vi.setSystemTime(clock);
  setVisibility('visible');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useInboxDrainer', () => {
  test('drains on mount, then polls every 5 minutes instead of every minute', async () => {
    renderHook(() => useInboxDrainer());
    await advance(0);
    expect(mockedDrain).toHaveBeenCalledTimes(1);

    await advance(4 * 60_000);
    expect(mockedDrain).toHaveBeenCalledTimes(1);

    await advance(60_000);
    expect(mockedDrain).toHaveBeenCalledTimes(2);
  });

  test('skips the periodic poll while the window is hidden', async () => {
    renderHook(() => useInboxDrainer());
    await advance(0);
    setVisibility('hidden');

    await advance(15 * 60_000);
    expect(mockedDrain).toHaveBeenCalledTimes(1);
  });

  test('drains on foreground return, at most once a minute', async () => {
    renderHook(() => useInboxDrainer());
    await advance(0);
    expect(mockedDrain).toHaveBeenCalledTimes(1);

    await advance(59_000);
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    await advance(0);
    expect(mockedDrain).toHaveBeenCalledTimes(1);

    await advance(1_000);
    document.dispatchEvent(new Event('visibilitychange'));
    await advance(0);
    expect(mockedDrain).toHaveBeenCalledTimes(2);
  });

  test('keeps the throttle across remounts', async () => {
    const first = renderHook(() => useInboxDrainer());
    await advance(0);
    first.unmount();

    const second = renderHook(() => useInboxDrainer());
    await advance(0);
    expect(mockedDrain).toHaveBeenCalledTimes(1);
    second.unmount();

    await advance(60_000);
    renderHook(() => useInboxDrainer());
    await advance(0);
    expect(mockedDrain).toHaveBeenCalledTimes(2);
  });
});
