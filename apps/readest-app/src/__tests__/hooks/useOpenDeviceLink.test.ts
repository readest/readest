import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

// A CrossPoint reader's sign-in link opens in the app (Universal Link / App
// Link, or readest://link from the web page) and lands on the app's /link
// page, where the account the app is signed in to approves the code.

let currentWindowLabel = 'main';
let coldStartUrls: string[] = [];
const routerPushMock = vi.fn();

vi.mock('@tauri-apps/plugin-deep-link', () => ({
  getCurrent: async () => coldStartUrls,
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: currentWindowLabel }),
}));
vi.mock('@/services/environment', async (orig) => {
  const actual = await orig<typeof import('@/services/environment')>();
  return { ...actual, isTauriAppPlatform: () => true };
});
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: {} }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: routerPushMock }) }));

import '@/hooks/useOpenDeviceLink';

// The cold-start guard is module state, so each case loads a fresh module
// registry, and with it a fresh eventDispatcher to dispatch on.
const loadHook = async () => {
  vi.resetModules();
  const { useOpenDeviceLink } = await import('@/hooks/useOpenDeviceLink');
  const { eventDispatcher } = await import('@/utils/event');
  return { useOpenDeviceLink, eventDispatcher };
};

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  currentWindowLabel = 'main';
  coldStartUrls = [];
  routerPushMock.mockClear();
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('useOpenDeviceLink', () => {
  it('opens the /link page for a link delivered while the app runs', async () => {
    const { useOpenDeviceLink, eventDispatcher } = await loadHook();
    renderHook(() => useOpenDeviceLink());
    await flush();
    await eventDispatcher.dispatch('app-incoming-url', {
      urls: ['https://web.readest.com/link?code=RQGF-WDCF'],
    });
    expect(routerPushMock).toHaveBeenCalledWith('/link?code=RQGF-WDCF');
  });

  it('opens the /link page for the link that launched the app', async () => {
    coldStartUrls = ['readest://link?code=RQGF-WDCF'];
    const { useOpenDeviceLink } = await loadHook();
    renderHook(() => useOpenDeviceLink());
    await flush();
    expect(routerPushMock).toHaveBeenCalledWith('/link?code=RQGF-WDCF');
  });

  it('leaves the launch link to the main window', async () => {
    coldStartUrls = ['readest://link?code=RQGF-WDCF'];
    currentWindowLabel = 'reader-1';
    const { useOpenDeviceLink } = await loadHook();
    renderHook(() => useOpenDeviceLink());
    await flush();
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it('ignores other links', async () => {
    const { useOpenDeviceLink, eventDispatcher } = await loadHook();
    renderHook(() => useOpenDeviceLink());
    await flush();
    await eventDispatcher.dispatch('app-incoming-url', {
      urls: ['https://web.readest.com/s/abc123', 'readest://book/abc123'],
    });
    expect(routerPushMock).not.toHaveBeenCalled();
  });
});
