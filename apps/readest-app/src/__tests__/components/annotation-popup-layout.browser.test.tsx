/**
 * Visual regression test for the AnnotationPopup component.
 *
 * Renders the *real* AnnotationPopup + HighlightOptions with actual
 * annotationToolButtons, DEFAULT_HIGHLIGHT_COLORS, and optional user
 * colors.  Tailwind CSS is loaded so the screenshot matches the live app.
 *
 * Guards edge alignment, compact spacing, and action-dependent minimum color visibility.
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
  // AnnotationPopup -> AnnotationNotes -> AnnotationNoteItem ->
  // useSaveBooknoteNoteText imports these; a browser-mode mock is a strict
  // ESM module, so every named import along the chain must exist.
  decideNoteBubbleTransition: () => 'none',
  applyNoteBubbleTransition: () => {},
}));

// ── Real component imports ──────────────────────────────────────────────

import AnnotationPopup from '@/app/reader/components/annotator/AnnotationPopup';
import { annotationToolButtons } from '@/app/reader/components/annotator/AnnotationTools';
import { DEFAULT_ANNOTATION_TOOLBAR_ITEMS } from '@/utils/annotationToolbar';

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

// Render the default-enabled tools (Share is hidden by default; users add it
// via Customize Toolbar), matching what the popup shows out of the box.
const toolButtons = annotationToolButtons
  .filter((button) => DEFAULT_ANNOTATION_TOOLBAR_ITEMS.includes(button.type))
  .map(({ label, Icon }) => ({
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
  // One of the app's own themes, not daisyUI's stock `dark`: the stock palette
  // is daisyUI's to change between releases (it did in v5), while the app's
  // themes are pinned in themes.ts.
  <div
    data-theme='default-dark'
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

const renderPopup = (
  userColors: UserHighlightColor[] = [],
  compact = false,
  isVertical = false,
  globalToggleAvailable = false,
  actionCount = compact ? 4 : toolButtons.length,
) => {
  mockUserColors = userColors;
  return render(
    <Wrapper>
      <AnnotationPopup
        bookKey='test'
        dir='ltr'
        isVertical={isVertical}
        buttons={toolButtons.slice(0, actionCount)}
        notes={[]}
        position={{ dir: 'up', point: { x: POPUP_X, y: POPUP_Y } }}
        trianglePosition={{ dir: 'up', point: { x: POPUP_X + POPUP_W / 2, y: POPUP_Y + POPUP_H } }}
        highlightOptionsVisible
        selectedStyle='highlight'
        selectedColor='yellow'
        popupWidth={
          compact ? (globalToggleAvailable ? 236 : 202) : actionCount === 5 ? 236 : POPUP_W
        }
        popupHeight={POPUP_H}
        globalToggleAvailable={globalToggleAvailable}
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
  it('default 5 colors — controls align with toolbar edges', async () => {
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

  it('5+10 user colors — extra colors scroll', async () => {
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

// ── Anchoring ───────────────────────────────────────────────────────────

// The popup is handed coordinates in the coordinate space of the book cell
// (`#gridcell-<bookKey>`, `position: relative`): Annotator subtracts that
// cell's rect in getPosition/getPopupPosition. Its own wrapper therefore must
// not become a viewport-anchored containing block, or the toolbar renders
// `cell.left` px off the selection — which is what a `fixed inset-0` stacking
// wrapper did (#6036), visible as soon as the sidebar pushes the cell off the
// viewport origin.
const CELL_LEFT = 240;
const CELL_TOP = 32;
const ANCHOR = { x: 120, y: 90 };

const renderInCell = (extra?: React.ReactNode) =>
  render(
    <div
      id='gridcell-test'
      style={{
        position: 'relative',
        marginLeft: CELL_LEFT,
        marginTop: CELL_TOP,
        width: 500,
        height: 400,
      }}
    >
      <AnnotationPopup
        bookKey='test'
        dir='ltr'
        isVertical={false}
        buttons={toolButtons}
        notes={[]}
        position={{ dir: 'down', point: ANCHOR }}
        trianglePosition={{ dir: 'down', point: { x: ANCHOR.x + POPUP_W / 2, y: ANCHOR.y } }}
        highlightOptionsVisible={false}
        selectedStyle='highlight'
        selectedColor='yellow'
        popupWidth={POPUP_W}
        popupHeight={POPUP_H}
        onHighlight={vi.fn()}
        onDismiss={vi.fn()}
      />
      {extra}
    </div>,
  );

describe('AnnotationPopup anchoring', () => {
  it('anchors to the book cell it is positioned against, not the viewport', () => {
    const { container } = renderInCell();
    const cell = container.querySelector('#gridcell-test') as HTMLElement;
    const popup = container.querySelector('#popup-container') as HTMLElement;
    const cellRect = cell.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    expect({
      x: Math.round(popupRect.left - cellRect.left),
      y: Math.round(popupRect.top - cellRect.top),
    }).toEqual(ANCHOR);
  });

  it('still yields the pixels it shares with the z-[44] handle layer', () => {
    const { container } = renderInCell(
      // Stand-in for SelectionRangeEditor/AnnotationRangeEditor, which draw
      // their grab handles over the selection the toolbar opens on. Inline
      // styles, not Tailwind classes: this file is not a Tailwind source.
      <div style={{ position: 'fixed', inset: 0, zIndex: 44, pointerEvents: 'none' }}>
        <div
          data-testid='handle'
          style={{ position: 'absolute', inset: 0, pointerEvents: 'auto' }}
        />
      </div>,
    );
    const popupRect = (
      container.querySelector('#popup-container') as HTMLElement
    ).getBoundingClientRect();
    const hit = document.elementFromPoint(
      popupRect.left + popupRect.width / 2,
      popupRect.top + popupRect.height / 2,
    ) as HTMLElement | null;
    expect(hit?.dataset['testid']).toBe('handle');
  });
});

// A full-page selection clamps the toolbar to the cell edge. Its floating
// style/color strip must flip inward rather than disappear outside the cell.
describe('AnnotationPopup full-page selection (#6162)', () => {
  it.each([
    'up',
    'down',
    'left',
    'right',
  ] as const)('keeps the %s style/color strip inside the book cell and clickable', async (dir) => {
    const vertical = dir === 'left' || dir === 'right';
    const onHighlight = vi.fn();
    const point = {
      x: dir === 'right' ? 356 : 10,
      y: dir === 'down' ? 446 : 10,
    };
    const { container } = render(
      <div
        data-eink='true'
        style={{ position: 'fixed', left: 40, top: 20, width: 410, height: 500 }}
      >
        <AnnotationPopup
          bookKey='test'
          dir='ltr'
          isVertical={vertical}
          buttons={toolButtons}
          notes={[]}
          position={{ dir, point }}
          trianglePosition={{ dir, point: { x: point.x, y: point.y + 20 } }}
          highlightOptionsVisible
          selectedStyle='highlight'
          selectedColor='yellow'
          popupWidth={POPUP_W}
          popupHeight={POPUP_H}
          onHighlight={onHighlight}
          onDismiss={vi.fn()}
        />
      </div>,
    );
    const cell = container.firstElementChild as HTMLElement;
    const options = container.querySelector<HTMLElement>('.highlight-options')!;
    await vi.waitFor(() => {
      const bounds = cell.getBoundingClientRect();
      const rect = options.getBoundingClientRect();
      expect(rect.top).toBeGreaterThanOrEqual(bounds.top);
      expect(rect.bottom).toBeLessThanOrEqual(bounds.bottom);
      expect(rect.left).toBeGreaterThanOrEqual(bounds.left);
      expect(rect.right).toBeLessThanOrEqual(bounds.right);
    });
    await page.elementLocator(options.querySelector('button')!).click();
    await vi.waitFor(() => expect(onHighlight).toHaveBeenCalledWith(true));
  });
});

describe('compact four-action toolbar', () => {
  it.each([
    false,
    true,
  ])('keeps four colors visible and scrolls extras (vertical=%s)', async (vertical) => {
    const { container } = renderPopup([{ hex: '#f97316' }, { hex: '#06b6d4' }], true, vertical);
    const options = container.querySelector<HTMLElement>('.highlight-options')!;
    const strip = options.lastElementChild as HTMLElement;
    const styles = options.firstElementChild as HTMLElement;
    const colors = [...strip.querySelectorAll('button')];
    const start = vertical ? 'top' : 'left';
    const end = vertical ? 'bottom' : 'right';
    const length = vertical ? 'height' : 'width';
    expect(container.querySelectorAll('.selection-buttons button')).toHaveLength(4);
    const styleButtons = [...styles.querySelectorAll('button')];
    expect(
      styleButtons[1]!.getBoundingClientRect()[start] -
        styleButtons[0]!.getBoundingClientRect()[end],
    ).toBe(4);
    expect(
      strip.getBoundingClientRect()[start] - styles.getBoundingClientRect()[end],
    ).toBeLessThanOrEqual(4);
    expect(strip.getBoundingClientRect()[length]).toBeLessThanOrEqual(101);
    expect(colors[3]!.getBoundingClientRect()[end]).toBeLessThanOrEqual(
      strip.getBoundingClientRect()[end] - 1,
    );
    expect(colors[4]!.getBoundingClientRect()[end]).toBeGreaterThan(
      strip.getBoundingClientRect()[end],
    );
    if (vertical) strip.scrollTop = strip.scrollHeight;
    else strip.scrollLeft = strip.scrollWidth;
    await vi.waitFor(() => {
      expect(colors.at(-1)!.getBoundingClientRect()[end]).toBeLessThanOrEqual(
        strip.getBoundingClientRect()[end],
      );
    });
  });

  it('fits four colors alongside the global-highlight toggle', () => {
    const { container } = renderPopup([], true, false, true);
    const options = container.querySelector<HTMLElement>('.highlight-options')!;
    const strip = options.lastElementChild as HTMLElement;
    const last = strip.querySelectorAll('button')[3]!;
    expect(last.getBoundingClientRect().right).toBeLessThanOrEqual(
      strip.getBoundingClientRect().right - 1,
    );
    expect(strip.getBoundingClientRect().right).toBeLessThanOrEqual(
      options.getBoundingClientRect().right,
    );
  });
});

describe('highlight controls align with the toolbar edges', () => {
  it.each([false, true])('anchors both ends for compact=%s', (compact) => {
    const { container } = renderPopup([], compact);
    const toolbar = container.querySelector<HTMLElement>('.selection-popup')!;
    const options = container.querySelector<HTMLElement>('.highlight-options')!;
    const styles = options.firstElementChild as HTMLElement;
    const strip = options.lastElementChild as HTMLElement;
    expect(
      Math.abs(styles.getBoundingClientRect().left - toolbar.getBoundingClientRect().left),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(strip.getBoundingClientRect().right - toolbar.getBoundingClientRect().right),
    ).toBeLessThanOrEqual(1);
  });

  it('gives extra colors the available width on a larger toolbar', () => {
    const { container } = renderPopup([{ hex: '#f97316' }, { hex: '#06b6d4' }]);
    const strip = container.querySelector<HTMLElement>('.highlight-options')!
      .lastElementChild as HTMLElement;
    expect(strip.getBoundingClientRect().width).toBeGreaterThan(100);
    const colors = strip.querySelectorAll('button');
    expect(colors[4]!.getBoundingClientRect().right).toBeLessThanOrEqual(
      strip.getBoundingClientRect().right,
    );
  });
});

describe('five-action toolbar', () => {
  it.each([false, true])('keeps five colors visible (vertical=%s)', (vertical) => {
    const { container } = renderPopup([{ hex: '#f97316' }], false, vertical, false, 5);
    const options = container.querySelector<HTMLElement>('.highlight-options')!;
    const strip = options.lastElementChild as HTMLElement;
    const colors = strip.querySelectorAll('button');
    const end = vertical ? 'bottom' : 'right';
    expect(container.querySelectorAll('.selection-buttons button')).toHaveLength(5);
    expect(colors[4]!.getBoundingClientRect()[end]).toBeLessThanOrEqual(
      strip.getBoundingClientRect()[end] - 1,
    );
    expect(strip.getBoundingClientRect()[end]).toBeLessThanOrEqual(
      options.getBoundingClientRect()[end],
    );
  });
});
