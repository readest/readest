import { describe, expect, test, vi } from 'vitest';
import {
  runDesktopDeepLinkOAuth,
  type DesktopDeepLinkDeps,
} from '@/services/sync/providers/gdrive/auth/oauthDesktop';

const CLIENT_ID = 'cid.apps.googleusercontent.com';
const REDIRECT = 'com.googleusercontent.apps.cid:/oauthredirect';

const tokenJson = (): Response =>
  new Response(JSON.stringify({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const exchangeFetch = () => vi.fn(async () => tokenJson());

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const baseDeps = (over: Partial<DesktopDeepLinkDeps>): DesktopDeepLinkDeps => ({
  openDefaultBrowser: vi.fn(async () => {}),
  spawnFreshBrowser: vi.fn(async () => {}),
  subscribeRedirects: vi.fn(async () => () => {}),
  fallbackDelayMs: 25_000,
  connectDeadlineMs: 900_000,
  ...over,
});

// These tests use real (tiny) timeouts rather than fake timers: the PKCE
// challenge runs on `crypto.subtle.digest`, which resolves on Node's threadpool
// and is therefore not flushed by fake timers.
describe('runDesktopDeepLinkOAuth', () => {
  test('opens the default browser, captures the routed redirect, and exchanges the code', async () => {
    let onUrl!: (url: string) => void;
    const deps = baseDeps({
      subscribeRedirects: vi.fn(async (cb) => {
        onUrl = cb;
        return () => {};
      }),
      // Simulate the OS routing the redirect back once consent opens, echoing
      // the exact `state` the flow generated (read off the consent URL).
      openDefaultBrowser: vi.fn(async (url) => {
        const state = new URL(url).searchParams.get('state');
        queueMicrotask(() => onUrl(`${REDIRECT}?code=CODE&state=${state}`));
      }),
    });
    const fetchFn = exchangeFetch();

    const tokens = await runDesktopDeepLinkOAuth(
      { clientId: CLIENT_ID, scope: 'drive.file' },
      fetchFn,
      deps,
    );

    expect(deps.openDefaultBrowser).toHaveBeenCalledTimes(1);
    expect(tokens.accessToken).toBe('AT');
    expect(tokens.refreshToken).toBe('RT');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    // The redirect arrived in time, so the cold-browser fallback never fired.
    expect(deps.spawnFreshBrowser).not.toHaveBeenCalled();
  });

  test('fires the cold-browser fallback with the consent URL, then rejects at the deadline', async () => {
    const spawnFreshBrowser = vi.fn(async (_url: string) => {});
    const deps = baseDeps({
      subscribeRedirects: vi.fn(async () => () => {}),
      spawnFreshBrowser,
      fallbackDelayMs: 10,
      connectDeadlineMs: 50,
    });
    const result = runDesktopDeepLinkOAuth(
      { clientId: CLIENT_ID, scope: 'drive.file' },
      exchangeFetch(),
      deps,
    ).catch((e: Error) => e.message);

    await delay(90);
    expect(spawnFreshBrowser).toHaveBeenCalledTimes(1);
    expect(spawnFreshBrowser.mock.calls[0]![0]).toContain('accounts.google.com');
    expect(await result).toMatch(/did not complete in time/);
  });

  test('rejects when no redirect arrives before the hard deadline', async () => {
    const deps = baseDeps({
      subscribeRedirects: vi.fn(async () => () => {}),
      fallbackDelayMs: 1_000_000,
      connectDeadlineMs: 20,
    });
    await expect(
      runDesktopDeepLinkOAuth({ clientId: CLIENT_ID, scope: 'drive.file' }, exchangeFetch(), deps),
    ).rejects.toThrow(/did not complete in time/);
  });
});
