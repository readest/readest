// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import ContentNavBar from '@/app/reader/components/sidebar/ContentNavBar';
import { DEFAULT_BOOK_LAYOUT, DEFAULT_VIEW_CONFIG } from '@/services/constants';
import type { ViewSettings } from '@/types/book';

const mocks = vi.hoisted(() => ({
  viewSettings: null as unknown,
  ttsEnabled: false,
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: null }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getViewSettings: () => mocks.viewSettings,
    getViewState: () => ({ ttsEnabled: mocks.ttsEnabled }),
  }),
}));

const settings = (overrides: Partial<ViewSettings> = {}): ViewSettings =>
  ({ ...DEFAULT_VIEW_CONFIG, ...DEFAULT_BOOK_LAYOUT, ...overrides }) as ViewSettings;

// The search-results / notes bar (#7841) sits on the bottom edge of the page.
// With the footer line there it must clear it, as the TTS mini player does.
const navBarBottom = (
  viewSettings: ViewSettings,
  { ttsEnabled = false, insetBottom = 0 } = {},
): string => {
  mocks.viewSettings = viewSettings;
  mocks.ttsEnabled = ttsEnabled;
  const { container } = render(
    <ContentNavBar
      bookKey='book1'
      gridInsets={{ top: 0, right: 0, bottom: insetBottom, left: 0 }}
      title='Annotations'
      hasPrevious
      hasNext
      onClose={() => {}}
      onPrevious={() => {}}
      onNext={() => {}}
    />,
  );
  return container.querySelector<HTMLElement>('.results-nav-bar')!.style.bottom;
};

afterEach(() => cleanup());

describe('ContentNavBar placement over the footer (#7841)', () => {
  it('sits above the footer line when Show Footer is on', () => {
    expect(navBarBottom(settings({ showFooter: true, marginBottomPx: 44 }))).toBe('44px');
  });

  it('keeps the safe-area share on top of the footer clearance', () => {
    expect(
      navBarBottom(settings({ showFooter: true, marginBottomPx: 44 }), { insetBottom: 40 }),
    ).toBe('54px');
  });

  it('stays on the bottom edge with Show Footer off', () => {
    expect(navBarBottom(settings({ showFooter: false }))).toBe('0px');
    expect(navBarBottom(settings({ showFooter: false }), { insetBottom: 40 })).toBe('10px');
  });

  it('stays on the bottom edge in vertical books, where the footer is a side column', () => {
    expect(navBarBottom(settings({ showFooter: true, vertical: true }))).toBe('0px');
  });

  it('stays on the bottom edge when the footer shows nothing there', () => {
    expect(
      navBarBottom(
        settings({
          showFooter: true,
          showRemainingTime: false,
          showRemainingPages: false,
          showProgressInfo: false,
          showCurrentTime: false,
          showCurrentBatteryStatus: false,
          showStickyProgressBar: false,
        }),
      ),
    ).toBe('0px');
  });

  it('stacks above the minimal Read Aloud card, which already sits on the footer', () => {
    const minimal = settings({ showFooter: true, marginBottomPx: 44, ttsPlayerStyle: 'minimal' });
    expect(navBarBottom(minimal, { ttsEnabled: true })).toBe('100px');
    expect(navBarBottom(minimal, { ttsEnabled: false })).toBe('44px');
    expect(navBarBottom({ ...minimal, showFooter: false }, { ttsEnabled: true })).toBe('72px');
  });

  it('ignores the full Read Aloud card, which hides with the toolbar', () => {
    expect(
      navBarBottom(settings({ showFooter: true, marginBottomPx: 44, ttsPlayerStyle: 'full' }), {
        ttsEnabled: true,
      }),
    ).toBe('44px');
  });
});
