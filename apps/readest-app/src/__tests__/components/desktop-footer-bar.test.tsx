import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import DesktopFooterBar from '@/app/reader/components/footerbar/DesktopFooterBar';
import type { FooterBarChildProps } from '@/app/reader/components/footerbar/types';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: null }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    hoveredBookKey: 'book1',
    getView: () => null,
    getViewState: () => null,
    getViewSettings: () => null,
  }),
}));

vi.mock('@/app/reader/components/footerbar/PageJumpInput', () => ({
  default: () => <span data-testid='page-label' />,
}));

const props = (progressValid: boolean): FooterBarChildProps => ({
  bookKey: 'book1',
  progressValid,
  progressFraction: progressValid ? 0.5 : 0,
  gridInsets: { top: 0, right: 0, bottom: 0, left: 0 },
  actionTab: '',
  forceMobileLayout: false,
  onSetActionTab: () => {},
  onSpeakText: () => {},
  navigationHandlers: {
    onPrevPage: () => {},
    onNextPage: () => {},
    onPrevSection: () => {},
    onNextSection: () => {},
    onGoBack: () => {},
    onGoForward: () => {},
    onProgressChange: () => {},
  },
});

afterEach(() => cleanup());

describe('DesktopFooterBar', () => {
  it('keeps the page label mounted while progress is momentarily invalid (#6646)', () => {
    const { rerender, getByTestId } = render(<DesktopFooterBar {...props(true)} />);
    const label = getByTestId('page-label');
    rerender(<DesktopFooterBar {...props(false)} />);
    expect(getByTestId('page-label')).toBe(label);
  });
});
