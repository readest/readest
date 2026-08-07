import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';

/**
 * Scrolled mode is supported for fixed-layout books: the view menu's Zoom Mode
 * row turns it on (vertical / horizontal scrolling, Webtoon Mode forces it),
 * and the renderer has a whole scrolled-FXL path behind it (#4795 preload
 * scheduler, #4817 pinch-zoom). Settings > Behavior > Scroll kept the original
 * `disabled={bookData?.isFixedLayout}` from before that support landed, so the
 * one place a reader looks for the toggle was the one place it was dead.
 */

let currentIsFixedLayout = false;

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { isMobileApp: false } }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

const stubView = {
  renderer: {
    setAttribute: vi.fn(),
    removeAttribute: vi.fn(),
    hasAttribute: () => false,
    setStyles: vi.fn(),
  },
};

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => stubView,
    getViews: () => [],
    getViewSettings: () => ({ scrolled: false, noContinuousScroll: false }),
    recreateViewer: vi.fn(),
  }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getBookData: () => ({ isFixedLayout: currentIsFixedLayout, book: { format: 'PDF' } }),
  }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { globalViewSettings: {} } }),
}));

vi.mock('@/hooks/useResetSettings', () => ({
  useResetViewSettings: () => vi.fn(),
}));

vi.mock('@/hooks/useEinkMode', () => ({
  useEinkMode: () => ({ applyEinkMode: vi.fn() }),
}));

vi.mock('@/helpers/settings', () => ({
  saveViewSettings: vi.fn(),
  saveSysSettings: vi.fn(),
}));

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => false,
}));

vi.mock('@/utils/share', () => ({
  canShareText: () => true,
}));

vi.mock('@/utils/telemetry', () => ({
  optInTelemetry: vi.fn(),
  optOutTelemetry: vi.fn(),
}));

// Unrelated to the Scroll section and pulls in the device-control store.
vi.mock('@/components/settings/PageTurnerSettings', () => ({
  default: () => null,
}));

vi.mock('@/utils/style', () => ({ getStyles: () => '' }));
vi.mock('@/utils/config', () => ({ getMaxInlineSize: () => 720 }));

const applyPageTurnAttributes = vi.fn();
vi.mock('@/app/reader/hooks/useCapturedTurn', () => ({
  applyPageTurnAttributes: (...args: unknown[]) => applyPageTurnAttributes(...args),
}));

import ControlPanel from '@/components/settings/ControlPanel';

const scrolledModeSwitch = () =>
  screen.getByText('Scrolled Mode').closest('label')?.querySelector('input') ??
  (screen.getByText('Scrolled Mode').closest('div')?.querySelector('input') as HTMLInputElement);

afterEach(() => {
  cleanup();
  currentIsFixedLayout = false;
  applyPageTurnAttributes.mockClear();
});

describe('Settings > Behavior > Scroll', () => {
  it('offers Scrolled Mode for a fixed-layout book (PDF / CBZ)', () => {
    currentIsFixedLayout = true;
    render(<ControlPanel bookKey='test' onRegisterReset={() => {}} />);

    expect(scrolledModeSwitch()?.disabled).toBe(false);
  });

  it('offers Scrolled Mode for a reflowable book', () => {
    currentIsFixedLayout = false;
    render(<ControlPanel bookKey='test' onRegisterReset={() => {}} />);

    expect(scrolledModeSwitch()?.disabled).toBe(false);
  });
});

describe('Scrolled Mode and the page-turn attributes', () => {
  // `scrolled` is an input to getCapturedTurnStyle, so it decides which engine
  // owns a swipe: the app's captured turn (turn-style removed, no-swipe set,
  // captured-turn-style set) or the paginator's own View Transition
  // (turn-style set, no-swipe cleared). Every other input to that decision —
  // animated, pageTurnStyle, disableSwipe — re-applies the attributes when it
  // changes; `scrolled` did not.
  //
  // Left stale, the renderer keeps the scrolled configuration back in
  // paginated mode: the paginator animates the swipe itself AND the touch
  // interceptor, which recomputes eligibility live rather than reading the
  // attribute, runs a captured turn over the top. Device-reproduced on a
  // Xiaomi 13 — one frame held three page numbers, 59 / 59 / 60.
  it('re-applies the turn attributes when Scrolled Mode is toggled', () => {
    render(<ControlPanel bookKey='test' onRegisterReset={() => {}} />);
    applyPageTurnAttributes.mockClear();

    fireEvent.click(scrolledModeSwitch()!);

    expect(applyPageTurnAttributes).toHaveBeenCalled();
  });
});
