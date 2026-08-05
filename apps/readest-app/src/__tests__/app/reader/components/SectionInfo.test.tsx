import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import SectionInfo from '@/app/reader/components/SectionInfo';

let currentBookData: { isFixedLayout: boolean } | undefined;
let currentMarginTopPx = 44;

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { isAndroidApp: false, isMobile: true } }),
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ systemUIVisible: false, statusBarHeight: 0 }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    hoveredBookKey: '',
    getView: () => null,
    getViewSettings: () => ({ marginTopPx: currentMarginTopPx }),
    setHoveredBookKey: vi.fn(),
  }),
}));

vi.mock('@/store/bookDataStore', () => {
  const state = { getBookData: () => currentBookData };
  return {
    useBookDataStore: <R,>(selector?: (s: typeof state) => R) =>
      selector ? selector(state) : state,
  };
});

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

const baseProps = {
  bookKey: 'book-1',
  section: 'Chapter 1',
  showDoubleBorder: false,
  isScrolled: true,
  isVertical: false,
  isEink: false,
  horizontalGap: 5,
  contentInsets: { top: 89, right: 0, bottom: 0, left: 0 },
  gridInsets: { top: 45, right: 0, bottom: 0, left: 0 },
};

describe('SectionInfo notch mask', () => {
  it('spans the grid cell and clips to the top inset so its texture aligns with the viewer (#4486)', () => {
    // The scrolled-mode notch mask hides content scrolling under the status bar,
    // but must not occlude the background texture. Its texture ::before only
    // tile-aligns with .foliate-viewer::before (background-size cover/contain
    // resolves against the element box) if the notch shares the viewer's paint
    // box: full grid cell, with the visible/hit area clipped to the inset strip.
    const { container } = render(<SectionInfo {...baseProps} />);
    const notch = container.querySelector('.notch-area') as HTMLElement;

    expect(notch).not.toBeNull();
    expect(notch.classList.contains('inset-0')).toBe(true);
    expect(notch.classList.contains('notch-masked')).toBe(true);
    expect(notch.classList.contains('bg-base-100')).toBe(true);
    expect(notch.style.clipPath).toBe('inset(0 0 calc(100% - 45px) 0)');
  });

  it('keeps the notch transparent and untextured in paginated mode', () => {
    const { container } = render(<SectionInfo {...baseProps} isScrolled={false} />);
    const notch = container.querySelector('.notch-area') as HTMLElement;

    expect(notch.classList.contains('notch-masked')).toBe(false);
    expect(notch.classList.contains('bg-base-100')).toBe(false);
  });

  it('keeps the notch transparent and untextured in vertical scrolled mode', () => {
    const { container } = render(<SectionInfo {...baseProps} isVertical={true} />);
    const notch = container.querySelector('.notch-area') as HTMLElement;

    expect(notch.classList.contains('notch-masked')).toBe(false);
    expect(notch.classList.contains('bg-base-100')).toBe(false);
  });

  it('keeps the notch transparent for fixed-layout documents so they render edge to edge', () => {
    // FXL pages in scrolled mode fill the screen and their chrome overlays the
    // page (mix-blend-difference title, #4901) instead of reserving bands. The
    // reflowable notch mask would paint an opaque strip over the page at the
    // camera hole / status bar, clipping the document.
    currentBookData = { isFixedLayout: true };
    const { container } = render(<SectionInfo {...baseProps} />);
    const notch = container.querySelector('.notch-area') as HTMLElement;

    expect(notch.classList.contains('notch-masked')).toBe(false);
    expect(notch.classList.contains('bg-base-100')).toBe(false);
    currentBookData = undefined;
  });
});

describe('SectionInfo title band on negative top margins (#5303)', () => {
  // Decreasing the top margin below 16px must lift the title band into the
  // notch instead of collapsing it (negative CSS height is invalid, so the
  // title used to stay put and overlap the book text). The band bottom always
  // equals the content top: max(topInset + marginTopPx, 16).
  it('keeps the classic geometry at the default 44px margin', () => {
    currentMarginTopPx = 44;
    const { container } = render(<SectionInfo {...baseProps} />);
    const info = container.querySelector('.sectioninfo') as HTMLElement;

    expect(info.style.top).toBe('45px');
    expect(info.style.height).toBe('44px');
  });

  it('lifts the band into the notch on a negative margin', () => {
    currentMarginTopPx = -20;
    const props = { ...baseProps, contentInsets: { top: 25, right: 0, bottom: 0, left: 0 } };
    const { container } = render(<SectionInfo {...props} />);
    const info = container.querySelector('.sectioninfo') as HTMLElement;

    expect(info.style.top).toBe('9px');
    expect(info.style.height).toBe('16px');
  });

  it('shrinks the scrolled-mode notch mask to the lifted content top', () => {
    // Content now starts inside the notch; a full-height mask would occlude it.
    currentMarginTopPx = -20;
    const props = { ...baseProps, contentInsets: { top: 25, right: 0, bottom: 0, left: 0 } };
    const { container } = render(<SectionInfo {...props} />);
    const notch = container.querySelector('.notch-area') as HTMLElement;

    expect(notch.style.clipPath).toBe('inset(0 0 calc(100% - 25px) 0)');
  });

  it('pins the band to the screen top at the negative-margin limit', () => {
    currentMarginTopPx = -45;
    const props = { ...baseProps, contentInsets: { top: 0, right: 0, bottom: 0, left: 0 } };
    const { container } = render(<SectionInfo {...props} />);
    const info = container.querySelector('.sectioninfo') as HTMLElement;
    const notch = container.querySelector('.notch-area') as HTMLElement;

    expect(info.style.top).toBe('0px');
    expect(info.style.height).toBe('16px');
    expect(notch.style.clipPath).toBe('inset(0 0 calc(100% - 16px) 0)');
  });

  it('stacks the title above the z-10 notch mask it now overlaps', () => {
    // The lifted band sits inside the mask strip in scrolled mode; without a
    // z-index of its own the z-10 mask paints over the title (z-auto loses to
    // any positive z sibling regardless of DOM order).
    currentMarginTopPx = -45;
    const { container } = render(<SectionInfo {...baseProps} />);
    const info = container.querySelector('.sectioninfo') as HTMLElement;

    expect(info.classList.contains('z-10')).toBe(true);
  });

  it('stays below the header toolbar when the band is not lifted', () => {
    // The desktop HeaderBar wrapper is z-auto, so its z-10 bar (and the z-20
    // button groups confined inside that stacking context) lose to a later
    // z-10 sibling. An unconditional z-10 here put the band over the toolbar
    // and its hover trigger, making the buttons unclickable (PR #5447 CI).
    currentMarginTopPx = 44;
    const { container } = render(<SectionInfo {...baseProps} />);
    const info = container.querySelector('.sectioninfo') as HTMLElement;

    expect(info.classList.contains('z-10')).toBe(false);
  });
});

describe('SectionInfo contrast against the page (#4901)', () => {
  // A light-mode PDF shown under a dark theme keeps its white page, so the
  // running header blends against the real backdrop (text-white/75 +
  // mix-blend-difference) to stay legible on any background. Reflowable books
  // theme their own page to the UI, so the header uses plain base-content text
  // instead of the blend.
  it('blends the section title over a fixed-layout page in non-eink mode', () => {
    currentBookData = { isFixedLayout: true };
    const { container } = render(<SectionInfo {...baseProps} isEink={false} />);
    const info = container.querySelector('.sectioninfo') as HTMLElement;

    expect(info.classList.contains('mix-blend-difference')).toBe(true);
    expect(info.classList.contains('text-white/75')).toBe(true);
  });

  it('uses themed base-content text for reflowable books in non-eink mode', () => {
    currentBookData = { isFixedLayout: false };
    const { container } = render(<SectionInfo {...baseProps} isEink={false} />);
    const info = container.querySelector('.sectioninfo') as HTMLElement;

    expect(info.classList.contains('mix-blend-difference')).toBe(false);
    expect(info.classList.contains('text-white/75')).toBe(false);
    expect(info.classList.contains('text-base-content')).toBe(true);
  });

  it('does not blend in eink mode (base-content text on the e-ink page)', () => {
    currentBookData = { isFixedLayout: true };
    const { container } = render(<SectionInfo {...baseProps} isEink={true} />);
    const info = container.querySelector('.sectioninfo') as HTMLElement;

    expect(info.classList.contains('mix-blend-difference')).toBe(false);
  });
});
