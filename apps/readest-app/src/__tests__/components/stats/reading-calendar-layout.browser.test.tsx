import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { page } from 'vitest/browser';
import ReadingStatsDialog, {
  setReadingStatsDialogVisible,
} from '@/components/stats/ReadingStatsDialog';
import { toDateKey } from '@/services/statistics/readingStats';
import de from '../../../../public/locales/de/translation.json';
import el from '../../../../public/locales/el/translation.json';
import ka from '../../../../public/locales/ka/translation.json';
import ta from '../../../../public/locales/ta/translation.json';

const translations = vi.hoisted(() => ({ current: {} as Record<string, string> }));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, params?: Record<string, string | number>) =>
    (translations.current[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
      String(params?.[name] ?? ''),
    ),
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
      const startTimeMs = quarter * 900_000;
      const speeds = [
        { unit: 'characters', count: 350, durationMs: 60_000 },
        { unit: 'words', count: 180, durationMs: 60_000 },
      ];
      return {
        getQuarterHourDurations: async () => [{ quarter, seconds: 3600 }],
        getReadingTotals: async () => ({ seconds: 3600, books: 2, pages: 10 }),
        getReadingSpeedTotals: async () => speeds,
        getReadingSpeedSamples: async (startMs: number, endMs: number) =>
          speeds
            .filter(({ durationMs }) => startTimeMs < endMs && startTimeMs + durationMs > startMs)
            .map((speed) => ({ ...speed, startTimeMs })),
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
  translations.current = {};
  for (const attr of ['data-theme', 'data-eink', 'dir'])
    document.documentElement.removeAttribute(attr);
});

/** How many lines `text` takes inside `root`, across however many text nodes. */
const linesOf = (root: Element, text: string) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  const start = nodes
    .map((n) => n.data)
    .join('')
    .indexOf(text);
  if (start < 0) throw new Error(`"${text}" not found`);
  const range = document.createRange();
  let offset = 0;
  for (const node of nodes) {
    const next = offset + node.data.length;
    if (start >= offset && start < next) range.setStart(node, start - offset);
    if (start + text.length > offset && start + text.length <= next)
      range.setEnd(node, start + text.length - offset);
    offset = next;
  }
  return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
};

describe('reading speed rows in the statistics dialog', () => {
  // The longest labels and units shipped: at 360px neither fits beside the
  // other, and the label is clamped to two lines.
  it.each([
    ['de', de],
    ['el', el],
    ['ka', ka],
    ['ta', ta],
  ])('keeps labels whole and each unit on one line at 360px (%s)', async (_lang, strings) => {
    translations.current = strings as Record<string, string>;
    await page.viewport(360, 900);
    render(<ReadingStatsDialog />);
    act(() => setReadingStatsDialogVisible(true));
    for (const key of ['Reading Speed Today', 'Reading Speed']) {
      const label = await screen.findByText(translations.current[key]!);
      const row = label.parentElement!.parentElement!;
      expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth + 1);
      expect(label.scrollHeight).toBeLessThanOrEqual(label.clientHeight + 1);
      expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
      for (const [unit, speed] of [
        ['{{speed}} characters/min', '350'],
        ['{{speed}} words/min', '180'],
      ] as const) {
        expect(linesOf(row, translations.current[unit]!.replace('{{speed}}', speed))).toBe(1);
      }
    }
  });
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
      const status = calendar.querySelector('[role="status"]');
      expect(status?.textContent).toContain('350 characters/min');
      expect(status?.textContent).toContain('180 words/min');
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
