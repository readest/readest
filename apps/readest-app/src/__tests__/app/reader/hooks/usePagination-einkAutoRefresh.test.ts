import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { FoliateView } from '@/types/view';
import type { ViewSettings } from '@/types/book';

// Only the native bridge boundary is mocked, so we can observe whether the
// e-ink automatic full-refresh counter fires on schedule.
const h = vi.hoisted(() => ({
  refreshEinkScreen: vi.fn(() => Promise.resolve({ success: true })),
}));

vi.mock('@/utils/bridge', () => ({
  interceptKeys: vi.fn(),
  getScreenBrightness: vi.fn(),
  setScreenBrightness: vi.fn(),
  refreshEinkScreen: () => h.refreshEinkScreen(),
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
const makeView = () => ({ renderer: { scrolled: false }, next: vi.fn(), prev: vi.fn() });

const turnPages = (view: unknown, viewSettings: ViewSettings, times: number) => {
  for (let i = 0; i < times; i++) {
    viewPagination(view as FoliateView, viewSettings, 'down', 'page');
  }
};

beforeEach(() => {
  h.refreshEinkScreen.mockClear();
});

describe('usePagination e-ink auto full refresh', () => {
  test('does not refresh when the interval is off (0)', () => {
    const view = makeView();
    const viewSettings = { isEink: true, einkAutoRefreshInterval: 0 } as ViewSettings;
    turnPages(view, viewSettings, 5);
    expect(h.refreshEinkScreen).not.toHaveBeenCalled();
  });

  test('refreshes once every N page turns and keeps cycling', () => {
    const view = makeView();
    const viewSettings = { isEink: true, einkAutoRefreshInterval: 3 } as ViewSettings;
    turnPages(view, viewSettings, 3);
    expect(h.refreshEinkScreen).toHaveBeenCalledTimes(1);
    turnPages(view, viewSettings, 2);
    expect(h.refreshEinkScreen).toHaveBeenCalledTimes(1);
    turnPages(view, viewSettings, 1);
    expect(h.refreshEinkScreen).toHaveBeenCalledTimes(2);
  });

  test('does not refresh outside e-ink mode', () => {
    const view = makeView();
    const viewSettings = { isEink: false, einkAutoRefreshInterval: 2 } as ViewSettings;
    turnPages(view, viewSettings, 4);
    expect(h.refreshEinkScreen).not.toHaveBeenCalled();
  });

  test('counters are scoped per view', () => {
    const viewSettings = { isEink: true, einkAutoRefreshInterval: 2 } as ViewSettings;
    const viewA = makeView();
    turnPages(viewA, viewSettings, 1);
    const viewB = makeView();
    turnPages(viewB, viewSettings, 1);
    expect(h.refreshEinkScreen).not.toHaveBeenCalled();
    turnPages(viewB, viewSettings, 1);
    expect(h.refreshEinkScreen).toHaveBeenCalledTimes(1);
  });
});
