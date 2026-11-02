import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import DesktopFooterBar from '@/app/reader/components/footerbar/DesktopFooterBar';
import type { FooterBarChildProps } from '@/app/reader/components/footerbar/types';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: null }),
}));

const mocks = vi.hoisted(() => ({ progress: {} as object }));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    hoveredBookKey: 'book1',
    getView: () => null,
    getViewState: () => null,
    getProgress: () => mocks.progress,
    getViewSettings: () => null,
  }),
}));

vi.mock('@/app/reader/components/footerbar/PageJumpInput', () => ({
  default: ({ previewFraction }: { previewFraction?: number | null }) => (
    <span data-testid='page-label' data-preview={previewFraction ?? ''} />
  ),
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

  it('previews the slider position in the page label until the reader relocates (#7075)', () => {
    const { rerender, getByTestId, getByRole } = render(<DesktopFooterBar {...props(true)} />);
    expect(getByTestId('page-label').dataset['preview']).toBe('');
    fireEvent.change(getByRole('slider'), { target: { value: '80' } });
    expect(getByTestId('page-label').dataset['preview']).toBe('0.8');
    mocks.progress = {};
    rerender(<DesktopFooterBar {...props(true)} />);
    expect(getByTestId('page-label').dataset['preview']).toBe('');
  });
});
