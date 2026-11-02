import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { NavigationPanel } from '@/app/reader/components/footerbar/NavigationPanel';

const mocks = vi.hoisted(() => ({ progress: {} as object }));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: null }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => null,
    getProgress: () => mocks.progress,
    getViewSettings: () => null,
  }),
}));

vi.mock('@/app/reader/components/footerbar/PageJumpInput', () => ({
  default: ({ previewFraction }: { previewFraction?: number | null }) => (
    <span data-testid='page-label' data-preview={previewFraction ?? ''} />
  ),
}));

const noop = () => {};
const panel = () => (
  <NavigationPanel
    bookKey='book1'
    actionTab='progress'
    progressFraction={0.5}
    progressValid
    bottomOffset='0px'
    sliderHeight={28}
    forceMobileLayout
    navigationHandlers={{
      onPrevPage: noop,
      onNextPage: noop,
      onPrevSection: noop,
      onNextSection: noop,
      onGoBack: noop,
      onGoForward: noop,
      onProgressChange: noop,
    }}
  />
);

afterEach(() => cleanup());

describe('NavigationPanel', () => {
  it('previews the slider position in the page pill until the reader relocates (#7075)', () => {
    const { rerender, getByTestId, getByRole } = render(panel());
    expect(getByTestId('page-label').dataset['preview']).toBe('');
    fireEvent.change(getByRole('slider'), { target: { value: '80' } });
    expect(getByTestId('page-label').dataset['preview']).toBe('0.8');
    mocks.progress = {};
    rerender(panel());
    expect(getByTestId('page-label').dataset['preview']).toBe('');
  });
});
