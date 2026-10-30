import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_BOOK_LAYOUT } from '@/services/constants';
import { useThemeStore } from '@/store/themeStore';
import { ViewSettings } from '@/types/book';
import { getCurrentRendererLayout } from '@/hooks/useDuoPose';

const settings = { ...DEFAULT_BOOK_LAYOUT, maxInlineSize: 720 } as ViewSettings;

afterEach(() => vi.unstubAllGlobals());

describe('getCurrentRendererLayout', () => {
  it('keeps the book pose layout while the toolbar shows the side status strip', () => {
    vi.stubGlobal('innerWidth', 951);
    vi.stubGlobal('innerHeight', 669);
    const hidden = { top: 0, right: 0, bottom: 20, left: 0 };
    useThemeStore.setState({
      isIPhoneDuo: true,
      duoFold: { status: 'open', regionActive: false },
      safeAreaInsets: hidden,
      statusBarHiddenInsets: { '951x669': { width: 951, height: 669, top: 0, left: 0, right: 0 } },
    });
    const toolbarHidden = getCurrentRendererLayout(settings);

    // Opening the toolbar shows the status bar, which brings back the 84pt strip.
    useThemeStore.setState({ safeAreaInsets: { ...hidden, left: 84 } });

    expect(toolbarHidden.maxInlineSize).toBe(713);
    expect(getCurrentRendererLayout(settings)).toEqual(toolbarHidden);
  });
});

describe('status-bar-hidden insets across rotations', () => {
  it('keeps the record for each window size, so turning back finds it', () => {
    const hidden = { top: 0, right: 0, bottom: 20, left: 0 };
    useThemeStore.setState({
      isIPhoneDuo: true,
      duoFold: { status: 'open', regionActive: false },
      statusBarHiddenInsets: null,
    });
    vi.stubGlobal('innerWidth', 951);
    vi.stubGlobal('innerHeight', 669);
    useThemeStore.getState().recordStatusBarHiddenInsets(hidden);
    vi.stubGlobal('innerWidth', 669);
    vi.stubGlobal('innerHeight', 951);
    useThemeStore.getState().recordStatusBarHiddenInsets(hidden);

    // Back in landscape, with the toolbar up and its 84pt strip showing.
    vi.stubGlobal('innerWidth', 951);
    vi.stubGlobal('innerHeight', 669);
    useThemeStore.setState({ safeAreaInsets: { ...hidden, left: 84 } });

    expect(getCurrentRendererLayout(settings).maxInlineSize).toBe(713);
  });
});
