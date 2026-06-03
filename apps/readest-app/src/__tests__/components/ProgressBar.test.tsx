import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ProgressBar from '@/app/reader/components/ProgressBar';
import { DEFAULT_VIEW_CONFIG } from '@/services/constants';
import type { BookProgress, ViewSettings } from '@/types/book';

const saveViewSettings = vi.fn();

let currentViewSettings: ViewSettings;
let currentProgress: BookProgress | null;
let currentBookData: {
  isFixedLayout: boolean;
  bookDoc?: { metadata?: Record<string, unknown> };
} | null;
let currentRenderer: { page: number; pages: number };

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string, values?: Record<string, unknown>) =>
    s
      .replace('{{count}}', String(values?.['count'] ?? '{{count}}'))
      .replace('{{number}}', String(values?.['number'] ?? '{{number}}'))
      .replace('{{time}}', String(values?.['time'] ?? '{{time}}')),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { isMobile: false, hasSafeAreaInset: false } }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getProgress: () => currentProgress,
    getViewSettings: () => currentViewSettings,
    getView: () => ({ renderer: currentRenderer }),
  }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getBookData: () => currentBookData,
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
  currentProgress = null;
  currentBookData = { isFixedLayout: false };
  currentRenderer = { page: 0, pages: 0 };
});

const makeProgress = (current: number, total: number): BookProgress =>
  ({
    section: { current, total },
    pageinfo: { current, total },
    timeinfo: { section: 0, total: 0 },
  }) as BookProgress;

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

describe('ProgressBar — fixed-layout remaining pages', () => {
  it('says "in book" with section-derived count for fixed-layout books', () => {
    currentViewSettings = {
      ...baseSettings,
      showRemainingPages: true,
      showRemainingTime: false,
      progressInfoMode: 'all',
    } as ViewSettings;
    currentProgress = makeProgress(2, 5);
    currentBookData = { isFixedLayout: true, bookDoc: { metadata: {} } };

    const { container } = renderProgressBar();

    expect(container.querySelector('.progressinfo')?.getAttribute('aria-label')).toContain(
      '3 pages left in book',
    );
  });

  it('says "in chapter" for reflowable books', () => {
    currentViewSettings = {
      ...baseSettings,
      showRemainingPages: true,
      showRemainingTime: false,
      progressInfoMode: 'all',
    } as ViewSettings;
    currentProgress = makeProgress(2, 5);
    currentBookData = { isFixedLayout: false };
    currentRenderer = { page: 1, pages: 4 };

    const { container } = renderProgressBar();

    expect(container.querySelector('.progressinfo')?.getAttribute('aria-label')).toContain(
      'pages left in chapter',
    );
  });
});

describe('ProgressBar — decorative footer is not focusable', () => {
  it('does not make the progress info container focusable (no stray focus ring)', () => {
    // The footer info is a decorative role="presentation" element. A negative
    // tabindex made it focusable, so long-pressing it on Android focused the
    // div and the WebView painted its default focus ring as a persistent line
    // across the bottom of the page (issue #4397). A decorative element must
    // not be focusable so it can never receive a focus ring.
    currentViewSettings = {
      ...baseSettings,
      progressInfoMode: 'all',
    } as ViewSettings;
    currentProgress = makeProgress(2, 5);
    currentBookData = { isFixedLayout: false };
    currentRenderer = { page: 1, pages: 4 };

    const { container } = renderProgressBar();

    const progressInfo = container.querySelector('.progressinfo');
    expect(progressInfo).not.toBeNull();
    expect(progressInfo!.hasAttribute('tabindex')).toBe(false);
  });
});
