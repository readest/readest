import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { page } from 'vitest/browser';
import ReadingStatsDialog, {
  setReadingStatsDialogVisible,
} from '@/components/stats/ReadingStatsDialog';
import { toDateKey } from '@/services/statistics/readingStats';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, params?: Record<string, string | number>) =>
    key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params?.[name] ?? '')),
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { hasSafeAreaInset: true }, envConfig: {} }),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useDefaultBookshelfCovers', () => ({
  useDefaultBookshelfCovers: () => ({ hideCovers: false }),
}));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({
    systemUIVisible: false,
    statusBarHeight: 0,
    safeAreaInsets: { top: 47, right: 0, bottom: 34, left: 0 },
  }),
}));
vi.mock('@/store/deviceStore', () => ({
  useDeviceControlStore: () => ({
    acquireBackKeyInterception: vi.fn(),
    releaseBackKeyInterception: vi.fn(),
  }),
}));
vi.mock('@tauri-apps/plugin-haptics', () => ({ impactFeedback: vi.fn() }));
vi.mock('@/services/statistics/statisticsDb', () => ({
  StatisticsDb: {
    open: async () => {
      const now = new Date();
      const quarter = Math.floor(
        new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).getTime() / 900000,
      );
      return {
        getQuarterHourDurations: async () => [{ quarter, seconds: 3600 }],
        getReadingTotals: async () => ({ seconds: 3600, books: 2, pages: 10 }),
        getBookQuarterHourDurations: async () => [
          {
            quarter,
            bookMd5: 'a',
            title: '人间草木：那些平凡而美好的时刻',
            authors: '汪曾祺',
            seconds: 2400,
          },
          {
            quarter,
            bookMd5: 'b',
            title: 'Averylongtitlethatshouldneverpushthecalendaroutsidethescreen',
            authors: 'Author',
            seconds: 1200,
          },
        ],
      };
    },
  },
}));
await import('@/styles/globals.css');

afterEach(() => {
  cleanup();
  for (const attr of ['data-theme', 'data-eink', 'dir'])
    document.documentElement.removeAttribute(attr);
});

describe('reading calendar in the statistics dialog', () => {
  const openCalendar = async () => {
    render(<ReadingStatsDialog />);
    act(() => setReadingStatsDialogVisible(true));
    fireEvent.click(await screen.findByRole('button', { name: 'Reading Calendar' }));
    await screen.findByRole('button', { name: /人间草木：那些平凡而美好的时刻/ });
    return screen
      .getByRole('group', { name: 'Reading Calendar' })
      .querySelector<HTMLElement>('[aria-busy]')!;
  };

  it.each([
    false,
    true,
  ])('slides both date grids in the correct direction and survives rapid navigation (RTL %s)', async (rtl) => {
    await page.viewport(390, 900);
    document.documentElement.dir = rtl ? 'rtl' : 'ltr';
    const viewport = await openCalendar();
    expect(viewport.getAnimations({ subtree: true })).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Previous Month' }));
    const current = viewport.querySelector<HTMLElement>('[data-calendar-month]')!;
    const animation = current.getAnimations()[0]!;
    expect(animation.effect?.getTiming().duration).toBe(220);
    expect((animation.effect as KeyframeEffect).getKeyframes()[0]?.['transform']).toBe(
      rtl ? 'translateX(100%)' : 'translateX(-100%)',
    );
    animation.pause();
    animation.currentTime = 110;
    expect(getComputedStyle(current).transform).not.toBe('none');
    const snapshot = viewport.querySelector<HTMLElement>('[data-calendar-exit]')!;
    expect(snapshot.getAttribute('aria-hidden')).toBe('true');
    expect(getComputedStyle(snapshot).pointerEvents).toBe('none');
    expect(snapshot.querySelectorAll('button:not([tabindex="-1"])')).toHaveLength(0);
    expect(snapshot.querySelector('[data-calendar-date]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next Month' }));
    const reverse = viewport
      .querySelector<HTMLElement>('[data-calendar-month]')!
      .getAnimations()[0]!;
    expect((reverse.effect as KeyframeEffect).getKeyframes()[0]?.['transform']).toBe(
      rtl ? 'translateX(-100%)' : 'translateX(100%)',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Previous Month' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous Month' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next Month' }));
    expect(viewport.querySelectorAll('[data-calendar-exit]')).toHaveLength(1);
    await Promise.all(viewport.getAnimations({ subtree: true }).map((active) => active.finished));
    await expect.poll(() => viewport.querySelector('[data-calendar-exit]')).toBeNull();
    expect(viewport.getAnimations({ subtree: true })).toHaveLength(0);
  });

  it.each([
    'eink',
    'reduced',
  ])('keeps month changes instant with %s motion settings', async (mode) => {
    await page.viewport(390, 900);
    const nativeMatchMedia = window.matchMedia.bind(window);
    const media =
      mode === 'reduced'
        ? vi
            .spyOn(window, 'matchMedia')
            .mockImplementation((query) =>
              query === '(prefers-reduced-motion: reduce)'
                ? ({ matches: true } as MediaQueryList)
                : nativeMatchMedia(query),
            )
        : null;
    if (mode === 'eink') document.documentElement.dataset['eink'] = 'true';
    try {
      const viewport = await openCalendar();
      fireEvent.click(screen.getByRole('button', { name: 'Previous Month' }));
      expect(viewport.getAnimations({ subtree: true })).toHaveLength(0);
      expect(viewport.querySelector('[data-calendar-exit]')).toBeNull();
    } finally {
      media?.mockRestore();
    }
  });

  it('keeps keyboard focus visible when stepping into the next month', async () => {
    await page.viewport(390, 900);
    const viewport = await openCalendar();
    fireEvent.click(screen.getByRole('button', { name: 'Previous Month' }));
    await Promise.all(
      viewport.getAnimations({ subtree: true }).map((animation) => animation.finished),
    );
    const now = new Date();
    const lastKey = toDateKey(new Date(now.getFullYear(), now.getMonth(), 0));
    const last = viewport.querySelector<HTMLButtonElement>(`[data-calendar-date="${lastKey}"]`)!;
    fireEvent.click(last);
    last.focus();
    fireEvent.keyDown(last, { key: 'ArrowRight' });
    expect(document.activeElement?.getAttribute('data-calendar-date')).toBe(
      toDateKey(new Date(now.getFullYear(), now.getMonth(), 1)),
    );
    expect(viewport.scrollLeft).toBe(0);
  });

  it('keeps the date grid in place when focus enters during a month transition', async () => {
    await page.viewport(390, 900);
    const viewport = await openCalendar();
    fireEvent.click(screen.getByRole('button', { name: 'Previous Month' }));
    await Promise.all(
      viewport.getAnimations({ subtree: true }).map((animation) => animation.finished),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next Month' }));
    for (const animation of viewport.getAnimations({ subtree: true })) {
      animation.pause();
      animation.currentTime = 30;
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const selected = viewport.querySelector<HTMLButtonElement>(
      '[data-calendar-date][aria-pressed="true"]',
    )!;
    selected.focus();
    expect(document.activeElement).toBe(selected);
    expect(viewport.scrollLeft).toBe(0);
  });

  for (const [width, theme, rtl, eink] of [
    [320, 'default-light', false, false],
    [390, 'default-dark', false, false],
    [768, 'default-light', true, false],
    [1100, 'default-dark', false, false],
    [390, 'default-light', false, true],
    [390, 'default-dark', true, true],
  ] as const) {
    it(`fits ${width}px, ${theme}, RTL ${rtl}, e-ink ${eink}`, async () => {
      await page.viewport(width, 900);
      document.documentElement.setAttribute('data-theme', theme);
      document.documentElement.setAttribute('data-eink', String(eink));
      document.documentElement.dir = rtl ? 'rtl' : 'ltr';
      render(<ReadingStatsDialog />);
      act(() => setReadingStatsDialogVisible(true));
      const entry = await screen.findByRole('button', { name: 'Reading Calendar' });
      expect(screen.queryByRole('group', { name: 'Reading Calendar' })).toBeNull();
      fireEvent.click(entry);
      await screen.findByRole('button', { name: /人间草木：那些平凡而美好的时刻/ });
      const calendar = screen.getByRole('group', { name: 'Reading Calendar' });
      const grid = calendar.querySelector<HTMLElement>('[aria-busy]')!;
      expect(getComputedStyle(grid).touchAction).toContain('pan-y');
      expect(getComputedStyle(grid).touchAction).toContain('pinch-zoom');
      const box = calendar.closest('.modal-box') as HTMLElement;
      const rect = calendar.getBoundingClientRect();
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(width);
      expect(calendar.scrollWidth).toBeLessThanOrEqual(calendar.clientWidth + 1);
      expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth + 1);
      const selected = calendar.querySelector<HTMLButtonElement>(
        `[data-calendar-date="${toDateKey(new Date())}"]`,
      )!;
      expect(getComputedStyle(selected).outlineStyle).toBe('solid');
      expect(getComputedStyle(selected).outlineWidth).toBe('1px');
      // E-ink drops the selected fill, so the selected day's number is inverted instead.
      const dayNumber = getComputedStyle(selected.firstElementChild!);
      expect(dayNumber.backgroundColor === 'rgba(0, 0, 0, 0)').toBe(!eink);
      expect(selected.querySelectorAll('.book-cover-container')).toHaveLength(2);
      for (const label of ['Previous Month', 'Next Month', 'Today']) {
        const bounds = screen.getByRole('button', { name: label }).getBoundingClientRect();
        expect(Math.min(bounds.width, bounds.height)).toBeGreaterThanOrEqual(44);
      }
      expect(calendar.querySelector('input[type="date"]')).toBeNull();
      const wheel = new WheelEvent('wheel', { deltaX: -80, bubbles: true, cancelable: true });
      fireEvent(grid, wheel);
      expect(wheel.defaultPrevented).toBe(true);
      const previousMonth = new Date();
      previousMonth.setDate(1);
      previousMonth.setMonth(previousMonth.getMonth() + (rtl ? 0 : -1));
      expect(screen.getByRole('button', { pressed: true }).getAttribute('data-calendar-date')).toBe(
        rtl ? toDateKey(new Date()) : toDateKey(previousMonth),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Today' }));
      fireEvent.click(screen.getByRole('button', { name: 'Previous Month' }));
      const previous = new Date();
      previous.setDate(1);
      previous.setMonth(previous.getMonth() - 1);
      expect(screen.getByRole('button', { pressed: true }).getAttribute('data-calendar-date')).toBe(
        toDateKey(previous),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Next Month' }));
      fireEvent.click(screen.getByRole('button', { name: 'Today' }));
      expect(screen.getByRole('button', { pressed: true }).getAttribute('data-calendar-date')).toBe(
        toDateKey(new Date()),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Reading Statistics' }));
      expect(screen.getByText('All Time')).toBeTruthy();
      expect(screen.queryByRole('group', { name: 'Reading Calendar' })).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reading Calendar' }));
    });
  }
});
