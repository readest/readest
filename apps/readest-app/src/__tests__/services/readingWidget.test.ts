import { beforeEach, describe, it, expect, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import type { ReadingWidgetInstance } from '@/utils/bridge';

const mocks = vi.hoisted(() => ({ library: [] as Book[], isEink: false, referencePageCount: 0 }));

vi.mock('@/utils/bridge', () => ({
  updateReadingWidget: vi.fn().mockResolvedValue({ failed: 0 }),
  getReadingWidgetInstances: vi.fn().mockResolvedValue({ instances: [] }),
}));
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: { getState: () => ({ library: mocks.library }) },
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ settings: { globalViewSettings: { isEink: mocks.isEink } } }),
  },
}));
vi.mock('@/services/statistics/statisticsDb', () => ({
  StatisticsDb: {
    open: vi.fn().mockResolvedValue({
      getBookByMd5: vi.fn().mockResolvedValue(null),
      getMedianPageDurationSecs: vi.fn().mockResolvedValue(null),
    }),
  },
}));

import { refreshReadingWidget } from '@/services/widget/readingWidget';
import type { TranslationFunc } from '@/hooks/useTranslation';

const mk = (over: Partial<Book>): Book =>
  ({ hash: 'h', title: 'T', author: 'A', format: 'EPUB', updatedAt: 0, ...over }) as Book;

const _: TranslationFunc = (key, options) =>
  key.replace(/{{(\w+)}}/g, (_match, name) => String(options?.[name] ?? ''));

describe('refreshReadingWidget', () => {
  // A fresh id range per test, so the module's last-published cache never carries over.
  let base = 0;
  beforeEach(() => {
    base += 10;
    mocks.library = [];
    mocks.isEink = false;
    mocks.referencePageCount = 0;
  });

  const androidAppService = {
    isMobileApp: true,
    isAndroidApp: true,
    resolveFilePath: vi.fn().mockResolvedValue('/data/Books'),
    loadBookConfig: vi.fn(async () => ({
      viewSettings: { referencePageCount: mocks.referencePageCount },
    })),
  } as unknown as AppService;
  const emptyTitle = 'Nothing being read right now';

  const instance = (
    n: number,
    over: Partial<ReadingWidgetInstance> = {},
  ): ReadingWidgetInstance => ({
    appWidgetId: base + n,
    showTimeLeft: true,
    showPageCount: true,
    showPagesRemaining: true,
    showHeader: true,
    showPercent: true,
    referencePages: false,
    ...over,
  });

  const bridge = async () => {
    const { updateReadingWidget, getReadingWidgetInstances } = await import('@/utils/bridge');
    vi.mocked(updateReadingWidget).mockClear();
    vi.mocked(getReadingWidgetInstances).mockClear();
    return { updateReadingWidget, getReadingWidgetInstances };
  };

  it('is a no-op on a non-Android platform, without reading instances', async () => {
    const { updateReadingWidget, getReadingWidgetInstances } = await bridge();
    await refreshReadingWidget({ ...androidAppService, isAndroidApp: false } as AppService, _);
    expect(getReadingWidgetInstances).not.toHaveBeenCalled();
    expect(updateReadingWidget).not.toHaveBeenCalled();
  });

  it('publishes an empty-state request per instance when nothing is currently reading', async () => {
    const { updateReadingWidget, getReadingWidgetInstances } = await bridge();
    mocks.library = [mk({ hash: 'a', readingStatus: 'finished' })];
    vi.mocked(getReadingWidgetInstances).mockResolvedValueOnce({
      instances: [instance(1)],
    });
    await refreshReadingWidget(androidAppService, _);
    expect(updateReadingWidget).toHaveBeenCalledWith(
      expect.objectContaining({ appWidgetId: base + 1, hash: '', emptyTitle }),
    );
  });

  it.each([true, false])('passes E-Ink mode (%s) to the widget', async (isEink) => {
    const { updateReadingWidget, getReadingWidgetInstances } = await bridge();
    mocks.isEink = isEink;
    vi.mocked(getReadingWidgetInstances).mockResolvedValueOnce({ instances: [instance(1)] });
    await refreshReadingWidget(androidAppService, _);
    expect(updateReadingWidget).toHaveBeenCalledWith(expect.objectContaining({ isEink }));
  });

  it.each([
    true,
    false,
  ])('includes the percent stat only when showPercent is %s', async (showPercent) => {
    const { updateReadingWidget, getReadingWidgetInstances } = await bridge();
    mocks.library = [mk({ hash: 'a', readingStatus: 'reading', progress: [42, 100] })];
    vi.mocked(getReadingWidgetInstances).mockResolvedValueOnce({
      instances: [instance(1, { showPercent })],
    });
    await refreshReadingWidget(androidAppService, _);
    const { stats } = vi.mocked(updateReadingWidget).mock.lastCall![0];
    expect(stats.includes('42% Read')).toBe(showPercent);
  });

  it.each([
    [500, '250 / 500'], // the book's saved count maps the fraction onto print pages
    [0, '50 / 100'], // no saved count: falls back to the page number
  ])('shows reference pages with a saved count of %i', async (referencePageCount, pageStat) => {
    const { updateReadingWidget, getReadingWidgetInstances } = await bridge();
    mocks.referencePageCount = referencePageCount;
    mocks.library = [mk({ hash: 'a', readingStatus: 'reading', progress: [50, 100] })];
    vi.mocked(getReadingWidgetInstances).mockResolvedValueOnce({
      instances: [instance(1, { referencePages: true })],
    });
    await refreshReadingWidget(androidAppService, _);
    expect(vi.mocked(updateReadingWidget).mock.lastCall![0].stats).toContain(pageStat);
  });

  it('omits the page stats for an audiobook, whose progress is in seconds', async () => {
    const { updateReadingWidget, getReadingWidgetInstances } = await bridge();
    mocks.library = [
      mk({
        hash: 'a',
        format: 'OPDSAUDIO',
        readingStatus: 'reading',
        progress: [1200, 25000],
        duration: 25000,
      }),
    ];
    vi.mocked(getReadingWidgetInstances).mockResolvedValueOnce({
      instances: [
        instance(1, { showTimeLeft: true, showPagesRemaining: true, showPageCount: true }),
      ],
    });
    await refreshReadingWidget(androidAppService, _);
    const { stats } = vi.mocked(updateReadingWidget).mock.lastCall![0];

    expect(stats.some((stat) => stat.includes('pages left') || stat.includes(' / '))).toBe(false);
    expect(stats.some((stat) => stat.endsWith('left'))).toBe(true);
  });

  it('still publishes when the reference page count cannot be loaded', async () => {
    const { updateReadingWidget, getReadingWidgetInstances } = await bridge();
    mocks.library = [mk({ hash: 'a', readingStatus: 'reading', progress: [50, 100] })];
    vi.mocked(getReadingWidgetInstances).mockResolvedValueOnce({
      instances: [instance(1, { referencePages: true })],
    });
    vi.mocked(androidAppService.loadBookConfig).mockRejectedValueOnce(new Error('disk error'));
    await expect(refreshReadingWidget(androidAppService, _)).resolves.toBeUndefined();
    expect(vi.mocked(updateReadingWidget).mock.lastCall![0].stats).toContain('50 / 100');
  });

  it('never shows NaN reference pages for a book with a zero page total', async () => {
    const { updateReadingWidget, getReadingWidgetInstances } = await bridge();
    mocks.referencePageCount = 500;
    mocks.library = [mk({ hash: 'a', readingStatus: 'reading', progress: [0, 0] })];
    vi.mocked(getReadingWidgetInstances).mockResolvedValueOnce({
      instances: [instance(1, { referencePages: true })],
    });
    await refreshReadingWidget(androidAppService, _);
    expect(vi.mocked(updateReadingWidget).mock.lastCall![0].stats.join()).not.toContain('NaN');
  });

  it('selects the most-recently-updated currently-reading book', async () => {
    const { updateReadingWidget, getReadingWidgetInstances } = await bridge();
    mocks.library = [
      mk({ hash: 'a', readingStatus: 'reading', progress: [1, 10], updatedAt: 2 }),
      mk({ hash: 'b', readingStatus: 'reading', progress: [1, 10], updatedAt: 5 }),
    ];
    vi.mocked(getReadingWidgetInstances).mockResolvedValueOnce({
      instances: [instance(1)],
    });
    await refreshReadingWidget(androidAppService, _);
    expect(updateReadingWidget).toHaveBeenCalledWith(expect.objectContaining({ hash: 'b' }));
  });

  it('each toggle independently controls whether its field is populated, and percent always reads "X% Read"', async () => {
    const { updateReadingWidget, getReadingWidgetInstances } = await bridge();
    mocks.library = [mk({ hash: 'a', readingStatus: 'reading', progress: [1, 10], updatedAt: 1 })];
    vi.mocked(getReadingWidgetInstances).mockResolvedValueOnce({
      instances: [
        instance(1, {
          showTimeLeft: true,
          showPageCount: false,
          showPagesRemaining: false,
          showHeader: false,
        }),
        instance(2, {
          showTimeLeft: false,
          showPageCount: true,
          showPagesRemaining: false,
          showHeader: true,
        }),
      ],
    });
    await refreshReadingWidget(androidAppService, _);
    const req = (id: number) =>
      vi.mocked(updateReadingWidget).mock.calls.find(([r]) => r.appWidgetId === id)![0];

    // Percent, then time left; no page count.
    expect(req(base + 1).stats).toHaveLength(2);
    expect(req(base + 1).stats[0]).toBe('10% Read');
    expect(req(base + 1).headerText).toBe('');

    // Percent, then page count; no time left.
    expect(req(base + 2).stats).toEqual(['10% Read', '1 / 10']);
    expect(req(base + 2).headerText).not.toBe('');
  });

  it('combines time and pages remaining into one stat when both toggles are on', async () => {
    const { updateReadingWidget, getReadingWidgetInstances } = await bridge();
    mocks.library = [mk({ hash: 'a', readingStatus: 'reading', progress: [1, 10], updatedAt: 1 })];
    vi.mocked(getReadingWidgetInstances).mockResolvedValueOnce({
      instances: [instance(1, { showTimeLeft: true, showPagesRemaining: true })],
    });
    await refreshReadingWidget(androidAppService, _);
    const req = vi.mocked(updateReadingWidget).mock.lastCall![0];

    expect(req.stats.filter((stat) => stat.includes('pages left'))).toHaveLength(1);
    expect(req.stats[1]).toContain('and 9 pages left');
  });

  it('includes tts only when the playing book matches the selected book', async () => {
    const { updateReadingWidget, getReadingWidgetInstances } = await bridge();
    mocks.library = [mk({ hash: 'a', readingStatus: 'reading', progress: [1, 10], updatedAt: 1 })];

    vi.mocked(getReadingWidgetInstances).mockResolvedValueOnce({
      instances: [instance(1)],
    });
    await refreshReadingWidget(androidAppService, _, {
      active: true,
      playing: true,
      bookHash: 'other',
    });
    expect(vi.mocked(updateReadingWidget).mock.lastCall![0].tts).toBeUndefined();

    vi.mocked(getReadingWidgetInstances).mockResolvedValueOnce({
      instances: [instance(1)],
    });
    await refreshReadingWidget(androidAppService, _, {
      active: true,
      playing: true,
      bookHash: 'a',
    });
    expect(vi.mocked(updateReadingWidget).mock.lastCall![0].tts).toEqual({
      active: true,
      playing: true,
    });
  });

  it('skips a redundant push when the snapshot is unchanged, and republishes when it changes', async () => {
    const { updateReadingWidget, getReadingWidgetInstances } = await bridge();
    mocks.library = [mk({ hash: 'a', readingStatus: 'reading', progress: [1, 10], updatedAt: 1 })];
    const refreshWith = async () => {
      vi.mocked(getReadingWidgetInstances).mockResolvedValueOnce({
        instances: [instance(1)],
      });
      await refreshReadingWidget(androidAppService, _);
    };

    await refreshWith();
    expect(updateReadingWidget).toHaveBeenCalledTimes(1);

    await refreshWith();
    expect(updateReadingWidget).toHaveBeenCalledTimes(1);

    mocks.library = [mk({ hash: 'a', readingStatus: 'reading', progress: [5, 10], updatedAt: 1 })];
    await refreshWith();
    expect(updateReadingWidget).toHaveBeenCalledTimes(2);
  });
});
