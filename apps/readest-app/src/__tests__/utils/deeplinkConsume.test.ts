import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// #6104: the launch URL keeps coming back after the app has acted on it —
// getCurrent() re-reports it to every fresh document for the whole process
// (Android re-reads the sticky activity intent on Activity recreation, iOS
// reloads the document when WebKit recycles the WebContent process). The
// consume-once marker has to survive a document reload but expire on a genuine
// relaunch, or opening the same bookmark twice in a row would silently do
// nothing the second time.

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

describe('markLaunchUrl', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => {
    delete window.__READEST_APP_RUN_ID__;
  });

  it('reports a launch URL as new once per app run', async () => {
    const { markLaunchUrl } = await loadModule('run-1');

    expect(markLaunchUrl('book', URL_A)).toBe(true);
    expect(markLaunchUrl('book', URL_A)).toBe(false);
  });

  it('survives a document reload within the same app run', async () => {
    const first = await loadModule('run-1');
    expect(first.markLaunchUrl('book', URL_A)).toBe(true);

    // A reload re-executes every module but keeps localStorage and the run id.
    const reloaded = await loadModule('run-1');
    expect(reloaded.markLaunchUrl('book', URL_A)).toBe(false);
  });

  it('reports the same URL as new again after a real relaunch', async () => {
    const first = await loadModule('run-1');
    expect(first.markLaunchUrl('book', URL_A)).toBe(true);

    // New process, new run id — the user tapping the same bookmark must work.
    const relaunched = await loadModule('run-2');
    expect(relaunched.markLaunchUrl('book', URL_A)).toBe(true);
  });

  it('remembers every URL of the run, so a later link cannot unmask the launch one', async () => {
    // getCurrent() replays the LAUNCH URL, not the last one acted on. With a
    // single last-seen stamp, acting on B in between would have let the
    // replayed A through (CodeRabbit on #6111).
    const { markLaunchUrl } = await loadModule('run-1');

    expect(markLaunchUrl('book', URL_A)).toBe(true);
    expect(markLaunchUrl('book', URL_B)).toBe(true);
    expect(markLaunchUrl('book', URL_A)).toBe(false);
    expect(markLaunchUrl('book', URL_B)).toBe(false);
  });

  it('keeps one key per scope instead of leaking one per run', async () => {
    for (const run of ['run-1', 'run-2', 'run-3']) {
      const { markLaunchUrl } = await loadModule(run);
      markLaunchUrl('book', URL_A);
    }

    expect(localStorage.length).toBe(1);
  });

  it('bounds the per-scope set', async () => {
    const { markLaunchUrl } = await loadModule('run-1');
    for (let i = 0; i < 40; i++) markLaunchUrl('book', `readest://book/h${i}`);

    const stored = JSON.parse(localStorage.getItem('book')!) as { urls: string[] };
    expect(stored.urls).toHaveLength(16);
    // Oldest entries fall off first; the newest are the ones a replay could hit.
    expect(stored.urls[0]).toBe('readest://book/h24');
    expect(markLaunchUrl('book', 'readest://book/h39')).toBe(false);
  });

  it('tracks scopes independently', async () => {
    const { markLaunchUrl } = await loadModule('run-1');

    expect(markLaunchUrl('book', URL_A)).toBe(true);
    expect(markLaunchUrl('annotation', URL_A)).toBe(true);
  });

  it('treats an unreadable marker as absent', async () => {
    const { markLaunchUrl } = await loadModule('run-1');
    localStorage.setItem('book', 'not json');

    expect(markLaunchUrl('book', URL_A)).toBe(true);
    expect(markLaunchUrl('book', URL_A)).toBe(false);
  });

  it('falls back to sessionStorage when no run id was injected', async () => {
    const { markLaunchUrl } = await loadModule(undefined);

    expect(markLaunchUrl('book', URL_A)).toBe(true);
    expect(markLaunchUrl('book', URL_A)).toBe(false);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(1);
  });
});
