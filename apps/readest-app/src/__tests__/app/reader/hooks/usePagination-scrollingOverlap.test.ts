import { describe, expect, test, vi } from 'vitest';
import type { FoliateView } from '@/types/view';
import type { ViewSettings } from '@/types/book';

vi.mock('@/utils/bridge', () => ({
  interceptKeys: vi.fn(),
  getScreenBrightness: vi.fn(),
  setScreenBrightness: vi.fn(),
  refreshEinkScreen: vi.fn(() => Promise.resolve({ success: true })),
  getCachedEinkRefreshSupported: vi.fn(() => false),
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
  useEnv: () => ({ appService: {} }),
}));

import { viewPagination } from '@/app/reader/hooks/usePagination';

const SIZE = 800;

// A scrolled view with no rendered contents, so the reflowable line snap falls
// back to the raw distance and the test sees exactly what viewPagination asks for.
const makeView = (layout: 'pre-paginated' | 'reflowable') => ({
  book: { rendition: { layout } },
  renderer: { scrolled: true, size: SIZE, getContents: () => [] },
  next: vi.fn(() => Promise.resolve()),
  prev: vi.fn(() => Promise.resolve()),
});

const viewSettings = { scrollingOverlap: 100 } as ViewSettings;

describe('viewPagination scrolling overlap', () => {
  test('fixed layout scrolls a viewport minus the overlap', () => {
    const view = makeView('pre-paginated');
    viewPagination(view as unknown as FoliateView, viewSettings, 'down');
    expect(view.next).toHaveBeenCalledWith(SIZE - 100);
    viewPagination(view as unknown as FoliateView, viewSettings, 'up');
    expect(view.prev).toHaveBeenCalledWith(SIZE - 100);
  });

  test('reflowable ignores the overlap (line snapping keeps the lines whole)', () => {
    const view = makeView('reflowable');
    viewPagination(view as unknown as FoliateView, viewSettings, 'down');
    expect(view.next).toHaveBeenCalledWith(SIZE);
    viewPagination(view as unknown as FoliateView, viewSettings, 'up');
    expect(view.prev).toHaveBeenCalledWith(SIZE);
  });
});
