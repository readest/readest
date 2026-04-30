import { describe, it, expect, vi } from 'vitest';

vi.mock('@/utils/misc', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getOSPlatform: vi.fn(() => 'macos' as const),
  };
});

import { getStyles, ThemeCode } from '@/utils/style';
import { ViewSettings } from '@/types/book';
import {
  DEFAULT_BOOK_FONT,
  DEFAULT_BOOK_LAYOUT,
  DEFAULT_BOOK_LANGUAGE,
  DEFAULT_BOOK_STYLE,
  DEFAULT_VIEW_CONFIG,
  DEFAULT_TTS_CONFIG,
  DEFAULT_TRANSLATOR_CONFIG,
  DEFAULT_ANNOTATOR_CONFIG,
  DEFAULT_SCREEN_CONFIG,
} from '@/services/constants';

/** Build a full ViewSettings from all DEFAULT_* constants, with overrides. */
function makeViewSettings(overrides: Partial<ViewSettings> = {}): ViewSettings {
  return {
    ...DEFAULT_BOOK_FONT,
    ...DEFAULT_BOOK_LAYOUT,
    ...DEFAULT_BOOK_LANGUAGE,
    ...DEFAULT_BOOK_STYLE,
    ...DEFAULT_VIEW_CONFIG,
    ...DEFAULT_TTS_CONFIG,
    ...DEFAULT_TRANSLATOR_CONFIG,
    ...DEFAULT_ANNOTATOR_CONFIG,
    ...DEFAULT_SCREEN_CONFIG,
    ...overrides,
  } as ViewSettings;
}

/** Build a ThemeCode for testing. */
function makeThemeCode(overrides: Partial<ThemeCode> = {}): ThemeCode {
  return {
    bg: '#ffffff',
    fg: '#000000',
    primary: '#3366cc',
    isDarkMode: false,
    palette: {
      'base-100': '#ffffff',
      'base-200': '#f0f0f0',
      'base-300': '#e0e0e0',
      'base-content': '#000000',
      neutral: '#808080',
      'neutral-content': '#ffffff',
      primary: '#3366cc',
      secondary: '#6699cc',
      accent: '#33cc99',
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// getFontStyles branches
// ---------------------------------------------------------------------------
describe('getFontStyles branches (via getStyles)', () => {
  const theme = makeThemeCode();

  it('uses --serif variable when defaultFont is "Serif"', () => {
    const vs = makeViewSettings({ defaultFont: 'Serif' });
    const css = getStyles(vs, theme);
    expect(css).toContain('font-family: var(--serif)');
  });

  it('uses --sans-serif variable when defaultFont is "Sans-serif"', () => {
    const vs = makeViewSettings({ defaultFont: 'Sans-serif' });
    const css = getStyles(vs, theme);
    expect(css).toContain('font-family: var(--sans-serif)');
  });

  it('adds !important when overrideFont is true', () => {
    const vs = makeViewSettings({ overrideFont: true, defaultFont: 'Serif' });
    const css = getStyles(vs, theme);
    expect(css).toContain('font-family: var(--serif) !important');
    // The body block should also have the font-family !important
    expect(css).toContain('font-family: revert !important');
  });

  it('does not add !important when overrideFont is false', () => {
    const vs = makeViewSettings({ overrideFont: false, defaultFont: 'Serif' });
    const css = getStyles(vs, theme);
    // The html rule should NOT have !important after the var
    expect(css).toMatch(/font-family: var\(--serif\)\s*[^!]/);
    // And body block should not have font-family at all
    expect(css).not.toContain('font-family: revert !important');
  });

  it('sets font-size according to defaultFontSize', () => {
    const vs = makeViewSettings({ defaultFontSize: 20 });
    const css = getStyles(vs, theme);
    // On macos, fontScale is 1, zoomLevel defaults to 100 so zoomScale is 1
    expect(css).toContain('font-size: 20px !important');
  });

  it('sets minimum font-size via --min-font-size', () => {
    const vs = makeViewSettings({ minimumFontSize: 10 });
    const css = getStyles(vs, theme);
    expect(css).toContain('--min-font-size: 10px');
  });

  it('sets font-weight', () => {
    const vs = makeViewSettings({ fontWeight: 700 });
    const css = getStyles(vs, theme);
    expect(css).toContain('--font-weight: 700');
    expect(css).toContain('font-weight: 700');
  });

  it('includes CJK font in serif font list when defaultCJKFont differs from serifFont', () => {
    const vs = makeViewSettings({
      serifFont: 'Bitter',
      defaultCJKFont: 'Source Han Serif CN',
    });
    const css = getStyles(vs, theme);
    expect(css).toContain('"Source Han Serif CN"');
  });

  it('does not duplicate CJK font in serif list when it equals serifFont', () => {
    const vs = makeViewSettings({
      serifFont: 'LXGW WenKai GB Screen',
      defaultCJKFont: 'LXGW WenKai GB Screen',
    });
    const css = getStyles(vs, theme);
    // The font should appear only once in the --serif declaration
    const match = css.match(/--serif:([^;]+);/);
    expect(match).not.toBeNull();
    const serifDecl = match![1]!;
    const occurrences = serifDecl.split('"LXGW WenKai GB Screen"').length - 1;
    expect(occurrences).toBe(1);
  });

  it('includes CJK font in sans-serif list when defaultCJKFont differs from sansSerifFont', () => {
    const vs = makeViewSettings({
      sansSerifFont: 'Roboto',
      defaultCJKFont: 'Noto Sans SC',
    });
    const css = getStyles(vs, theme);
    const match = css.match(/--sans-serif:([^;]+);/);
    expect(match).not.toBeNull();
    expect(match![1]).toContain('"Noto Sans SC"');
  });

  it('does not duplicate CJK font in sans-serif list when it equals sansSerifFont', () => {
    const vs = makeViewSettings({
      sansSerifFont: 'Noto Sans SC',
      defaultCJKFont: 'Noto Sans SC',
    });
    const css = getStyles(vs, theme);
    const match = css.match(/--sans-serif:([^;]+);/);
    expect(match).not.toBeNull();
    const sansDecl = match![1]!;
    const occurrences = sansDecl.split('"Noto Sans SC"').length - 1;
    expect(occurrences).toBe(1);
  });

  it('puts monospace font first in the monospace list', () => {
    const vs = makeViewSettings({ monospaceFont: 'Fira Code' });
    const css = getStyles(vs, theme);
    const match = css.match(/--monospace:\s*([^;]+);/);
    expect(match).not.toBeNull();
    expect(match![1]!.trimStart().startsWith('"Fira Code"')).toBe(true);
  });

  it('applies zoomLevel scaling to font size', () => {
    const vs = makeViewSettings({ defaultFontSize: 16, zoomLevel: 200 });
    const css = getStyles(vs, theme);
    // 16 * 1 (fontScale on macos) * (200/100) = 32
    expect(css).toContain('font-size: 32px !important');
  });

  it('includes font[size] rules for all sizes 1-7', () => {
    const vs = makeViewSettings({ defaultFontSize: 16, minimumFontSize: 8 });
    const css = getStyles(vs, theme);
    expect(css).toContain('font[size="1"]');
    expect(css).toContain('font[size="7"]');
  });
});

// ---------------------------------------------------------------------------
// getLayoutStyles branches
// ---------------------------------------------------------------------------
describe('getLayoutStyles branches (via getStyles)', () => {
  const theme = makeThemeCode();

  it('sets text-align to justify when fullJustification is true', () => {
    const vs = makeViewSettings({ fullJustification: true });
    const css = getStyles(vs, theme);
    expect(css).toContain('--default-text-align: justify');
  });

  it('sets text-align to start when fullJustification is false', () => {
    const vs = makeViewSettings({ fullJustification: false });
    const css = getStyles(vs, theme);
    expect(css).toContain('--default-text-align: start');
  });

  it('sets margin CSS variables from viewSettings', () => {
    const vs = makeViewSettings({
      marginTopPx: 50,
      marginRightPx: 30,
      marginBottomPx: 40,
      marginLeftPx: 20,
    });
    const css = getStyles(vs, theme);
    expect(css).toContain('--margin-top: 50px');
    expect(css).toContain('--margin-right: 30px');
    expect(css).toContain('--margin-bottom: 40px');
    expect(css).toContain('--margin-left: 20px');
  });

  it('sets hyphens to auto when hyphenation is true', () => {
    const vs = makeViewSettings({ hyphenation: true });
    const css = getStyles(vs, theme);
    expect(css).toContain('hyphens: auto');
    expect(css).toContain('-webkit-hyphens: auto');
  });

  it('sets hyphens to manual when hyphenation is false', () => {
    const vs = makeViewSettings({ hyphenation: false });
    const css = getStyles(vs, theme);
    expect(css).toContain('hyphens: manual');
    expect(css).toContain('-webkit-hyphens: manual');
  });

  it('adds !important to layout properties when overrideLayout is true', () => {
    const vs = makeViewSettings({ overrideLayout: true, lineHeight: 1.6 });
    const css = getStyles(vs, theme);
    expect(css).toContain('line-height: 1.6 !important');
  });

  it('does not add !important to layout properties when overrideLayout is false', () => {
    const vs = makeViewSettings({ overrideLayout: false, lineHeight: 1.6 });
    const css = getStyles(vs, theme);
    // Should have line-height: 1.6 without !important after it
    expect(css).toMatch(/line-height: 1\.6\s*[^!]/);
  });

  it('sets word-spacing and letter-spacing', () => {
    const vs = makeViewSettings({ wordSpacing: 2, letterSpacing: 1 });
    const css = getStyles(vs, theme);
    expect(css).toContain('word-spacing: 2px');
    expect(css).toContain('letter-spacing: 1px');
  });

  it('sets text-indent', () => {
    const vs = makeViewSettings({ textIndent: 2 });
    const css = getStyles(vs, theme);
    expect(css).toContain('text-indent: 2em');
  });

  it('sets paragraph margins vertically (margin-left/right) when vertical is true', () => {
    const vs = makeViewSettings({ vertical: true, paragraphMargin: 1.0 });
    const css = getStyles(vs, theme);
    expect(css).toContain('margin-left: 1em');
    expect(css).toContain('margin-right: 1em');
    expect(css).toContain('margin-top: unset');
    expect(css).toContain('margin-bottom: unset');
  });

  it('sets paragraph margins horizontally (margin-top/bottom) when vertical is false', () => {
    const vs = makeViewSettings({ vertical: false, paragraphMargin: 0.8 });
    const css = getStyles(vs, theme);
    expect(css).toContain('margin-top: 0.8em');
    expect(css).toContain('margin-bottom: 0.8em');
    expect(css).toContain('margin-left: unset');
    expect(css).toContain('margin-right: unset');
  });

  it('sets div margins with !important when vertical and overrideLayout are both true', () => {
    const vs = makeViewSettings({
      vertical: true,
      overrideLayout: true,
      paragraphMargin: 0.5,
    });
    const css = getStyles(vs, theme);
    expect(css).toContain('margin-left: 0.5em !important');
    expect(css).toContain('margin-right: 0.5em !important');
  });

  it('sets div margins with !important when vertical is false and overrideLayout is true', () => {
    const vs = makeViewSettings({
      vertical: false,
      overrideLayout: true,
      paragraphMargin: 0.5,
    });
    const css = getStyles(vs, theme);
    expect(css).toContain('margin-top: 0.5em !important');
    expect(css).toContain('margin-bottom: 0.5em !important');
  });

  it('does not set div margins when overrideLayout is false', () => {
    const vs = makeViewSettings({
      vertical: false,
      overrideLayout: false,
      paragraphMargin: 0.5,
    });
    const css = getStyles(vs, theme);
    // The div block should not have paragraph margin !important
    // (the template literals produce empty strings when conditions are false)
    expect(css).not.toMatch(/div\s*\{[^}]*margin-top:\s*0\.5em\s*!important/);
  });

  it('applies writing-mode when not auto', () => {
    const vs = makeViewSettings({ writingMode: 'vertical-rl' });
    const css = getStyles(vs, theme);
    expect(css).toContain('writing-mode: vertical-rl !important');
  });

  it('does not set writing-mode when it is auto', () => {
    const vs = makeViewSettings({ writingMode: 'auto' });
    const css = getStyles(vs, theme);
    expect(css).not.toContain('writing-mode: auto');
    expect(css).not.toContain('writing-mode: vertical');
    expect(css).not.toContain('writing-mode: horizontal');
  });

  it('applies justify override for aligned-left when justify and overrideLayout are true', () => {
    const vs = makeViewSettings({ fullJustification: true, overrideLayout: true });
    const css = getStyles(vs, theme);
    expect(css).toContain('text-align: justify !important');
  });

  it('applies initial override for aligned-justify when justify is false and overrideLayout is true', () => {
    const vs = makeViewSettings({ fullJustification: false, overrideLayout: true });
    const css = getStyles(vs, theme);
    expect(css).toContain('text-align: initial !important');
  });

  it('applies img.pi vertical transforms when vertical is true', () => {
    const vs = makeViewSettings({ vertical: true, lineHeight: 1.5 });
    const css = getStyles(vs, theme);
    expect(css).toContain('transform: rotate(90deg)');
    expect(css).toContain('transform-origin: center');
    expect(css).toContain('height: 2em');
    expect(css).toContain('width: 1.5em');
  });

  it('does not apply img.pi vertical transforms when vertical is false', () => {
    const vs = makeViewSettings({ vertical: false });
    const css = getStyles(vs, theme);
    expect(css).not.toContain('transform: rotate(90deg)');
  });

  it('sets img.has-text-siblings width when vertical', () => {
    const vs = makeViewSettings({ vertical: true });
    const css = getStyles(vs, theme);
    expect(css).toMatch(/img\.has-text-siblings\s*\{[^}]*width:\s*1em/);
  });

  it('sets img.has-text-siblings height when not vertical', () => {
    const vs = makeViewSettings({ vertical: false });
    const css = getStyles(vs, theme);
    expect(css).toMatch(/img\.has-text-siblings\s*\{[^}]*height:\s*1em/);
  });

  it('includes zoom: 1 when zoomLevel is 100 (passed as 1.0)', () => {
    const vs = makeViewSettings({ zoomLevel: 100 });
    const css = getStyles(vs, theme);
    // getStyles passes 1.0 as zoomLevel to getLayoutStyles
    expect(css).toContain('zoom: 1');
  });

  it('omits only paragraph-related layout rules when useBookLayout is true', () => {
    const vs = makeViewSettings({
      useBookLayout: true,
      lineHeight: 1.7,
      wordSpacing: 3,
      letterSpacing: 2,
      textIndent: 2,
      paragraphMargin: 1.25,
      fullJustification: true,
      hyphenation: true,
      marginTopPx: 50,
    });
    const css = getStyles(vs, theme);
    // paragraph-specific tokens driven by the Paragraph section must be absent
    expect(css).not.toContain('--default-text-align:');
    expect(css).not.toContain('line-height: 1.7');
    expect(css).not.toContain('word-spacing: 3px');
    expect(css).not.toContain('letter-spacing: 2px');
    expect(css).not.toContain('text-indent: 2em');
    expect(css).not.toContain('hyphens: auto');
    expect(css).not.toContain('-webkit-hyphens: auto');
    // non-paragraph layout rules must still be emitted
    expect(css).toContain('@namespace epub');
    expect(css).toContain('--margin-top: 50px');
    expect(css).toContain('--margin-right:');
    expect(css).toContain('--margin-bottom:');
    expect(css).toContain('--margin-left:');
    // font/color/translation sections must still be present
    expect(css).toContain('--serif:');
    expect(css).toContain('--theme-bg-color');
    expect(css).toContain('.translation-source');
  });

  it('includes paragraph layout rules when useBookLayout is false', () => {
    const vs = makeViewSettings({
      useBookLayout: false,
      lineHeight: 1.7,
      wordSpacing: 3,
      letterSpacing: 2,
      textIndent: 2,
      fullJustification: true,
      hyphenation: true,
    });
    const css = getStyles(vs, theme);
    expect(css).toContain('--default-text-align: justify');
    expect(css).toContain('line-height: 1.7');
    expect(css).toContain('word-spacing: 3px');
    expect(css).toContain('letter-spacing: 2px');
    expect(css).toContain('text-indent: 2em');
    expect(css).toContain('hyphens: auto');
  });
});

// ---------------------------------------------------------------------------
// getColorStyles branches
// ---------------------------------------------------------------------------
describe('getColorStyles branches (via getStyles)', () => {
  it('sets color-scheme to light when isDarkMode is false', () => {
    const vs = makeViewSettings();
    const theme = makeThemeCode({ isDarkMode: false });
    const css = getStyles(vs, theme);
    expect(css).toContain('color-scheme: light');
  });

  it('sets color-scheme to dark when isDarkMode is true', () => {
    const vs = makeViewSettings();
    const theme = makeThemeCode({ isDarkMode: true, bg: '#1a1a1a', fg: '#e0e0e0' });
    const css = getStyles(vs, theme);
    expect(css).toContain('color-scheme: dark');
  });

  it('sets theme CSS variables', () => {
    const vs = makeViewSettings();
    const theme = makeThemeCode({ bg: '#fafafa', fg: '#111111', primary: '#0055cc' });
    const css = getStyles(vs, theme);
    expect(css).toContain('--theme-bg-color: #fafafa');
    expect(css).toContain('--theme-fg-color: #111111');
    expect(css).toContain('--theme-primary-color: #0055cc');
  });

  it('forces background-color and color on elements when overrideColor is true', () => {
    const vs = makeViewSettings({ overrideColor: true });
    const theme = makeThemeCode({ bg: '#fff', fg: '#000' });
    const css = getStyles(vs, theme);
    expect(css).toContain('background-color: #fff !important');
    expect(css).toContain('color: #000 !important');
    expect(css).toContain('border-color: #000 !important');
  });

  it('does not force color overrides when overrideColor is false', () => {
    const vs = makeViewSettings({ overrideColor: false });
    const theme = makeThemeCode({ bg: '#fff', fg: '#000' });
    const css = getStyles(vs, theme);
    // Should not have !important color override on section/div/p etc
    expect(css).not.toMatch(/section,.*\{[^}]*color: #000 !important/);
  });

  it('applies invert filter on images when isDarkMode and invertImgColorInDark are true', () => {
    const vs = makeViewSettings({ invertImgColorInDark: true });
    const theme = makeThemeCode({ isDarkMode: true, bg: '#1a1a1a', fg: '#e0e0e0' });
    const css = getStyles(vs, theme);
    expect(css).toContain('filter: invert(100%)');
  });

  it('does not apply invert filter when isDarkMode is false', () => {
    const vs = makeViewSettings({ invertImgColorInDark: true });
    const theme = makeThemeCode({ isDarkMode: false });
    const css = getStyles(vs, theme);
    expect(css).not.toContain('filter: invert(100%)');
  });

  it('does not apply invert filter when invertImgColorInDark is false', () => {
    const vs = makeViewSettings({ invertImgColorInDark: false });
    const theme = makeThemeCode({ isDarkMode: true, bg: '#1a1a1a', fg: '#e0e0e0' });
    const css = getStyles(vs, theme);
    expect(css).not.toContain('filter: invert(100%)');
  });

  it('applies mix-blend-mode multiply on img when not dark and overrideColor is true', () => {
    const vs = makeViewSettings({ overrideColor: true });
    const theme = makeThemeCode({ isDarkMode: false });
    const css = getStyles(vs, theme);
    expect(css).toContain('mix-blend-mode: multiply');
  });

  it('does not apply mix-blend-mode multiply when overrideColor is false and not dark', () => {
    const vs = makeViewSettings({ overrideColor: false });
    const theme = makeThemeCode({ isDarkMode: false });
    const css = getStyles(vs, theme);
    // mix-blend-mode: multiply on img should not appear; there's one for hr.background-img and
    // has-text-siblings (which is always present), but not in the img block
    expect(css).not.toMatch(/^\s*img\s*\{[^}]*mix-blend-mode: multiply/m);
  });

  it('sets bg-texture-id CSS variable', () => {
    const vs = makeViewSettings({ backgroundTextureId: 'paper' });
    const theme = makeThemeCode();
    const css = getStyles(vs, theme);
    expect(css).toContain('--bg-texture-id: paper');
  });

  it('sets bg-texture-id to none', () => {
    const vs = makeViewSettings({ backgroundTextureId: 'none' });
    const theme = makeThemeCode();
    const css = getStyles(vs, theme);
    expect(css).toContain('--bg-texture-id: none');
  });

  it('includes eink selection styles when isEink is true', () => {
    const vs = makeViewSettings({ isEink: true });
    const theme = makeThemeCode();
    const css = getStyles(vs, theme);
    expect(css).toContain('::selection');
    expect(css).toContain('::-moz-selection');
    expect(css).toContain('background: var(--theme-fg-color)');
  });

  it('does not include eink selection styles when isEink is false', () => {
    const vs = makeViewSettings({ isEink: false });
    const theme = makeThemeCode();
    const css = getStyles(vs, theme);
    expect(css).not.toContain('::selection');
    expect(css).not.toContain('::-moz-selection');
  });

  it('sets text-decoration to underline for links when isEink is true', () => {
    const vs = makeViewSettings({ isEink: true });
    const theme = makeThemeCode();
    const css = getStyles(vs, theme);
    expect(css).toContain('text-decoration: underline');
  });

  it('sets text-decoration to none for links when isEink is false', () => {
    const vs = makeViewSettings({ isEink: false });
    const theme = makeThemeCode();
    const css = getStyles(vs, theme);
    expect(css).toContain('text-decoration: none');
  });

  it('forces eink background on body when isEink is true', () => {
    const vs = makeViewSettings({ isEink: true });
    const theme = makeThemeCode({ bg: '#ffffff' });
    const css = getStyles(vs, theme);
    expect(css).toContain('background-color: #ffffff !important');
  });

  it('sets body.pbg background in dark mode', () => {
    const vs = makeViewSettings();
    const theme = makeThemeCode({ isDarkMode: true, bg: '#1a1a1a', fg: '#e0e0e0' });
    const css = getStyles(vs, theme);
    expect(css).toMatch(/body\.pbg\s*\{[^}]*background-color:\s*#1a1a1a\s*!important/);
  });

  it('does not set body.pbg background in light mode', () => {
    const vs = makeViewSettings();
    const theme = makeThemeCode({ isDarkMode: false });
    const css = getStyles(vs, theme);
    // body.pbg block should be empty or absent
    expect(css).not.toMatch(/body\.pbg\s*\{[^}]*background-color:[^}]*!important/);
  });

  it('applies dark mode link color lightblue when overrideColor is false', () => {
    const vs = makeViewSettings({ overrideColor: false });
    const theme = makeThemeCode({ isDarkMode: true, bg: '#1a1a1a', fg: '#e0e0e0' });
    const css = getStyles(vs, theme);
    expect(css).toContain('color: lightblue');
  });

  it('applies primary color on links when overrideColor is true', () => {
    const vs = makeViewSettings({ overrideColor: true });
    const theme = makeThemeCode({
      isDarkMode: true,
      bg: '#1a1a1a',
      fg: '#e0e0e0',
      primary: '#ff6600',
    });
    const css = getStyles(vs, theme);
    expect(css).toContain('color: #ff6600 !important');
  });

  it('does not apply lightblue link color in light mode', () => {
    const vs = makeViewSettings({ overrideColor: false });
    const theme = makeThemeCode({ isDarkMode: false });
    const css = getStyles(vs, theme);
    expect(css).not.toContain('color: lightblue');
  });

  it('applies dark code styles when isDarkMode is true', () => {
    const vs = makeViewSettings();
    const theme = makeThemeCode({ isDarkMode: true, bg: '#1a1a1a', fg: '#e0e0e0' });
    const css = getStyles(vs, theme);
    expect(css).toContain('body.theme-dark code');
    expect(css).toContain('color: #e0e0e0cc');
    expect(css).toContain('color-mix(in srgb, #1a1a1a 90%, #000)');
  });

  it('applies dark blockquote background in dark mode', () => {
    const vs = makeViewSettings();
    const theme = makeThemeCode({ isDarkMode: true, bg: '#1a1a1a', fg: '#e0e0e0' });
    const css = getStyles(vs, theme);
    expect(css).toContain('color-mix(in srgb, #1a1a1a 80%, #000)');
  });

  it('applies dark table override when isDarkMode and overrideColor are both true', () => {
    const vs = makeViewSettings({ overrideColor: true });
    const theme = makeThemeCode({ isDarkMode: true, bg: '#1a1a1a', fg: '#e0e0e0' });
    const css = getStyles(vs, theme);
    // blockquote, table * rule should have background with color-mix
    expect(css).toMatch(
      /blockquote,\s*table\s*\*\s*\{[^}]*background:\s*color-mix\(in srgb,\s*#1a1a1a\s*80%,\s*#000\)/,
    );
  });

  it('makes svg/img backgrounds transparent when overrideColor is true', () => {
    const vs = makeViewSettings({ overrideColor: true });
    const theme = makeThemeCode();
    const css = getStyles(vs, theme);
    expect(css).toMatch(/svg,\s*img\s*\{[^}]*background-color:\s*transparent\s*!important/);
  });

  it('applies screen blend mode for inline images in dark mode', () => {
    const vs = makeViewSettings();
    const theme = makeThemeCode({ isDarkMode: true, bg: '#1a1a1a', fg: '#e0e0e0' });
    const css = getStyles(vs, theme);
    expect(css).toContain('mix-blend-mode: screen');
  });

  it('applies multiply blend mode for inline images in light mode', () => {
    const vs = makeViewSettings();
    const theme = makeThemeCode({ isDarkMode: false });
    const css = getStyles(vs, theme);
    expect(css).toContain('mix-blend-mode: multiply');
  });

  it('sets inline image parent background when overrideColor is true', () => {
    const vs = makeViewSettings({ overrideColor: true });
    const theme = makeThemeCode({ bg: '#fafafa' });
    const css = getStyles(vs, theme);
    expect(css).toMatch(
      /\*:has\(>\s*img\.has-text-siblings\):not\(body\)\s*\{[^}]*background-color:\s*#fafafa/,
    );
  });
});

// ---------------------------------------------------------------------------
// getTranslationStyles branches
// ---------------------------------------------------------------------------
describe('getTranslationStyles branches (via getStyles)', () => {
  const theme = makeThemeCode();

  it('adds margin to translation-target-block when showTranslateSource is true', () => {
    const vs = makeViewSettings({ showTranslateSource: true });
    const css = getStyles(vs, theme);
    expect(css).toContain('margin: 0.5em 0 !important');
  });

  it('does not add margin to translation-target-block when showTranslateSource is false', () => {
    const vs = makeViewSettings({ showTranslateSource: false });
    const css = getStyles(vs, theme);
    expect(css).not.toContain('margin: 0.5em 0 !important');
  });

  it('always includes translation-source and translation-target classes', () => {
    const vs = makeViewSettings({ showTranslateSource: false });
    const css = getStyles(vs, theme);
    expect(css).toContain('.translation-source');
    expect(css).toContain('.translation-target');
    expect(css).toContain('.translation-target.hidden');
    expect(css).toContain('.translation-target-block');
    expect(css).toContain('.translation-target-toc');
  });
});

// ---------------------------------------------------------------------------
// getStyles integration: userStylesheet appended
// ---------------------------------------------------------------------------
describe('getStyles integration', () => {
  const theme = makeThemeCode();

  it('appends userStylesheet content at the end', () => {
    const customCSS = 'body { color: red !important; }';
    const vs = makeViewSettings({ userStylesheet: customCSS });
    const css = getStyles(vs, theme);
    expect(css).toContain(customCSS);
    // Should be at the end
    expect(css.indexOf(customCSS)).toBe(css.length - customCSS.length);
  });

  it('concatenates all style sections', () => {
    const vs = makeViewSettings();
    const css = getStyles(vs, theme);
    // layout styles
    expect(css).toContain('@namespace epub');
    // font styles
    expect(css).toContain('--serif:');
    // color styles
    expect(css).toContain('--theme-bg-color');
    // translation styles
    expect(css).toContain('.translation-source');
  });

  it('uses default themeCode (via getThemeCode) when none is provided', () => {
    const vs = makeViewSettings();
    // Should not throw even without a themeCode, though getThemeCode uses
    // localStorage which is mocked by jsdom as empty
    const css = getStyles(vs);
    expect(css).toBeTruthy();
    expect(css).toContain('--theme-bg-color');
  });
});
