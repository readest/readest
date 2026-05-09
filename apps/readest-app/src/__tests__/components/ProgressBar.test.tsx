import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ProgressBar from '@/app/reader/components/ProgressBar';
import { DEFAULT_VIEW_CONFIG } from '@/services/constants';
import type { ViewSettings } from '@/types/book';

const saveViewSettings = vi.fn();

let currentViewSettings: ViewSettings;

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { isMobile: false, hasSafeAreaInset: false } }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getProgress: () => null,
    getViewSettings: () => currentViewSettings,
    getView: () => ({ renderer: { page: 0, pages: 0 } }),
  }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getBookData: () => ({ isFixedLayout: false }),
  }),
}));

vi.mock('@/helpers/settings', () => ({
  saveViewSettings: (...args: unknown[]) => saveViewSettings(...args),
}));

vi.mock('@/utils/event', () => ({
  eventDispatcher: { dispatchSync: () => false },
}));

vi.mock('@/app/reader/components/StatusInfo.tsx', () => ({
  default: () => null,
}));

const baseSettings: ViewSettings = {
  ...DEFAULT_VIEW_CONFIG,
} as ViewSettings;

const renderProgressBar = () =>
  render(
    <ProgressBar
      bookKey='book-1'
      horizontalGap={0}
      contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }}
      gridInsets={{ top: 0, right: 0, bottom: 0, left: 0 }}
    />,
  );

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  saveViewSettings.mockClear();
});

describe('ProgressBar — tap-to-toggle disabled reverts hidden footer', () => {
  it("resets progressInfoMode to 'all' when the user disables tapToToggleFooter while mode was 'none'", () => {
    // Simulate a user who tapped the footer to dismiss it (mode='none')
    // while tapToToggleFooter was on. Now they have it switched off.
    currentViewSettings = {
      ...baseSettings,
      tapToToggleFooter: false,
      progressInfoMode: 'none',
    } as ViewSettings;

    renderProgressBar();

    // The persisted progressInfoMode should be reset to the default
    // ('all') so the footer reverts to its default visibility.
    const persistCalls = saveViewSettings.mock.calls.filter(
      (args) => args[2] === 'progressInfoMode',
    );
    expect(persistCalls.length).toBeGreaterThanOrEqual(1);
    const lastCall = persistCalls[persistCalls.length - 1]!;
    expect(lastCall[3]).toBe('all');
  });

  it("does not overwrite mode when tapToToggleFooter is on (user's cycled state stays)", () => {
    currentViewSettings = {
      ...baseSettings,
      tapToToggleFooter: true,
      progressInfoMode: 'none',
    } as ViewSettings;

    renderProgressBar();

    // initial save mirrors the existing mode; importantly we never see
    // a save with 'all' overriding the user's tap-cycled choice.
    const persistCalls = saveViewSettings.mock.calls.filter(
      (args) => args[2] === 'progressInfoMode',
    );
    expect(persistCalls.every((args) => args[3] === 'none')).toBe(true);
  });

  it("leaves mode untouched when tapToToggleFooter is off but mode is already 'all'", () => {
    currentViewSettings = {
      ...baseSettings,
      tapToToggleFooter: false,
      progressInfoMode: 'all',
    } as ViewSettings;

    renderProgressBar();

    const persistCalls = saveViewSettings.mock.calls.filter(
      (args) => args[2] === 'progressInfoMode',
    );
    // Either no save or a save matching the existing 'all' value — never
    // a transition through some intermediate state.
    expect(persistCalls.every((args) => args[3] === 'all')).toBe(true);
  });
});
