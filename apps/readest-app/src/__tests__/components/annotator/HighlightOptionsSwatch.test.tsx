import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { HighlightColor, HighlightStyle } from '@/types/book';
import { HIGHLIGHT_COLOR_HEX } from '@/services/constants';

/**
 * Every style button previews the color it would actually apply. The marker
 * swatch behind the "A" used to be hardcoded to the yellow highlighter and the
 * underline / squiggly rules inherited `base-content`, so the row previewed
 * colors the annotation would never be drawn in.
 *
 * Colors are resolved through `customHighlightColors` exactly like the color
 * strip's dots. The highlight style fills the swatch; underline and squiggly
 * color only the rule, matching the overlayer, which strokes the line in the
 * annotation color and leaves the text ink alone.
 */

let mockHighlightStyles: Record<HighlightStyle, HighlightColor> = {
  highlight: 'yellow',
  underline: 'red',
  squiggly: 'blue',
};
// Settings seed `customHighlightColors` with the default palette, so the named
// colors always resolve to a hex through it (see DEFAULT_READSETTINGS).
let mockCustomColors: Record<string, string> = { ...HIGHLIGHT_COLOR_HEX };
let mockViewSettings = { isEink: false, isColorEink: false };
let mockIsDarkMode = false;

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: null }),
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({
    get isDarkMode() {
      return mockIsDarkMode;
    },
  }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string, opts?: Record<string, string>) =>
    opts ? s.replace(/\{\{(\w+)\}\}/g, (_m, key) => opts[key] ?? '') : s,
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {
      globalReadSettings: {
        highlightStyle: 'highlight' as const,
        get highlightStyles() {
          return mockHighlightStyles;
        },
        get customHighlightColors() {
          return mockCustomColors;
        },
        userHighlightColors: [],
        defaultHighlightLabels: {},
      },
      get globalViewSettings() {
        return mockViewSettings;
      },
    },
  }),
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (n: number) => n,
}));

vi.mock('@/helpers/settings', () => ({
  saveSysSettings: vi.fn(),
}));

vi.mock('@/app/reader/utils/annotatorUtil', () => ({
  getHighlightColorLabel: () => undefined,
}));

import HighlightOptions from '@/app/reader/components/annotator/HighlightOptions';

const renderOptions = (
  selectedColor: HighlightColor,
  selectedStyle: HighlightStyle = 'highlight',
) =>
  render(
    <HighlightOptions
      isVertical={false}
      popupWidth={300}
      popupHeight={44}
      triangleDir='up'
      selectedStyle={selectedStyle}
      selectedColor={selectedColor}
      onHandleHighlight={vi.fn()}
    />,
  );

const getStyleGlyph = (container: HTMLElement, style: HighlightStyle) => {
  const button = container.querySelector<HTMLElement>(`[aria-label="Select ${style} style"]`);
  if (!button) throw new Error(`${style} style button not rendered`);
  const glyph = button.querySelector<HTMLElement>('div');
  if (!glyph) throw new Error(`${style} glyph not rendered`);
  return glyph;
};

afterEach(() => {
  mockHighlightStyles = { highlight: 'yellow', underline: 'red', squiggly: 'blue' };
  mockCustomColors = { ...HIGHLIGHT_COLOR_HEX };
  mockViewSettings = { isEink: false, isColorEink: false };
  mockIsDarkMode = false;
  cleanup();
});

describe('highlight style marker swatch', () => {
  it('paints the swatch in the selected highlight color, not a fixed yellow', () => {
    mockHighlightStyles = { ...mockHighlightStyles, highlight: 'green' };
    const { container } = renderOptions('green');

    expect(getStyleGlyph(container, 'highlight').style.backgroundColor).toBe('rgb(74, 222, 128)');
  });

  it('honors a customized hex for that color, like the color strip does', () => {
    mockHighlightStyles = { ...mockHighlightStyles, highlight: 'green' };
    mockCustomColors = { ...HIGHLIGHT_COLOR_HEX, green: '#00ff00' };
    const { container } = renderOptions('green');

    expect(getStyleGlyph(container, 'highlight').style.backgroundColor).toBe('rgb(0, 255, 0)');
  });

  it('previews the color the highlight style would apply while another style is active', () => {
    mockHighlightStyles = { highlight: 'violet', underline: 'red', squiggly: 'blue' };
    const { container } = renderOptions('red', 'underline');

    expect(getStyleGlyph(container, 'highlight').style.backgroundColor).toBe('rgb(167, 139, 250)');
  });
});

describe('underline and squiggly rule color', () => {
  it('colors each rule with the color that style would apply', () => {
    const { container } = renderOptions('yellow');

    expect(getStyleGlyph(container, 'underline').style.textDecorationColor).toBe(
      'rgb(248, 113, 113)',
    );
    expect(getStyleGlyph(container, 'squiggly').style.textDecorationColor).toBe(
      'rgb(96, 165, 250)',
    );
  });

  it('tracks the live color of whichever rule style is selected', () => {
    const { container } = renderOptions('violet', 'underline');

    expect(getStyleGlyph(container, 'underline').style.textDecorationColor).toBe(
      'rgb(167, 139, 250)',
    );
    // The unselected squiggly still previews its own stored binding.
    expect(getStyleGlyph(container, 'squiggly').style.textDecorationColor).toBe(
      'rgb(96, 165, 250)',
    );
  });

  it('honors a customized hex for the rule color too', () => {
    mockCustomColors = { ...HIGHLIGHT_COLOR_HEX, blue: '#0000ff' };
    const { container } = renderOptions('yellow');

    expect(getStyleGlyph(container, 'squiggly').style.textDecorationColor).toBe('rgb(0, 0, 255)');
  });

  it('leaves the letter itself in the theme ink', () => {
    const { container } = renderOptions('yellow');

    expect(getStyleGlyph(container, 'underline').style.color).toBe('');
    expect(getStyleGlyph(container, 'underline').className).toContain('text-base-content');
  });
});

/**
 * `[data-eink='true'] [class*='text-base-content']` in globals.css flattens the
 * ink with `!important`, which outranks an inline `color`. The marker glyph and
 * the selected-color check both sit on a base-content chip and set their own
 * contrasting ink inline, so carrying that class painted them base-content on
 * base-content: a solid black square with an invisible "A", and a color swatch
 * with no visible check (#5667). Their color is always explicit, so they must
 * not opt into the override at all.
 */
describe('e-ink chip legibility', () => {
  const getCheck = (container: HTMLElement) => {
    const check = container.querySelector<SVGElement>('button[aria-label^="Select"] svg');
    if (!check) throw new Error('selected color check not rendered');
    return check;
  };

  it('keeps the marker glyph off the e-ink ink override', () => {
    mockViewSettings = { isEink: true, isColorEink: false };
    const { container } = renderOptions('yellow');
    const glyph = getStyleGlyph(container, 'highlight');

    expect(glyph.style.backgroundColor).toBe('rgb(0, 0, 0)');
    expect(glyph.style.color).toBe('rgb(255, 255, 255)');
    expect(glyph.className).not.toContain('text-base-content');
  });

  it('inverts the marker glyph with the theme, so a dark page reads too', () => {
    mockViewSettings = { isEink: true, isColorEink: false };
    mockIsDarkMode = true;
    const { container } = renderOptions('yellow');
    const glyph = getStyleGlyph(container, 'highlight');

    expect(glyph.style.backgroundColor).toBe('rgb(255, 255, 255)');
    expect(glyph.style.color).toBe('rgb(0, 0, 0)');
  });

  it('keeps the selected-color check off the e-ink ink override', () => {
    mockViewSettings = { isEink: true, isColorEink: false };
    const { container } = renderOptions('yellow');

    expect(getCheck(container).style.color).toBe('rgb(255, 255, 255)');
    expect(getCheck(container).classList.contains('text-base-content')).toBe(false);
  });

  it('still flattens the rule glyphs to the theme ink, which needs the override', () => {
    mockViewSettings = { isEink: true, isColorEink: false };
    const { container } = renderOptions('yellow');

    expect(getStyleGlyph(container, 'underline').className).toContain('text-base-content');
  });

  it('leaves color e-ink on the real palette, where the check reads as content ink', () => {
    mockViewSettings = { isEink: true, isColorEink: true };
    const { container } = renderOptions('yellow');

    expect(getStyleGlyph(container, 'highlight').style.backgroundColor).toBe('rgb(250, 204, 21)');
    expect(getCheck(container).classList.contains('text-base-content')).toBe(true);
  });
});
