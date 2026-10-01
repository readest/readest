import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import SectionInfo from '@/app/reader/components/SectionInfo';

const h = vi.hoisted(() => ({ isIPhoneDuo: false }));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { isAndroidApp: false, isMobile: true } }),
}));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({
    systemUIVisible: false,
    statusBarHeight: 0,
    isIPhoneDuo: h.isIPhoneDuo,
  }),
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
  const state = { getBookData: () => undefined };
  return {
    useBookDataStore: <R,>(selector?: (s: typeof state) => R) =>
      selector ? selector(state) : state,
  };
});
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));

afterEach(cleanup);

const bandStyle = (isIPhoneDuo: boolean) => {
  h.isIPhoneDuo = isIPhoneDuo;
  const { container } = render(
    <SectionInfo
      bookKey='book-1'
      section='Chapter 1'
      showDoubleBorder={false}
      isScrolled={false}
      isVertical={false}
      isEink={false}
      horizontalGap={5}
      contentInsets={{ top: 45, right: 100, bottom: 0, left: 16 }}
      gridInsets={{ top: 45, right: 84, bottom: 0, left: 0 }}
    />,
  );
  return (container.querySelector('.sectioninfo') as HTMLElement).style;
};

describe('SectionInfo horizontal padding', () => {
  it('on the Duo pads each physical side from its own inset (#6307)', () => {
    const style = bandStyle(true);
    expect(style.paddingLeft).toBe('calc(2.5% + 8px)');
    expect(style.paddingRight).toBe('calc(2.5% + 92px)');
  });

  it('off the Duo keeps main: one inline padding from the left content inset on both sides', () => {
    const style = bandStyle(false);
    // jsdom cannot read the logical `padding-inline` shorthand back, so assert
    // that none of the Duo's physical per-side paddings is set.
    expect(style.paddingLeft).toBe('');
    expect(style.paddingRight).toBe('');
  });
});
