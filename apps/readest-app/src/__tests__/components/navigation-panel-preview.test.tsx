// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Profiler } from 'react';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { NavigationPanel } from '@/app/reader/components/footerbar/NavigationPanel';

// A store hook called with a selector, or without one for the whole state.
const { storeHook } = vi.hoisted(() => ({
  storeHook:
    <T extends object>(state: () => T) =>
    (select?: (s: T) => unknown) =>
      select ? select(state()) : state(),
}));

const mocks = vi.hoisted(() => ({ progress: {} as object }));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: null }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: storeHook(() => ({
    viewStates: {},
    getView: () => null,
    getProgress: () => mocks.progress,
    getViewSettings: () => null,
  })),
}));

vi.mock('@/app/reader/components/footerbar/PageJumpInput', () => ({
  default: ({ previewFraction }: { previewFraction?: number | null }) => (
    <span data-testid='page-label' data-preview={previewFraction ?? ''} />
  ),
}));

const noop = () => {};
const panel = (actionTab = 'progress', progressFraction = 0.5) => (
  <NavigationPanel
    bookKey='book1'
    actionTab={actionTab}
    progressFraction={progressFraction}
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

  // The panel is invisible until its tab opens. A slider that followed every
  // page turn there changed the page's DOM in two extra React commits per turn,
  // and on e-ink each change is a screen refresh that shows nothing.
  it('keeps a closed panel still while pages turn', () => {
    let commits = 0;
    const counted = (tab: string, fraction: number) => (
      <Profiler id='panel' onRender={() => commits++}>
        {panel(tab, fraction)}
      </Profiler>
    );
    const { rerender, getByRole } = render(counted('', 0.5));
    const valueNow = () => getByRole('slider').getAttribute('aria-valuenow');
    expect(valueNow()).toBe('50');

    commits = 0;
    rerender(counted('', 0.6));
    expect(valueNow()).toBe('50');
    expect(commits).toBe(1);

    // opening the panel shows the current position in the commit that opens it
    commits = 0;
    rerender(counted('progress', 0.6));
    expect(valueNow()).toBe('60');
    expect(commits).toBe(1);

    // an open panel follows a page turn in that turn's commit
    commits = 0;
    rerender(counted('progress', 0.7));
    expect(valueNow()).toBe('70');
    expect(commits).toBe(1);
  });
});
