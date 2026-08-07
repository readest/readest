import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import HintInfo from '@/app/reader/components/HintInfo';
import SectionInfo from '@/app/reader/components/SectionInfo';

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
  const state = { getBookData: () => ({ isFixedLayout: false }) };
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
  showDoubleBorder: false,
  isScrolled: false,
  isVertical: false,
  isEink: false,
  horizontalGap: 5,
  contentInsets: { top: 89, right: 10, bottom: 0, left: 10 },
  gridInsets: { top: 45, right: 0, bottom: 0, left: 0 },
};

const renderBands = (marginTopPx: number) => {
  currentMarginTopPx = marginTopPx;
  const contentInsets = { ...baseProps.contentInsets, top: baseProps.gridInsets.top + marginTopPx };
  const props = { ...baseProps, contentInsets };
  const hint = render(<HintInfo {...props} />).container.querySelector('.hintinfo') as HTMLElement;
  const section = render(<SectionInfo {...props} section='Chapter 4' />).container.querySelector(
    '.sectioninfo',
  ) as HTMLElement;
  return { hint, section };
};

describe('HintInfo shares the header title band', () => {
  // The transient hint ("Reading Progress Synced") is rendered opposite the
  // section title in the same header band, so it has to follow the band when
  // the top margin moves it. Pinned to a fixed 44px strip it drifted below the
  // title on any smaller margin.
  it('matches the section title band at the default 44px margin', () => {
    const { hint, section } = renderBands(44);

    expect(hint.style.top).toBe(section.style.top);
    expect(hint.style.height).toBe(section.style.height);
    expect(hint.style.top).toBe('45px');
    expect(hint.style.height).toBe('44px');
  });

  it('follows the band when the top margin shrinks', () => {
    const { hint, section } = renderBands(20);

    expect(hint.style.top).toBe(section.style.top);
    expect(hint.style.height).toBe(section.style.height);
    expect(hint.style.height).toBe('20px');
  });

  it('lifts into the notch with the title on a negative margin', () => {
    const { hint, section } = renderBands(-20);

    expect(hint.style.top).toBe(section.style.top);
    expect(hint.style.height).toBe(section.style.height);
    expect(hint.style.top).toBe('9px');
    expect(hint.style.height).toBe('16px');
  });
});
