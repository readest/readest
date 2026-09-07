import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// #6104: the launch URL keeps coming back after the app has acted on it —
// getCurrent() holds it for the whole process, Android re-emits the sticky
// activity intent whenever it recreates the Activity, and iOS reloads the
// document when WebKit recycles the WebContent process. The consume-once marker
// has to survive a document reload but expire on a genuine relaunch, or opening
// the same bookmark twice in a row would silently do nothing the second time.

const loadModule = async (runId?: string) => {
  vi.resetModules();
  if (runId === undefined) {
    delete window.__READEST_APP_RUN_ID__;
  } else {
    window.__READEST_APP_RUN_ID__ = runId;
  }
  return import('@/utils/deeplinkConsume');
};

const URL_A = 'readest://book/hashA';
const URL_B = 'readest://book/hashB';

describe('consumeLaunchUrl', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => {
    delete window.__READEST_APP_RUN_ID__;
    vi.restoreAllMocks();
  });

  it('claims a launch URL once per app run', async () => {
    const { consumeLaunchUrl } = await loadModule('run-1');

    expect(consumeLaunchUrl('book', URL_A)).toBe(true);
    expect(consumeLaunchUrl('book', URL_A)).toBe(false);
  });

  it('survives a document reload within the same app run', async () => {
    const first = await loadModule('run-1');
    expect(first.consumeLaunchUrl('book', URL_A)).toBe(true);

    // A reload re-executes every module but keeps localStorage and the run id.
    const reloaded = await loadModule('run-1');
    expect(reloaded.consumeLaunchUrl('book', URL_A)).toBe(false);
  });

  it('claims the same URL again after a real relaunch', async () => {
    const first = await loadModule('run-1');
    expect(first.consumeLaunchUrl('book', URL_A)).toBe(true);

    // New process, new run id — the user tapping the same bookmark must work.
    const relaunched = await loadModule('run-2');
    expect(relaunched.consumeLaunchUrl('book', URL_A)).toBe(true);
  });

  it('keeps one key per scope instead of leaking one per run', async () => {
    for (const run of ['run-1', 'run-2', 'run-3']) {
      const { consumeLaunchUrl } = await loadModule(run);
      consumeLaunchUrl('book', URL_A);
    }

    expect(localStorage.length).toBe(1);
  });

  it('tracks scopes independently', async () => {
    const { consumeLaunchUrl } = await loadModule('run-1');

    expect(consumeLaunchUrl('book', URL_A)).toBe(true);
    expect(consumeLaunchUrl('annotation', URL_A)).toBe(true);
  });

  it('does not confuse a different URL for a consumed one', async () => {
    const { consumeLaunchUrl } = await loadModule('run-1');

    expect(consumeLaunchUrl('book', URL_A)).toBe(true);
    expect(consumeLaunchUrl('book', URL_B)).toBe(true);
  });

  it('falls back to sessionStorage when no run id was injected', async () => {
    const { consumeLaunchUrl } = await loadModule(undefined);

    expect(consumeLaunchUrl('book', URL_A)).toBe(true);
    expect(consumeLaunchUrl('book', URL_A)).toBe(false);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(1);
  });
});

describe('isLaunchReplayWindow', () => {
  afterEach(() => {
    delete window.__READEST_APP_RUN_ID__;
    vi.restoreAllMocks();
  });

  it('treats a delivery right after document load as a launch replay', async () => {
    const { isLaunchReplayWindow } = await loadModule('run-1');

    expect(isLaunchReplayWindow()).toBe(true);
  });

  it('treats a delivery long after document load as a real user action', async () => {
    const start = Date.now();
    const now = vi.spyOn(Date, 'now').mockReturnValue(start);
    const { isLaunchReplayWindow } = await loadModule('run-1');

    now.mockReturnValue(start + 11_000);

    expect(isLaunchReplayWindow()).toBe(false);
  });
});
