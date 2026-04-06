/**
 * Visual regression test for the AnnotationPopup component.
 *
 * Renders the *real* AnnotationPopup + HighlightOptions with actual
 * annotationToolButtons, DEFAULT_HIGHLIGHT_COLORS, and optional user
 * colors.  Tailwind CSS is loaded so the screenshot matches the live app.
 *
 * Guards against the layout regression from PR #3741 (missing
 * `justify-between`, unwanted `flex-1` on the color strip).
 */

import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { page } from 'vitest/browser';
import type { UserHighlightColor } from '@/types/book';

// ── Tailwind / DaisyUI styles ───────────────────────────────────────────
import '@/styles/globals.css';

// ── Per-test state read by mocks ────────────────────────────────────────
let mockUserColors: UserHighlightColor[] = [];

// ── Mocks (must be before component imports) ────────────────────────────

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: null }),
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ isDarkMode: false }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {
      globalReadSettings: {
        highlightStyle: 'highlight' as const,
        highlightStyles: {
          highlight: 'yellow',
          underline: 'red',
          squiggly: 'blue',
        },
        customHighlightColors: {} as Record<string, string>,
        get userHighlightColors() {
          return mockUserColors;
        },
        defaultHighlightLabels: {},
      },
      globalViewSettings: {
        isEink: false,
        isColorEink: false,
      },
    },
  }),
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (n: number) => n,
  useDefaultIconSize: () => 20,
}));

vi.mock('@/hooks/useKeyDownActions', () => ({
  useKeyDownActions: () => {},
}));

vi.mock('@/helpers/settings', () => ({
  saveSysSettings: vi.fn(),
}));

vi.mock('@/app/reader/utils/annotatorUtil', () => ({
  getHighlightColorLabel: () => undefined,
}));

// ── Real component imports ──────────────────────────────────────────────

import AnnotationPopup from '@/app/reader/components/annotator/AnnotationPopup';
import { annotationToolButtons } from '@/app/reader/components/annotator/AnnotationTools';

// ── Constants ───────────────────────────────────────────────────────────

const POPUP_W = 300;
const POPUP_H = 44;

// Highlight options float above the popup by (28 + 16) = 44px
const OPTIONS_OFFSET = 28 + 16;

// Position the popup so both it and the floating options are visible:
//   y=0..OPTIONS_OFFSET: highlight-options row
//   y=OPTIONS_OFFSET..OPTIONS_OFFSET+POPUP_H: toolbar
const POPUP_Y = OPTIONS_OFFSET;
const POPUP_X = 0;
const WRAPPER_H = POPUP_Y + POPUP_H + 14; // +14 for triangle below

const toolButtons = annotationToolButtons.map(({ label, Icon }) => ({
  tooltipText: label,
  Icon,
  onClick: vi.fn(),
}));

// Browser-mode matcher types are unavailable to tsgo; cast once here.
const expectElement = (locator: unknown) =>
  // @ts-expect-error -- expect.element() exists in vitest browser mode
  expect.element(locator) as { toMatchScreenshot: (name: string) => Promise<void> };

/**
 * Fixed-size wrapper that contains both the popup and the absolutely
 * positioned highlight-options row above it, matching the real app
 * where the triangle points up and highlight options float above.
 */
const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    data-theme='dark'
    style={{
      position: 'relative',
      width: POPUP_W,
      height: WRAPPER_H,
      overflow: 'visible',
    }}
  >
    {children}
  </div>
);

const renderPopup = (userColors: UserHighlightColor[] = []) => {
  mockUserColors = userColors;
  return render(
    <Wrapper>
      <AnnotationPopup
        bookKey='test'
        dir='ltr'
        isVertical={false}
        buttons={toolButtons}
        notes={[]}
        position={{ dir: 'up', point: { x: POPUP_X, y: POPUP_Y } }}
        trianglePosition={{ dir: 'up', point: { x: POPUP_X + POPUP_W / 2, y: POPUP_Y + POPUP_H } }}
        highlightOptionsVisible
        selectedStyle='highlight'
        selectedColor='yellow'
        popupWidth={POPUP_W}
        popupHeight={POPUP_H}
        onHighlight={vi.fn()}
        onDismiss={vi.fn()}
      />
    </Wrapper>,
  );
};

// ── Lifecycle ───────────────────────────────────────────────────────────

beforeAll(async () => {
  await page.viewport(800, 600);
});

beforeEach(() => {
  mockUserColors = [];
});

afterEach(() => {
  cleanup();
});

// ── Tests ───────────────────────────────────────────────────────────────

describe('AnnotationPopup layout screenshot', () => {
  it('default 5 colors — compact color strip, large gap', async () => {
    const { container } = renderPopup();
    const wrapper = container.firstElementChild as HTMLElement;
    await expectElement(page.elementLocator(wrapper)).toMatchScreenshot(
      'annotation-popup-5-colors',
    );
  });

  it('5+5 user colors — color strip grows, gap shrinks', async () => {
    const { container } = renderPopup([
      { hex: '#f97316' },
      { hex: '#06b6d4' },
      { hex: '#ec4899' },
      { hex: '#14b8a6' },
      { hex: '#f43f5e' },
    ]);
    const wrapper = container.firstElementChild as HTMLElement;
    await expectElement(page.elementLocator(wrapper)).toMatchScreenshot(
      'annotation-popup-10-colors',
    );
  });

  it('5+10 user colors — color strip at max, overflow scrolls', async () => {
    const { container } = renderPopup([
      { hex: '#f97316' },
      { hex: '#06b6d4' },
      { hex: '#ec4899' },
      { hex: '#14b8a6' },
      { hex: '#f43f5e' },
      { hex: '#a855f7' },
      { hex: '#84cc16' },
      { hex: '#0ea5e9' },
      { hex: '#e11d48' },
      { hex: '#6366f1' },
    ]);
    const wrapper = container.firstElementChild as HTMLElement;
    await expectElement(page.elementLocator(wrapper)).toMatchScreenshot(
      'annotation-popup-15-colors',
    );
  });
});
