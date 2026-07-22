import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ProgressBar from '@/app/reader/components/ProgressBar';
import { DEFAULT_VIEW_CONFIG } from '@/services/constants';
import type { BookProgress, ViewSettings } from '@/types/book';
import type { TOCItem } from '@/libs/document';

const saveViewSettings = vi.fn();

let currentViewSettings: ViewSettings;
let currentProgress: BookProgress | null;
let currentBookData: {
  isFixedLayout: boolean;
  bookDoc?: { metadata?: Record<string, unknown>; toc?: TOCItem[] };
} | null;
let currentRenderer: { page: number; pages: number };
let currentSectionFractions: number[] = [];
let currentTocHrefIndex: Record<string, number> = {};

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string, values?: Record<string, unknown>) =>
    s
      .replace('{{count}}', String(values?.['count'] ?? '{{count}}'))
      .replace('{{number}}', String(values?.['number'] ?? '{{number}}'))
      .replace('{{time}}', String(values?.['time'] ?? '{{time}}')),
}));

let currentAppService = { isMobile: false, hasSafeAreaInset: false };
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: currentAppService }),
}));

// Production code uses per-field selectors; mock must apply them so each
// `useReaderStore((s) => s.method)` call returns the method, not the whole
// state object.
vi.mock('@/store/readerStore', () => {
  const state = {
    getProgress: () => currentProgress,
    getViewSettings: () => currentViewSettings,
    getView: () => ({
      renderer: currentRenderer,
      getSectionFractions: () => currentSectionFractions,
      resolveNavigation: (href: string) =>
        href in currentTocHrefIndex ? { index: currentTocHrefIndex[href]! } : null,
    }),
  };
  return {
    useReaderStore: <R,>(selector?: (s: typeof state) => R) => (selector ? selector(state) : state),
  };
});

// ProgressBar now subscribes to progress via readerProgressStore so the
// footer can re-render on page turns without dragging in the whole
// readerStore. Tests must forward their mock state here too.
vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => currentProgress,
  getBookProgress: () => currentProgress,
}));

vi.mock('@/store/bookDataStore', () => {
  const state = { getBookData: () => currentBookData };
  return {
    useBookDataStore: <R,>(selector?: (s: typeof state) => R) =>
      selector ? selector(state) : state,
  };
});

vi.mock('@/helpers/settings', () => ({
  saveViewSettings: (...args: unknown[]) => saveViewSettings(...args),
}));

vi.mock('@/utils/event', () => ({
  eventDispatcher: { dispatchSync: () => false },
}));

vi.mock('@/app/reader/components/StatusInfo.tsx', () => ({
  default: () => null,
}));

const baseSettings: ViewSettings = {
  ...DEFAULT_VIEW_CONFIG,
} as ViewSettings;

const renderProgressBar = () =>
  render(
    <ProgressBar
      bookKey='book-1'
      horizontalGap={0}
      contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }}
      gridInsets={{ top: 0, right: 0, bottom: 0, left: 0 }}
    />,
  );

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  saveViewSettings.mockClear();
  currentAppService = { isMobile: false, hasSafeAreaInset: false };
  currentProgress = null;
  currentBookData = { isFixedLayout: false };
  currentRenderer = { page: 0, pages: 0 };
  currentSectionFractions = [];
  currentTocHrefIndex = {};
});

const makeProgress = (current: number, total: number): BookProgress =>
  ({
    section: { current, total },
    pageinfo: { current, total },
    timeinfo: { section: 0, total: 0 },
  }) as BookProgress;

describe('ProgressBar — fixed-layout remaining pages', () => {
  it('says "in book" with section-derived count for fixed-layout books', () => {
    currentViewSettings = {
      ...baseSettings,
      showRemainingPages: true,
      showRemainingTime: false,
    } as ViewSettings;
    currentProgress = makeProgress(2, 5);
    currentBookData = { isFixedLayout: true, bookDoc: { metadata: {} } };

    const { container } = renderProgressBar();

    expect(container.querySelector('.progressinfo')?.getAttribute('aria-label')).toContain(
      '3 pages left in book',
    );
  });

  it('says "in chapter" for reflowable books', () => {
    currentViewSettings = {
      ...baseSettings,
      showRemainingPages: true,
      showRemainingTime: false,
    } as ViewSettings;
    currentProgress = makeProgress(2, 5);
    currentBookData = { isFixedLayout: false };
    currentRenderer = { page: 1, pages: 4 };

    const { container } = renderProgressBar();

    expect(container.querySelector('.progressinfo')?.getAttribute('aria-label')).toContain(
      'pages left in chapter',
    );
  });
});

describe('ProgressBar — decorative footer is not focusable', () => {
  it('does not make the progress info container focusable (no stray focus ring)', () => {
    // The footer info is a decorative role="presentation" element. A negative
    // tabindex made it focusable, so long-pressing it on Android focused the
    // div and the WebView painted its default focus ring as a persistent line
    // across the bottom of the page (issue #4397). A decorative element must
    // not be focusable so it can never receive a focus ring.
    currentViewSettings = {
      ...baseSettings,
    } as ViewSettings;
    currentProgress = makeProgress(2, 5);
    currentBookData = { isFixedLayout: false };
    currentRenderer = { page: 1, pages: 4 };

    const { container } = renderProgressBar();

    const progressInfo = container.querySelector('.progressinfo');
    expect(progressInfo).not.toBeNull();
    expect(progressInfo!.hasAttribute('tabindex')).toBe(false);
  });
});

describe('ProgressBar — sticky progress bar', () => {
  const tocItem = (href: string): TOCItem => ({ id: 0, label: href, href, index: 0 }) as TOCItem;

  const enableStickyBar = (overrides?: Partial<ViewSettings>) => {
    currentViewSettings = {
      ...baseSettings,
      showStickyProgressBar: true,
      ...overrides,
    } as ViewSettings;
    // fraction (0.5) deliberately differs from the page fraction
    // ((2+1)/5 = 0.6) so the test proves the fill uses progress.fraction.
    currentProgress = { ...makeProgress(2, 5), fraction: 0.5 } as BookProgress;
    currentBookData = {
      isFixedLayout: false,
      bookDoc: {
        toc: [
          tocItem('ch1.xhtml'),
          tocItem('ch2.xhtml'),
          tocItem('ch3.xhtml'),
          tocItem('ch4.xhtml'),
        ],
      },
    };
    // 5 sections; chapter starts [0.2, 0.4, 0.6, 0.8]; first & last dropped -> 2 ticks.
    currentSectionFractions = [0, 0.2, 0.4, 0.6, 0.8, 1];
    currentTocHrefIndex = { 'ch1.xhtml': 1, 'ch2.xhtml': 2, 'ch3.xhtml': 3, 'ch4.xhtml': 4 };
    currentRenderer = { page: 1, pages: 4 };
  };

  it('renders the sticky bar with chapter ticks and a fill from progress.fraction', () => {
    enableStickyBar();

    const { container } = renderProgressBar();

    const bar = container.querySelector('.sticky-progress-bar');
    expect(bar).not.toBeNull();
    expect(bar!.querySelectorAll('.sticky-progress-tick').length).toBe(2);
    const fill = bar!.querySelector('.sticky-progress-fill') as HTMLElement;
    expect(fill.style.width).toBe('50%');
  });

  it('does not render the sticky bar when the setting is off', () => {
    enableStickyBar({ showStickyProgressBar: false });

    const { container } = renderProgressBar();

    expect(container.querySelector('.sticky-progress-bar')).toBeNull();
  });

  it('does not render the sticky bar in vertical writing mode', () => {
    enableStickyBar({ vertical: true });

    const { container } = renderProgressBar();

    expect(container.querySelector('.sticky-progress-bar')).toBeNull();
  });
});

describe('ProgressBar — display-only footer overlay', () => {
  // The footer overlay is stacked above the book but is purely informational:
  // it must never intercept taps or text selection over book content, and it
  // exposes no clickable tap targets. In scrolled mode (no reserved band) each
  // info segment carries its own shrink-wrapped pill backdrop so it stays
  // legible floating over the text instead of a full-width bar.
  const readerSettings = (overrides?: Partial<ViewSettings>) => {
    currentViewSettings = {
      ...baseSettings,
      ...overrides,
    } as ViewSettings;
    currentProgress = makeProgress(2, 5);
    currentBookData = { isFixedLayout: false };
    currentRenderer = { page: 1, pages: 4 };
  };

  it('keeps the full-width container pointer-events-none even on mobile', () => {
    readerSettings({ showRemainingPages: true });
    currentAppService = { isMobile: true, hasSafeAreaInset: false };

    const { container } = renderProgressBar();

    const progressInfo = container.querySelector('.progressinfo') as HTMLElement;
    expect(progressInfo.classList.contains('pointer-events-none')).toBe(true);
    expect(progressInfo.classList.contains('pointer-events-auto')).toBe(false);
  });

  it('exposes no interactive targets (display-only, no tap-to-toggle)', () => {
    readerSettings({ showRemainingPages: true });

    const { container } = renderProgressBar();

    expect(container.querySelector('.pointer-events-auto')).toBeNull();
    expect(container.querySelector('.cursor-pointer')).toBeNull();
    expect(container.querySelector('.progress-restore-pad')).toBeNull();
    // No showFooter write ever originates from tapping the footer.
    expect(saveViewSettings.mock.calls.some((args) => args[2] === 'showFooter')).toBe(false);
  });

  it('wraps each info segment in its own pill backdrop in scrolled mode', () => {
    // Scrolled mode reserves no bottom band — the info floats over the book
    // text, so each segment needs a shrink-wrapped backdrop to stay legible.
    readerSettings({ scrolled: true, showRemainingPages: true });

    const { container } = renderProgressBar();

    const pills = container.querySelectorAll('.progress-pill');
    expect(pills.length).toBeGreaterThanOrEqual(2); // remaining + progress
    for (const pill of pills) {
      expect((pill as HTMLElement).classList.contains('bg-base-100/85')).toBe(true);
    }
  });

  it('does not add pill backdrops in paginated mode (band holds the info)', () => {
    readerSettings({ scrolled: false, showRemainingPages: true });

    const { container } = renderProgressBar();

    expect(container.querySelector('.progress-pill')).toBeNull();
  });
});

describe('ProgressBar — contrast against the page (#4901)', () => {
  // A light-mode PDF under a dark theme keeps its white page, so the footer
  // progress/remaining text blends against the real backdrop (text-white/75 +
  // mix-blend-difference) to stay legible over the white page. Reflowable books
  // theme their own page to the UI, so the footer uses plain base-content text
  // instead of the blend. StatusInfo (clock/battery) is intentionally left
  // alone -- it manages its own blend against the battery glyph.
  it('blends the progress and remaining text over a fixed-layout page in non-eink mode', () => {
    currentViewSettings = {
      ...baseSettings,
      isEink: false,
      showRemainingPages: true,
      showRemainingTime: false,
    } as ViewSettings;
    currentProgress = makeProgress(2, 5);
    currentBookData = { isFixedLayout: true };
    currentRenderer = { page: 1, pages: 4 };

    const { container } = renderProgressBar();

    const info = container.querySelector('.progressinfo') as HTMLElement;
    expect(info.classList.contains('mix-blend-difference')).toBe(true);
    expect(info.classList.contains('text-white/75')).toBe(true);
  });

  it('uses themed base-content text for reflowable books in non-eink mode', () => {
    currentViewSettings = {
      ...baseSettings,
      isEink: false,
      showRemainingPages: true,
      showRemainingTime: false,
    } as ViewSettings;
    currentProgress = makeProgress(2, 5);
    currentBookData = { isFixedLayout: false };
    currentRenderer = { page: 1, pages: 4 };

    const { container } = renderProgressBar();

    const info = container.querySelector('.progressinfo') as HTMLElement;
    expect(info.classList.contains('mix-blend-difference')).toBe(false);
    expect(info.classList.contains('text-base-content')).toBe(true);
  });

  it('does not blend in eink mode', () => {
    currentViewSettings = {
      ...baseSettings,
      isEink: true,
      showRemainingPages: true,
      showRemainingTime: false,
    } as ViewSettings;
    currentProgress = makeProgress(2, 5);
    currentBookData = { isFixedLayout: false };
    currentRenderer = { page: 1, pages: 4 };

    const { container } = renderProgressBar();

    const info = container.querySelector('.progressinfo') as HTMLElement;
    expect(info.classList.contains('mix-blend-difference')).toBe(false);
  });
});
