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
      statusBarHiddenInsets: { width: 951, height: 669, left: 0, right: 0 },
    });
    const toolbarHidden = getCurrentRendererLayout(settings);

    // Opening the toolbar shows the status bar, which brings back the 84pt strip.
    useThemeStore.setState({ safeAreaInsets: { ...hidden, left: 84 } });

    expect(toolbarHidden.maxInlineSize).toBe(713);
    expect(getCurrentRendererLayout(settings)).toEqual(toolbarHidden);
  });
});
