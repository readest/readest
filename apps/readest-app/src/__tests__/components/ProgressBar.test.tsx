// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ProgressBar from '@/app/reader/components/ProgressBar';
import { DEFAULT_VIEW_CONFIG } from '@/services/constants';
import { clearChapterScreens, recordChapterScreens } from '@/utils/chapterScreens';
import type { BookProgress, ViewSettings } from '@/types/book';
import type { TOCItem } from '@/libs/document';

const saveViewSettings = vi.fn();
let medianPageDurationSecs: number | null = null;
vi.mock('@/hooks/useMedianPageDurationSecs', () => ({
  useMedianPageDurationSecs: () => medianPageDurationSecs,
}));

let currentViewSettings: ViewSettings;
let currentProgress: BookProgress | null;
let currentBookData: {
  isFixedLayout: boolean;
  bookDoc?: {
    metadata?: Record<string, unknown>;
    toc?: TOCItem[];
    sections?: {
      location?: { current: number; next: number; total: number };
      size?: number;
      linear?: string;
    }[];
  };
} | null;
let currentRenderer: { page: number; pages: number; atEnd?: boolean };
let currentSectionFractions: number[] = [];
let currentTocHrefIndex: Record<string, number> = {};

// Per-test translations; like i18next, `replace` (when given) supplies the
// interpolated values while `count` only picks the plural form.
let currentTranslations: Record<string, string> = {};
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string, values?: Record<string, unknown>) => {
    const data = (values?.['replace'] as Record<string, unknown> | undefined) ?? values;
    return (currentTranslations[s] ?? s).replace(/{{(\w+)}}/g, (match, name) =>
      String(data?.[name] ?? match),
    );
  },
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

let statusInfoProps: Record<string, unknown> | null = null;
vi.mock('@/app/reader/components/StatusInfo.tsx', () => ({
  default: (props: Record<string, unknown>) => {
    statusInfoProps = props;
    return null;
  },
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
  clearChapterScreens('book-1');
});

beforeEach(() => {
  saveViewSettings.mockClear();
  medianPageDurationSecs = null;
  currentAppService = { isMobile: false, hasSafeAreaInset: false };
  currentProgress = null;
  currentBookData = { isFixedLayout: false };
  currentRenderer = { page: 0, pages: 0 };
  currentSectionFractions = [];
  currentTocHrefIndex = {};
  currentTranslations = {};
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

describe('ProgressBar — percent readout', () => {
  // A location pair of 2/5 reads 60%; the continuous fraction says 45%.
  const setupPercent = (isFixedLayout: boolean) => {
    currentViewSettings = {
      ...baseSettings,
      progressStyle: 'percentage',
      showProgressInfo: true,
    } as ViewSettings;
    currentProgress = { ...makeProgress(2, 5), fraction: 0.45 } as BookProgress;
    currentBookData = { isFixedLayout };
  };

  it('reads the continuous fraction for reflowable books', () => {
    setupPercent(false);
    const { container } = renderProgressBar();
    expect(container.querySelector('.progress-info-label')?.textContent).toBe('45%');
  });

  it('keeps the page-count percent for fixed-layout books (fraction is byte-weighted)', () => {
    setupPercent(true);
    const { container } = renderProgressBar();
    expect(container.querySelector('.progress-info-label')?.textContent).toBe('60%');
  });
});

describe('ProgressBar — calibrated page pair', () => {
  const setupFraction = (opts?: {
    fraction?: number;
    sections?: { size?: number; linear?: string }[];
    scrolled?: boolean;
    stablePageNumbers?: boolean;
  }) => {
    currentViewSettings = {
      ...baseSettings,
      progressStyle: 'fraction',
      showProgressInfo: true,
      scrolled: opts?.scrolled ?? false,
      stablePageNumbers: opts?.stablePageNumbers ?? false,
    } as ViewSettings;
    currentProgress = { ...makeProgress(2, 5), fraction: opts?.fraction } as BookProgress;
    currentBookData = {
      isFixedLayout: false,
      bookDoc: opts?.sections ? { sections: opts.sections } : { metadata: {} },
    };
  };

  it('keeps the stable byte-grid pair by default', () => {
    setupFraction({
      sections: [{ size: 1500 }, { size: 1500 }, { size: 15000 }],
      stablePageNumbers: DEFAULT_VIEW_CONFIG.stablePageNumbers,
    });
    recordChapterScreens('book-1', 2, 10);
    currentRenderer = { page: 3, pages: 10 };

    const { container } = renderProgressBar();

    expect(container.querySelector('.progress-info-label')?.textContent).toBe('3 / 5');
  });

  it('advances exactly one page per turn once chapters are measured', () => {
    // Chapter 2 measures 10 spreads over 15000 bytes -> 1500 bytes/screen, so
    // the two 1500-byte chapters before it count one page each: 2 + page 3.
    setupFraction({ sections: [{ size: 1500 }, { size: 1500 }, { size: 15000 }] });
    recordChapterScreens('book-1', 2, 10);
    currentRenderer = { page: 3, pages: 10 };

    const { container } = renderProgressBar();

    expect(container.querySelector('.progress-info-label')?.textContent).toBe('6 / 12');
  });

  it('estimates whole screens from bytes before any chapter is measured', () => {
    // At 1500 bytes/screen the chapters fill 1, 2 and 3 screens (their last
    // one partly); base 3 + page 1.
    setupFraction({ sections: [{ size: 1000 }, { size: 2000 }, { size: 4000 }] });
    currentRenderer = { page: 1, pages: 3 };

    const { container } = renderProgressBar();

    expect(container.querySelector('.progress-info-label')?.textContent).toBe('5 / 6');
  });

  it('keeps chunked chapters smooth via the byte-domain fraction', () => {
    setupFraction({
      fraction: 0.6,
      sections: [{ size: 1000 }, { size: 2000 }, { size: 1500000 }],
    });
    currentSectionFractions = [0, 0.25, 0.5, 0.7, 0.9, 1];
    // Chunk-local renderer coordinates (page 9 of chunk pages 12) are ignored.
    currentRenderer = { page: 9, pages: 12 };

    const { container } = renderProgressBar();

    expect(container.querySelector('.progress-info-label')?.textContent).toBe('504 / 1004');
  });

  it('reads total / total on the last screen when the book ends with a non-linear item (#7453)', () => {
    setupFraction({ sections: [{ size: 3000 }, { size: 3000 }, { size: 1500, linear: 'no' }] });
    currentProgress = { ...makeProgress(1, 3), fraction: 0.99 } as BookProgress;
    recordChapterScreens('book-1', 0, 2);
    recordChapterScreens('book-1', 1, 2);
    currentRenderer = { page: 1, pages: 2 };

    const { container } = renderProgressBar();

    expect(container.querySelector('.progress-info-label')?.textContent).toBe('4 / 4');
  });

  it('reads total / total on the last screen when a short last chapter shares it', () => {
    // Two columns: "About the Author" ends on the left page and the one-column
    // last chapter fills the right one. The spread's primary chapter is the
    // first, so the last chapter's screen is never counted as reached.
    setupFraction({ sections: [{ size: 3000 }, { size: 3000 }, { size: 1000 }] });
    currentProgress = { ...makeProgress(1, 3), fraction: 0.9 } as BookProgress;
    recordChapterScreens('book-1', 0, 2);
    recordChapterScreens('book-1', 1, 2);
    recordChapterScreens('book-1', 2, 1);
    currentRenderer = { page: 1, pages: 2, atEnd: true };

    const { container } = renderProgressBar();

    expect(container.querySelector('.progress-info-label')?.textContent).toBe('5 / 5');
  });

  it('falls back to the book-level pair in scrolled mode', () => {
    setupFraction({ scrolled: true });
    currentRenderer = { page: 1, pages: 4 };

    const { container } = renderProgressBar();

    expect(container.querySelector('.progress-info-label')?.textContent).toBe('3 / 5');
  });

  it('keeps real page pairs for fixed-layout books', () => {
    setupFraction();
    currentBookData = { isFixedLayout: true, bookDoc: { metadata: {} } };

    const { container } = renderProgressBar();

    expect(container.querySelector('.progress-info-label')?.textContent).toBe('3 / 5');
  });
});

describe('ProgressBar — remaining time and pages together', () => {
  it.each([
    ['in book', true],
    ['in chapter', false],
  ])('shows one combined sentence %s', (scope, isFixedLayout) => {
    currentViewSettings = {
      ...baseSettings,
      showRemainingPages: true,
      showRemainingTime: true,
    } as ViewSettings;
    currentProgress = makeProgress(2, 5);
    currentBookData = { isFixedLayout };
    currentRenderer = { page: 1, pages: 4 };

    const { container } = renderProgressBar();

    const text = container.querySelector('.remaining-info')?.textContent ?? '';
    expect(text).toMatch(new RegExp(`and 3 pages left ${scope}$`));
    expect(text.match(/left/g)).toHaveLength(1);
  });
});

describe('ProgressBar — Custom Reader UI CSS hooks on the remaining readouts (#7483)', () => {
  // [class, text] of each part of the readout, in order.
  const parts = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('.remaining-info > span > span')).map((el) => [
      el.className,
      el.textContent,
    ]);

  beforeEach(() => {
    currentProgress = makeProgress(2, 5);
    currentRenderer = { page: 1, pages: 4 };
  });

  it('wraps the time, the page count and the words when both are shown', () => {
    currentViewSettings = {
      ...baseSettings,
      showRemainingPages: true,
      showRemainingTime: true,
    } as ViewSettings;

    const { container } = renderProgressBar();

    expect(parts(container)).toEqual([
      ['time-left-number', '1m'],
      ['pages-left-label', ' and '],
      ['pages-left-number', '3'],
      ['pages-left-label', ' pages left in chapter'],
    ]);
  });

  it('follows the word order of the translation', () => {
    currentTranslations = {
      '{{time}} and {{count}} pages left in chapter': 'متبقي {{time}} و{{count}} صفحة في الفصل',
    };
    currentViewSettings = {
      ...baseSettings,
      showRemainingPages: true,
      showRemainingTime: true,
    } as ViewSettings;

    const { container } = renderProgressBar();

    expect(parts(container)).toEqual([
      ['pages-left-label', 'متبقي '],
      ['time-left-number', '1m'],
      ['pages-left-label', ' و'],
      ['pages-left-number', '3'],
      ['pages-left-label', ' صفحة في الفصل'],
    ]);
    expect(container.querySelector('.progressinfo')?.getAttribute('aria-label')).toContain(
      'متبقي 1m و3 صفحة في الفصل',
    );
  });

  it('wraps Chinese numerals in vertical Chinese layouts', () => {
    localStorage.setItem('i18nextLng', 'zh-CN');
    currentViewSettings = {
      ...baseSettings,
      vertical: true,
      showRemainingPages: true,
      showRemainingTime: true,
    } as ViewSettings;

    const { container } = renderProgressBar();
    localStorage.removeItem('i18nextLng');

    expect(parts(container)).toEqual([
      ['time-left-number', '一m'],
      ['pages-left-label', ' and '],
      ['pages-left-number', '三'],
      ['pages-left-label', ' pages left in chapter'],
    ]);
  });

  it('wraps the time and the words when only the time is shown', () => {
    currentViewSettings = {
      ...baseSettings,
      showRemainingPages: false,
      showRemainingTime: true,
    } as ViewSettings;

    const { container } = renderProgressBar();

    expect(parts(container)).toEqual([
      ['time-left-number', '1m'],
      ['time-left-text', ' left in chapter'],
    ]);
  });
});

describe('ProgressBar — localized numerals', () => {
  afterEach(() => localStorage.removeItem('i18nextLng'));

  it('writes the remaining time in Chinese numerals in vertical Chinese layouts', () => {
    localStorage.setItem('i18nextLng', 'zh-CN');
    currentViewSettings = {
      ...baseSettings,
      vertical: true,
      showRemainingTime: true,
      showRemainingPages: false,
    } as ViewSettings;
    currentProgress = makeProgress(2, 5);
    currentBookData = { isFixedLayout: true };

    const { container } = renderProgressBar();

    const label = container.querySelector('.progressinfo')?.getAttribute('aria-label') ?? '';
    expect(label).toMatch(/[〇一二三四五六七八九十百]+m left in book/);
    expect(label).not.toMatch(/\d+m left/);
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

  it('stays above the reading ruler filter layer', () => {
    currentViewSettings = {
      ...baseSettings,
    } as ViewSettings;
    currentProgress = makeProgress(2, 5);
    currentBookData = { isFixedLayout: false };
    currentRenderer = { page: 1, pages: 4 };

    const { container } = renderProgressBar();

    // ReadingRuler uses z-[5]. Reader chrome must paint above it so the
    // backdrop filter cannot blur the footer when the ruler reaches the bottom.
    expect(container.querySelector('.progressinfo')?.classList.contains('z-10')).toBe(true);
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

  it('renders a vertical sticky bar in vertical writing mode', () => {
    enableStickyBar({ vertical: true });

    const { container } = renderProgressBar();

    const bar = container.querySelector('.sticky-progress-bar') as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.classList.contains('w-3')).toBe(true);
    const fill = bar.querySelector('.sticky-progress-fill') as HTMLElement;
    expect(fill.style.height).toBe('50%');
    expect(fill.style.top).toBe('0px');
  });
});

describe('ProgressBar — footer overlay pointer contract', () => {
  // The full-width overlay container stays passive so taps and text selection
  // over book content pass through; only the strip (band modes) or the pills
  // themselves (scrolled mode) are tap targets — see the tap-to-toggle suite.
  // In scrolled mode (no reserved band) each info segment carries its own
  // shrink-wrapped pill backdrop so it stays legible floating over the text
  // instead of a full-width bar.
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

  it('drops the pill backdrops in scrolled mode with Solid Footer on (#6793)', () => {
    // The band is reserved, so the info sits on it instead of over the text.
    readerSettings({ scrolled: true, showRemainingPages: true, solidScrolledFooter: true });

    const { container } = renderProgressBar();

    expect(container.querySelector('.progress-pill')).toBeNull();
  });

  it('does not add pill backdrops in paginated mode (band holds the info)', () => {
    readerSettings({ scrolled: false, showRemainingPages: true });

    const { container } = renderProgressBar();

    expect(container.querySelector('.progress-pill')).toBeNull();
  });
});

describe('ProgressBar — tap to toggle visibility (#5293)', () => {
  // Tapping the footer toggles the info's visibility without touching layout
  // or settings: the reserved band stays, showFooter never changes, and the
  // state is ephemeral — a fresh mount (book open) starts visible again.
  // Where the strip sits on reserved margin space (paginated band, sticky
  // bar, vertical side column) the whole strip is the tap target; in scrolled
  // mode the info floats over book text, so only the pills are tappable and
  // the strip keeps letting taps and text selection through.
  const readerSettings = (overrides?: Partial<ViewSettings>) => {
    currentViewSettings = {
      ...baseSettings,
      ...overrides,
    } as ViewSettings;
    currentProgress = makeProgress(2, 5);
    currentBookData = { isFixedLayout: false };
    currentRenderer = { page: 1, pages: 4 };
  };

  it('toggles the info visibility when the strip is tapped in paginated mode', () => {
    readerSettings({ showRemainingPages: true });

    const { container } = renderProgressBar();

    const strip = container.querySelector('.progress-strip') as HTMLElement;
    expect(strip).not.toBeNull();
    expect(strip.classList.contains('pointer-events-auto')).toBe(true);
    expect(strip.classList.contains('opacity-0')).toBe(false);

    fireEvent.click(strip);
    expect(strip.classList.contains('opacity-0')).toBe(true);
    expect(strip.classList.contains('transition-opacity')).toBe(false);
    // The strip stays tappable while hidden so the same tap brings it back.
    expect(strip.classList.contains('pointer-events-auto')).toBe(true);

    fireEvent.click(strip);
    expect(strip.classList.contains('opacity-0')).toBe(false);
    expect(strip.classList.contains('transition-opacity')).toBe(true);
  });

  it('never writes settings from the tap (visibility is ephemeral)', () => {
    readerSettings({ showRemainingPages: true });

    const { container } = renderProgressBar();

    fireEvent.click(container.querySelector('.progress-strip') as HTMLElement);
    expect(saveViewSettings).not.toHaveBeenCalled();
  });

  it('starts visible again on a fresh mount (state resets with the book)', () => {
    readerSettings({ showRemainingPages: true });

    const first = renderProgressBar();
    fireEvent.click(first.container.querySelector('.progress-strip') as HTMLElement);
    expect(
      (first.container.querySelector('.progress-strip') as HTMLElement).classList.contains(
        'opacity-0',
      ),
    ).toBe(true);
    first.unmount();

    const second = renderProgressBar();
    expect(
      (second.container.querySelector('.progress-strip') as HTMLElement).classList.contains(
        'opacity-0',
      ),
    ).toBe(false);
  });

  it('keeps the strip passive in scrolled mode — the pills are the tap targets', () => {
    readerSettings({ scrolled: true, showRemainingPages: true });

    const { container } = renderProgressBar();

    const strip = container.querySelector('.progress-strip') as HTMLElement;
    expect(strip.classList.contains('pointer-events-auto')).toBe(false);

    const pill = container.querySelector('.progress-pill') as HTMLElement;
    expect(pill.classList.contains('pointer-events-auto')).toBe(true);

    fireEvent.click(pill);
    expect(strip.classList.contains('opacity-0')).toBe(true);
  });

  it('makes the whole strip tappable in scrolled mode when the sticky bar reserves the band', () => {
    readerSettings({ scrolled: true, showStickyProgressBar: true });

    const { container } = renderProgressBar();

    const strip = container.querySelector('.progress-strip') as HTMLElement;
    expect(strip.classList.contains('pointer-events-auto')).toBe(true);
  });

  it('makes the whole strip tappable in scrolled mode with Solid Footer on (#6793)', () => {
    readerSettings({ scrolled: true, showRemainingPages: true, solidScrolledFooter: true });

    const { container } = renderProgressBar();

    const strip = container.querySelector('.progress-strip') as HTMLElement;
    expect(strip.classList.contains('pointer-events-auto')).toBe(true);
  });

  it('makes the side column tappable in vertical mode', () => {
    readerSettings({ vertical: true, showRemainingPages: true });

    const { container } = renderProgressBar();

    const strip = container.querySelector('.progress-strip') as HTMLElement;
    expect(strip.classList.contains('pointer-events-auto')).toBe(true);
  });

  it('exposes no tap target when the footer has nothing to show', () => {
    readerSettings({
      showProgressInfo: false,
      showRemainingTime: false,
      showRemainingPages: false,
      showCurrentTime: false,
      showCurrentBatteryStatus: false,
      showStickyProgressBar: false,
    });

    const { container } = renderProgressBar();

    expect(container.querySelector('.pointer-events-auto')).toBeNull();
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

  // #5342: scrolled mode gives every segment its own bg-base-100/85 pill, and
  // the blend applies to the container as a group -- a white pill differenced
  // against the white PDF page turns pure black. The pill already guarantees
  // legibility, so the blend must stand down whenever pills are on.
  it('drops the blend for a fixed-layout book when the pills provide the backdrop', () => {
    currentViewSettings = {
      ...baseSettings,
      isEink: false,
      scrolled: true,
      showRemainingPages: true,
      showRemainingTime: false,
    } as ViewSettings;
    currentProgress = makeProgress(2, 5);
    currentBookData = { isFixedLayout: true };
    currentRenderer = { page: 1, pages: 4 };

    const { container } = renderProgressBar();

    const info = container.querySelector('.progressinfo') as HTMLElement;
    expect(container.querySelector('.progress-pill')).not.toBeNull();
    expect(info.classList.contains('mix-blend-difference')).toBe(false);
    expect(info.classList.contains('text-base-content')).toBe(true);
  });

  it('keeps the blend for a fixed-layout book in scrolled mode when the sticky bar replaces the pills', () => {
    currentViewSettings = {
      ...baseSettings,
      isEink: false,
      scrolled: true,
      showStickyProgressBar: true,
      showRemainingPages: true,
      showRemainingTime: false,
    } as ViewSettings;
    currentProgress = makeProgress(2, 5);
    currentBookData = { isFixedLayout: true };
    currentRenderer = { page: 1, pages: 4 };

    const { container } = renderProgressBar();

    const info = container.querySelector('.progressinfo') as HTMLElement;
    expect(container.querySelector('.progress-pill')).toBeNull();
    expect(info.classList.contains('mix-blend-difference')).toBe(true);
  });
});

describe('ProgressBar — TOC chapter remaining time (#6284)', () => {
  const setup = (page: number, href: string) => {
    currentViewSettings = { ...baseSettings, showRemainingTime: true, showRemainingPages: false };
    currentProgress = {
      ...makeProgress(page, 98),
      sectionHref: href,
      section: { current: 0, total: 1 },
      pageinfo: { current: page, next: page + 2, total: 98 },
    };
    currentRenderer = { page: 13, pages: 43 };
    currentSectionFractions = [0, 1];
    medianPageDurationSecs = 60;
    currentBookData = {
      isFixedLayout: false,
      bookDoc: {
        sections: [{ location: { current: 0, next: 98, total: 98 } }],
        toc: [0, 32, 64].map((start, i) => ({
          id: i,
          index: 0,
          href: `body.xhtml#chapter${i + 1}`,
          label: `Chapter ${i + 1}`,
          location: { current: start, next: start, total: 98 },
        })),
      },
    };
  };

  it('stops at the next TOC chapter inside the same spine file', () => {
    setup(30, 'body.xhtml#chapter1');
    const { container } = renderProgressBar();
    expect(container.querySelector('.progressinfo')?.getAttribute('aria-label')).toContain(
      '2m left in chapter',
    );
    expect(container.querySelector('.progressinfo')?.getAttribute('aria-label')).toContain(
      '1 pages left in chapter',
    );
  });

  it('resets on a TOC boundary and returns to a small value when navigating back', () => {
    setup(32, 'body.xhtml#chapter2');
    const { container, rerender } = renderProgressBar();
    expect(container.querySelector('.progressinfo')?.getAttribute('aria-label')).toContain(
      '32m left in chapter',
    );
    setup(30, 'body.xhtml#chapter1');
    rerender(
      <ProgressBar
        bookKey='book-1'
        horizontalGap={0}
        contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }}
        gridInsets={{ top: 0, right: 0, bottom: 0, left: 0 }}
      />,
    );
    expect(container.querySelector('.progressinfo')?.getAttribute('aria-label')).toContain(
      '2m left in chapter',
    );
  });

  it('does not move remaining screen pages when only the rounded location changes', () => {
    setup(1, 'body.xhtml#chapter1');
    currentRenderer = { page: 1, pages: 65 };
    currentProgress!.pageinfo.next = 3;
    const { container, rerender } = renderProgressBar();
    const props = {
      bookKey: 'book-1',
      horizontalGap: 0,
      contentInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      gridInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    };
    expect(container.querySelector('.progressinfo')?.getAttribute('aria-label')).toContain(
      '20 pages left in chapter',
    );
    currentProgress!.pageinfo = { current: 3, next: 4, total: 98 };
    rerender(<ProgressBar {...props} />);
    expect(container.querySelector('.progressinfo')?.getAttribute('aria-label')).toContain(
      '20 pages left in chapter',
    );
    currentRenderer.page = 2;
    rerender(<ProgressBar {...props} />);
    expect(container.querySelector('.progressinfo')?.getAttribute('aria-label')).toContain(
      '19 pages left in chapter',
    );
  });

  it('switches to hours and minutes at an hour or more', () => {
    setup(30, 'body.xhtml#chapter1');
    medianPageDurationSecs = 2700;
    const { container } = renderProgressBar();
    expect(container.querySelector('.progressinfo')?.getAttribute('aria-label')).toContain(
      '1h 30m left in chapter',
    );
  });

  it('counts to the book end for the last chapter', () => {
    setup(96, 'body.xhtml#chapter3');
    const { container } = renderProgressBar();
    expect(container.querySelector('.progressinfo')?.getAttribute('aria-label')).toContain(
      '2m left in chapter',
    );
  });

  it('uses nested TOC boundaries and ignores duplicate chapter starts', () => {
    setup(30, 'body.xhtml#chapter1');
    const toc = currentBookData!.bookDoc!.toc!;
    currentBookData!.bookDoc!.toc = [
      { ...toc[0]!, subitems: [{ ...toc[0]!, href: 'body.xhtml#part1' }, toc[1]!, toc[2]!] },
    ];
    const { container } = renderProgressBar();
    expect(container.querySelector('.progressinfo')?.getAttribute('aria-label')).toContain(
      '2m left in chapter',
    );
  });

  it('uses the spine time estimate until TOC locations are available', () => {
    setup(30, 'body.xhtml#chapter1');
    currentBookData!.bookDoc!.toc = [];
    currentProgress!.timeinfo.section = 10;
    medianPageDurationSecs = null;
    const { container } = renderProgressBar();
    expect(container.querySelector('.progressinfo')?.getAttribute('aria-label')).toContain(
      '10m left in chapter',
    );
  });

  it('does not change the time when font size changes the number of screen pages', () => {
    setup(30, 'body.xhtml#chapter1');
    currentRenderer = { page: 26, pages: 86 };
    const { container } = renderProgressBar();
    expect(container.querySelector('.progressinfo')?.getAttribute('aria-label')).toContain(
      '2m left in chapter',
    );
  });
});

describe('ProgressBar — rounded screen corners', () => {
  const renderWithCorners = (left: number, right: number) =>
    render(
      <ProgressBar
        bookKey='book-1'
        horizontalGap={5}
        contentInsets={{ top: 0, right: 16, bottom: 0, left: 16 }}
        gridInsets={{ top: 0, right: 0, bottom: 0, left: 0 }}
        cornerRadii={{ left, right }}
      />,
    );
  const footerStyle = (container: HTMLElement) =>
    (container.querySelector<HTMLElement>('.progressinfo') as HTMLElement).style;

  it('pulls the footer ends clear of the corner arc when the bottom margin is small', () => {
    currentViewSettings = { ...baseSettings, marginBottomPx: 16, headerFooterFontSize: 12 };
    const style = footerStyle(renderWithCorners(45, 45).container);
    expect(style.paddingInlineStart).toBe('max(calc(2.5% + 8px), 35.7px)');
    expect(style.paddingInlineEnd).toBe('max(calc(2.5% + 8px), 35.7px)');
  });

  it('keeps the regular padding when the text sits above the corner arc', () => {
    // Text bottom = 104 / 2 - 12 / 2 = 46px, above the 45px corner.
    currentViewSettings = { ...baseSettings, marginBottomPx: 104, headerFooterFontSize: 12 };
    const style = renderWithCorners(45, 45)
      .container.querySelector<HTMLElement>('.progressinfo')
      ?.getAttribute('style');
    expect(style).not.toContain('max(');
  });

  it('only clears the side that meets a rounded corner', () => {
    // Left of two side-by-side books: its right edge sits mid-screen.
    currentViewSettings = { ...baseSettings, marginBottomPx: 16, headerFooterFontSize: 12 };
    const style = footerStyle(renderWithCorners(45, 0).container);
    expect(style.paddingInlineStart).toBe('max(calc(2.5% + 8px), 35.7px)');
    expect(style.paddingInlineEnd).toBe('calc(2.5% + 8px)');
  });
});

describe('ProgressBar — pages left on every page turn (#6442)', () => {
  it('decrements by one on every screen when a screen holds less than one location', () => {
    currentViewSettings = { ...baseSettings, showRemainingPages: true };
    currentSectionFractions = [0, 1];
    currentBookData = {
      isFixedLayout: false,
      bookDoc: {
        sections: [{ location: { current: 0, next: 10, total: 10 } }],
        toc: [
          {
            id: 0,
            index: 0,
            href: 'body.xhtml',
            label: 'Chapter 1',
            location: { current: 0, next: 10, total: 10 },
          },
        ],
      },
    };
    const labels: string[] = [];
    const { container, rerender } = renderProgressBar();
    for (let page = 1; page <= 6; page++) {
      // 16 screens over 10 locations: foliate floors the location, so it
      // stays put across some page turns.
      const location = Math.floor((page * 10) / 16);
      currentProgress = {
        ...makeProgress(location, 10),
        sectionHref: 'body.xhtml',
        section: { current: 0, total: 1 },
        pageinfo: { current: location, next: location, total: 10 },
      };
      currentRenderer = { page, pages: 16 };
      rerender(
        <ProgressBar
          bookKey='book-1'
          horizontalGap={0}
          contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }}
          gridInsets={{ top: 0, right: 0, bottom: 0, left: 0 }}
        />,
      );
      labels.push(container.querySelector('.progressinfo')?.getAttribute('aria-label') ?? '');
    }
    expect(labels.map((l) => l.match(/(\d+) pages left in chapter/)?.[1])).toEqual([
      '15',
      '14',
      '13',
      '12',
      '11',
      '10',
    ]);
  });
});

// #6794: a custom header/footer text color reached every footer item except the
// battery percentage, which kept the theme's text color.
describe('ProgressBar — battery percentage follows a custom footer color (#6794)', () => {
  const settings = (overrides: Partial<ViewSettings>) => {
    currentViewSettings = {
      ...baseSettings,
      showCurrentBatteryStatus: true,
      showBatteryPercentage: true,
      ...overrides,
    } as ViewSettings;
  };

  beforeEach(() => {
    statusInfoProps = null;
  });

  it('lets the battery percentage inherit a custom footer text color', () => {
    settings({ isEink: false, headerFooterTextColor: '#806000' });
    renderProgressBar();
    expect(statusInfoProps?.['inheritTextColor']).toBe(true);
  });

  it('keeps the themed percentage when no custom color is set', () => {
    settings({ isEink: false, headerFooterTextColor: '' });
    renderProgressBar();
    expect(statusInfoProps?.['inheritTextColor']).toBe(false);
  });

  it('keeps the eink percentage treatment even with a custom color', () => {
    settings({ isEink: true, headerFooterTextColor: '#806000' });
    renderProgressBar();
    expect(statusInfoProps?.['inheritTextColor']).toBe(false);
  });
});

describe('ProgressBar vertical safe-area and 0px margin floor (#7389)', () => {
  it('anchors the vertical progress bar within gridInsets.top and gridInsets.bottom plus 1.5x margins', () => {
    currentViewSettings = { ...baseSettings, vertical: true } as ViewSettings;
    const { container } = render(
      <ProgressBar
        bookKey='book-1'
        horizontalGap={0}
        contentInsets={{ top: 75, right: 0, bottom: 50, left: 0 }}
        gridInsets={{ top: 59, right: 0, bottom: 34, left: 0 }}
      />,
    );
    const bar = container.querySelector('.progressinfo') as HTMLElement;
    expect(bar.style.top).toBe('83px');
    expect(bar.style.bottom).toBe('58px');
    expect(bar.style.width).toBe('16px');
  });

  it('keeps the 1.5x vertical margins and 16px width floor when gridInsets and left margin are zero', () => {
    currentViewSettings = {
      ...baseSettings,
      vertical: true,
      showRemainingPages: true,
    } as ViewSettings;
    currentProgress = makeProgress(1, 4);
    currentRenderer = { page: 1, pages: 4 };
    const { container } = render(
      <ProgressBar
        bookKey='book-1'
        horizontalGap={0}
        contentInsets={{ top: 16, right: 0, bottom: 16, left: 0 }}
        gridInsets={{ top: 0, right: 0, bottom: 0, left: 0 }}
      />,
    );
    const bar = container.querySelector('.progressinfo') as HTMLElement;
    expect(bar.style.top).toBe('24px');
    expect(bar.style.bottom).toBe('24px');
    expect(bar.style.left).toBe('calc(0px)');
    expect(bar.style.width).toBe('16px');
    const readout = container.querySelector('.progress-readout') as HTMLElement;
    expect(readout.classList.contains('min-h-0')).toBe(true);
    expect(readout.classList.contains('min-w-0')).toBe(false);
  });
});

// The vertical footer takes the 32px of the left margin next to the text, as
// under Double Border, or the whole margin when it is narrower. The text's left
// edge is max(16, contentInsets.left) in from the cell's left.
describe('ProgressBar vertical band at large side margins (#7912)', () => {
  const renderVertical = (gridLeft: number, contentLeft: number) => {
    currentViewSettings = { ...baseSettings, vertical: true } as ViewSettings;
    return render(
      <ProgressBar
        bookKey='book-1'
        horizontalGap={0}
        contentInsets={{ top: 16, right: 0, bottom: 16, left: contentLeft }}
        gridInsets={{ top: 0, right: 0, bottom: 0, left: gridLeft }}
      />,
    ).container.querySelector('.progressinfo') as HTMLElement;
  };

  it('sits against the text in a 144px left margin instead of over it', () => {
    const bar = renderVertical(0, 144);
    expect(bar.style.left).toBe('calc(112px)');
    expect(bar.style.width).toBe('32px');
  });

  it('sits between a left safe-area inset and the text', () => {
    const bar = renderVertical(47, 63);
    expect(bar.style.left).toBe('calc(47px)');
    expect(bar.style.width).toBe('16px');
  });
});
