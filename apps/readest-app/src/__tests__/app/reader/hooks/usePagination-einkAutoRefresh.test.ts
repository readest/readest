import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { FoliateView } from '@/types/view';
import type { ViewSettings } from '@/types/book';

// Only the native bridge boundary is mocked, so we can observe whether the
// e-ink automatic full-refresh counter fires on schedule. The capability probe
// is stubbed as `null` (unknown / still pending) by default so the counter
// proceeds; a test overrides it to `false` to exercise the short-circuit.
const h = vi.hoisted(() => ({
  refreshEinkScreen: vi.fn(() => Promise.resolve({ success: true })),
  getCachedEinkRefreshSupported: vi.fn(() => null as boolean | null),
}));

vi.mock('@/utils/bridge', () => ({
  interceptKeys: vi.fn(),
  getScreenBrightness: vi.fn(),
  setScreenBrightness: vi.fn(),
  refreshEinkScreen: () => h.refreshEinkScreen(),
  getCachedEinkRefreshSupported: () => h.getCachedEinkRefreshSupported(),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: Object.assign(() => ({}), { getState: () => ({}) }),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getBookData: () => ({}) }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: Object.assign(() => ({}), { getState: () => ({}) }),
}));
vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: Object.assign(() => ({}), { getState: () => ({}) }),
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { isMobileApp: true, isAndroidApp: true } }),
}));

import { viewPagination } from '@/app/reader/hooks/usePagination';

// A minimal paginated (non-scrolled) view: `viewPagination` only reaches
// `view.next/prev` on a page turn, which is exactly what the counter tracks.
// next/prev resolve immediately so the deferred refresh (scheduled on the
// navigation promise) fires once the test flushes the microtask queue.
// `atEnd`/`atStart` stay on the fake renderer to prove the counter no longer
// uses them to skip turns (fixed-layout books report them on most turns).
const makeView = (opts: { atEnd?: boolean; atStart?: boolean } = {}) => ({
  renderer: { scrolled: false, atEnd: !!opts.atEnd, atStart: !!opts.atStart },
  next: vi.fn(() => Promise.resolve()),
  prev: vi.fn(() => Promise.resolve()),
});

// Awaiting the last navigation promise (then one more tick) runs the
// `navigation.then(refresh)` continuation, so refreshEinkScreen has fired by
// the time turnPages resolves.
const turnPages = async (view: unknown, viewSettings: ViewSettings, times: number) => {
  let navigation: unknown;
  for (let i = 0; i < times; i++) {
    navigation = viewPagination(view as FoliateView, viewSettings, 'down', 'page');
  }
  await navigation;
  await Promise.resolve();
};

beforeEach(() => {
  h.refreshEinkScreen.mockClear();
  h.getCachedEinkRefreshSupported.mockClear();
  h.getCachedEinkRefreshSupported.mockImplementation(() => null);
});

describe('usePagination e-ink auto full refresh', () => {
  test('does not refresh when the interval is off (0)', async () => {
    const view = makeView();
    const viewSettings = { isEink: true, einkAutoRefreshInterval: 0 } as ViewSettings;
    await turnPages(view, viewSettings, 5);
    expect(h.refreshEinkScreen).not.toHaveBeenCalled();
  });

  test('refreshes once every N page turns and keeps cycling', async () => {
    const view = makeView();
    const viewSettings = { isEink: true, einkAutoRefreshInterval: 3 } as ViewSettings;
    await turnPages(view, viewSettings, 3);
    expect(h.refreshEinkScreen).toHaveBeenCalledTimes(1);
    await turnPages(view, viewSettings, 2);
    expect(h.refreshEinkScreen).toHaveBeenCalledTimes(1);
    await turnPages(view, viewSettings, 1);
    expect(h.refreshEinkScreen).toHaveBeenCalledTimes(2);
  });

  test('does not refresh outside e-ink mode', async () => {
    const view = makeView();
    const viewSettings = { isEink: false, einkAutoRefreshInterval: 2 } as ViewSettings;
    await turnPages(view, viewSettings, 4);
    expect(h.refreshEinkScreen).not.toHaveBeenCalled();
  });

  test('counters are scoped per view', async () => {
    const viewSettings = { isEink: true, einkAutoRefreshInterval: 2 } as ViewSettings;
    const viewA = makeView();
    await turnPages(viewA, viewSettings, 1);
    const viewB = makeView();
    await turnPages(viewB, viewSettings, 1);
    expect(h.refreshEinkScreen).not.toHaveBeenCalled();
    await turnPages(viewB, viewSettings, 1);
    expect(h.refreshEinkScreen).toHaveBeenCalledTimes(1);
  });

  test('a turn flagged atEnd still counts (no boundary skip)', async () => {
    // On fixed-layout / one-page-per-section content renderer.atEnd is true on
    // nearly every real turn; honoring it would starve the counter, so we count
    // the turn and accept that a true no-op refreshes with nothing changed.
    const view = makeView({ atEnd: true });
    const viewSettings = { isEink: true, einkAutoRefreshInterval: 2 } as ViewSettings;
    await turnPages(view, viewSettings, 2);
    expect(h.refreshEinkScreen).toHaveBeenCalledTimes(1);
  });

  test('stops refreshing once the device is known unsupported', async () => {
    h.getCachedEinkRefreshSupported.mockReturnValue(false);
    const view = makeView();
    const viewSettings = { isEink: true, einkAutoRefreshInterval: 2 } as ViewSettings;
    await turnPages(view, viewSettings, 4);
    expect(h.refreshEinkScreen).not.toHaveBeenCalled();
  });

  test('a single transient refresh failure does not disable the feature', async () => {
    // { success:false } is also returned for momentary conditions on a fully
    // supported device, so the very next scheduled turn must still refresh.
    h.refreshEinkScreen.mockImplementationOnce(() => Promise.resolve({ success: false }));
    const view = makeView();
    const viewSettings = { isEink: true, einkAutoRefreshInterval: 1 } as ViewSettings;
    await turnPages(view, viewSettings, 3);
    expect(h.refreshEinkScreen).toHaveBeenCalledTimes(3);
  });

  test('defers the refresh until the navigation promise settles', async () => {
    // The native hook deep-refreshes the panel's current surface, so firing it
    // before view.next() commits would flash the outgoing page. The refresh must
    // run only after the turn resolves. Use a manually-resolved navigation to
    // observe the ordering explicitly.
    let resolveNext: () => void = () => {};
    const view = {
      renderer: { scrolled: false },
      next: vi.fn(() => new Promise<void>((r) => (resolveNext = r))),
      prev: vi.fn(() => Promise.resolve()),
    };
    const viewSettings = { isEink: true, einkAutoRefreshInterval: 1 } as ViewSettings;

    viewPagination(view as unknown as FoliateView, viewSettings, 'down', 'page');
    await Promise.resolve();
    expect(h.refreshEinkScreen).not.toHaveBeenCalled();

    resolveNext();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.refreshEinkScreen).toHaveBeenCalledTimes(1);
  });
});
