import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import SectionInfo from '@/app/reader/components/SectionInfo';

let currentBookData: { isFixedLayout: boolean } | undefined;

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
    getViewSettings: () => ({ marginTopPx: 44 }),
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
