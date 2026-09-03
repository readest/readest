import { describe, it, expect, vi } from 'vitest';

vi.mock('@/utils/misc', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getOSPlatform: vi.fn(() => 'macos' as const),
  };
});

import { transformStylesheet, getFootnoteStyles } from '@/utils/style';

describe('transformStylesheet', () => {
  const VW = 1000;
  const VH = 800;
  const VERTICAL = false;

  describe('text-align center + text-indent 0', () => {
    it('adds !important to both text-align and text-indent when both present in same rule', () => {
      const css = '.centered { text-align: center; text-indent: 0; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toContain('text-align: center !important');
      expect(result).toContain('text-indent: 0 !important');
    });

    it('does not add !important when only text-align center is present', () => {
      const css = '.centered { text-align: center; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).not.toContain('text-align: center !important');
    });

    it('does not add !important when only text-indent 0 is present', () => {
      const css = '.indent { text-indent: 0; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).not.toContain('text-indent: 0 !important');
    });
  });

  describe('white-space nowrap', () => {
    it('adds overflow clip !important when no overflow is set', () => {
      const css = '.nowrap { white-space: nowrap; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toContain('overflow: clip !important');
    });

    it('does not add overflow clip when overflow is already set', () => {
      const css = '.nowrap { white-space: nowrap; overflow: hidden; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).not.toContain('overflow: clip !important');
    });
  });

  describe('page-break-after always (inline style)', () => {
    it('adds margin-bottom calc when no margin-bottom present', () => {
      const css = 'page-break-after: always';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toContain('margin-bottom: calc(var(--available-height) * 1px)');
    });

    it('does not add margin-bottom when already present', () => {
      const css = 'page-break-after: always; margin-bottom: 10px';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      // Should only have the original margin-bottom, not the injected one
      expect(result).not.toContain('calc(var(--available-height) * 1px)');
    });
  });

  describe('page-break-after always (rule)', () => {
    it('adds margin-bottom calc within a CSS rule block', () => {
      const css = '.break { page-break-after: always; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toContain('margin-bottom: calc(var(--available-height) * 1px)');
    });

    it('does not add margin-bottom in rule when already present', () => {
      const css = '.break { page-break-after: always; margin-bottom: 20px; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      // The injected calc should not appear
      const matches = result.match(/margin-bottom/g);
      expect(matches).toHaveLength(1);
    });
  });

  describe('font-size px to rem', () => {
    it('converts 16px to 1rem wrapped with max()', () => {
      const css = '.text { font-size: 16px; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      // 16px / 1 (fontScale for macos) / 16 = 1rem, then max() wrap
      expect(result).toContain('font-size: max(1rem, var(--min-font-size, 8px))');
    });

    it('converts 32px to 2rem wrapped with max()', () => {
      const css = '.big { font-size: 32px; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      // 32px / 1 / 16 = 2rem
      expect(result).toContain('font-size: max(2rem, var(--min-font-size, 8px))');
    });
  });

  describe('font-size pt to rem', () => {
    it('converts 12pt to 1rem wrapped with max()', () => {
      const css = '.text { font-size: 12pt; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      // 12pt / 1 / 12 = 1rem
      expect(result).toContain('font-size: max(1rem, var(--min-font-size, 8px))');
    });
  });

  describe('font-size named', () => {
    it('converts xx-small to 0.6rem', () => {
      const css = '.xs { font-size: xx-small; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toContain('font-size: max(0.6rem, var(--min-font-size, 8px))');
    });

    it('converts medium to 1rem', () => {
      const css = '.md { font-size: medium; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toContain('font-size: max(1rem, var(--min-font-size, 8px))');
    });

    it('converts x-large to 1.5rem', () => {
      const css = '.xl { font-size: x-large; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toContain('font-size: max(1.5rem, var(--min-font-size, 8px))');
    });
  });

  describe('vw/vh replacement', () => {
    it('replaces vw with computed px', () => {
      const css = '.w { width: 10vw; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      // 10 * 1000 / 100 = 100px
      expect(result).toContain('100px');
    });

    it('replaces vh with computed px', () => {
      const css = '.h { height: 50vh; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      // 50 * 800 / 100 = 400px
      expect(result).toContain('400px');
    });
  });

  describe('user-select none to unset', () => {
    it('replaces -webkit-user-select: none with unset', () => {
      const css = '.sel { -webkit-user-select: none; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toContain('-webkit-user-select: unset');
      expect(result).not.toContain('-webkit-user-select: none');
    });

    it('replaces -moz-user-select: none with unset', () => {
      const css = '.sel { -moz-user-select: none; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toContain('-moz-user-select: unset');
    });

    it('replaces user-select: none with unset', () => {
      const css = '.sel { user-select: none; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toContain('user-select: unset');
    });
  });

  describe('font-family replacements', () => {
    it('replaces serif with var(--serif, serif)', () => {
      const css = '.text { font-family: serif; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toContain('var(--serif, serif)');
    });

    it('replaces sans-serif with var(--sans-serif, sans-serif)', () => {
      const css = '.text { font-family: sans-serif; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toContain('var(--sans-serif, sans-serif)');
    });

    it('replaces monospace with var(--monospace, monospace)', () => {
      const css = '.code { font-family: monospace; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toContain('var(--monospace, monospace)');
    });

    // Regression test for #5277: a stylesheet can be handed to this transform
    // more than once. Rewriting the generic families again turned them into
    // `var(--var(--serif, serif), serif)`, which the CSS parser drops - the
    // book's font-family declarations vanished and the reader's own font
    // showed through instead.
    describe('idempotence', () => {
      const cases = [
        ['.text { font-family: serif; }', 'var(--serif, serif)'],
        ['.text { font-family: sans-serif; }', 'var(--sans-serif, sans-serif)'],
        ['.code { font-family: monospace; }', 'var(--monospace, monospace)'],
        ['.text { font-family: "FZSongTi", serif; }', 'var(--serif, serif)'],
        ['.text { font-family: Helvetica, sans-serif; }', 'var(--sans-serif, sans-serif)'],
      ] as const;

      cases.forEach(([css, expected]) => {
        it(`keeps ${css} stable across repeated transforms`, () => {
          const once = transformStylesheet(css, VW, VH, VERTICAL);
          const twice = transformStylesheet(once, VW, VH, VERTICAL);
          expect(once).toContain(expected);
          expect(twice).toBe(once);
          expect(twice).not.toContain('var(--var(');
        });
      });
    });
  });

  describe('color black to var(--theme-fg-color)', () => {
    it('replaces color: black', () => {
      const css = '.text { color: black; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toContain('color: var(--theme-fg-color)');
    });

    it('replaces color: #000000', () => {
      const css = '.text { color: #000000; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toContain('color: var(--theme-fg-color)');
    });

    it('replaces color: #000', () => {
      const css = '.text { color: #000; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toContain('color: var(--theme-fg-color)');
    });

    it('replaces color: rgb(0, 0, 0)', () => {
      const css = '.text { color: rgb(0, 0, 0); }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toContain('color: var(--theme-fg-color)');
    });
  });

  describe('fixed-layout documents', () => {
    it('leaves authored colors alone so the page renders as authored (#5649)', () => {
      const css = '.text { color: #000000; } .named { color: black; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL, true);
      expect(result).toBe(css);
    });

    it('leaves authored font sizes and viewport units alone', () => {
      const css = '.text { font-size: 24px; width: 50vw; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL, true);
      expect(result).toBe(css);
    });

    it('still transforms reflowable stylesheets', () => {
      const css = '.text { color: #000000; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL, false);
      expect(result).toContain('color: var(--theme-fg-color)');
    });
  });

  describe('font-weight normal to var(--font-weight)', () => {
    it('replaces font-weight: normal with var(--font-weight)', () => {
      const css = '.text { font-weight: normal; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toContain('font-weight: var(--font-weight)');
    });
  });

  describe('body font-family serif/sans-serif to unset', () => {
    it('replaces body font-family: serif with unset', () => {
      const css = 'body { font-family: serif; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toContain('font-family: unset');
    });

    it('replaces body font-family: sans-serif with unset', () => {
      const css = 'body { font-family: sans-serif; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toContain('font-family: unset');
    });
  });

  describe('duokan-bleed', () => {
    it('adds negative margins, position, overflow, display for bleed directions', () => {
      const css = '.bleed { duokan-bleed: left right; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toContain('margin-left: calc(-1 * var(--page-margin-left)) !important');
      expect(result).toContain('margin-right: calc(-1 * var(--page-margin-right)) !important');
      expect(result).toContain('position: relative !important');
      expect(result).toContain('overflow: hidden !important');
      expect(result).toContain('display: flow-root !important');
    });

    it('adds width when both left and right bleed', () => {
      const css = '.bleed { duokan-bleed: left right; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toContain('width: calc(var(--full-width) * 1px) !important');
      expect(result).toContain('min-width: calc(var(--full-width) * 1px) !important');
      expect(result).toContain('max-width: calc(var(--full-width) * 1px) !important');
    });

    it('adds height when both top and bottom bleed', () => {
      const css = '.bleed { duokan-bleed: top bottom; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toContain('height: calc(var(--full-height) * 1px) !important');
      expect(result).toContain('min-height: calc(var(--full-height) * 1px) !important');
      expect(result).toContain('max-height: calc(var(--full-height) * 1px) !important');
    });

    it('does not add bleed styles when vertical is true', () => {
      const css = '.bleed { duokan-bleed: left right; }';
      const result = transformStylesheet(css, VW, VH, true);
      expect(result).not.toContain('margin-left: calc(-1');
      expect(result).not.toContain('margin-right: calc(-1');
    });
  });

  describe('background-attachment fixed (issue 5711)', () => {
    it('rewrites background-attachment: fixed to scroll', () => {
      const css =
        '#b1 { background-image: url(../Images/t1.png); background-attachment: fixed; background-position: top left; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toContain('background-attachment: scroll');
      expect(result).not.toMatch(/background-attachment\s*:\s*fixed/);
    });

    it('rewrites the fixed keyword inside the background shorthand', () => {
      const css = '.hero { background: url(../Images/t2.png) no-repeat fixed bottom right; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toContain('no-repeat scroll bottom right');
      expect(result).not.toMatch(/\bfixed\b/);
    });

    it('rewrites every layer of a multi-layer background-attachment list', () => {
      const css = '.multi { background-attachment: fixed, scroll, fixed; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toContain('background-attachment: scroll, scroll, scroll');
    });

    it('preserves !important when rewriting fixed', () => {
      const css = '.b { background-attachment: fixed !important; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toContain('background-attachment: scroll !important');
    });

    it('does not touch url() values containing the word fixed', () => {
      const css = '.logo { background: url(images/fixed.png) no-repeat; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toContain('url(images/fixed.png)');
    });

    it('does not touch fixed inside var() or other functions', () => {
      const css = '.b { background-attachment: var(--fixed, fixed); }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toContain('var(--fixed, fixed)');
    });

    it('rewrites fixed after a data URI whose semicolons would end the declaration match', () => {
      const css = '.d { background: url(data:image/png;base64,AAAA) no-repeat fixed top left; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toContain('url(data:image/png;base64,AAAA)');
      expect(result).toContain('no-repeat scroll top left');
    });

    it('does not corrupt a quoted url containing a closing paren and the word fixed', () => {
      const css = '.q { background: url("weird) fixed.png") fixed; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toContain('url("weird) fixed.png")');
      expect(result).toContain('scroll');
      expect(result).not.toContain('scroll.png');
    });

    it('rewrites fixed in inline styles', () => {
      const css = 'background-image: url(t1.png); background-attachment: fixed';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toContain('background-attachment: scroll');
    });

    it('does not touch position: fixed', () => {
      const css = '.pinned { position: fixed; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toContain('position: fixed');
    });
  });

  describe('negative horizontal margins with background (issue 5711)', () => {
    const OVERRIDE = 'margin-left: 0 !important; margin-right: 0 !important;';

    it('zeroes horizontal margins when the shorthand has negative left/right components', () => {
      const css =
        'h1.title { background-color: #0069B7; color: white; margin: -2em -2em 1.5em -2em; padding-top: 3em; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toContain(OVERRIDE);
    });

    it('zeroes horizontal margins for a two-value shorthand with a negative horizontal component', () => {
      const css = '.band { background-color: red; margin: 1em -3em; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toContain(OVERRIDE);
    });

    it('zeroes horizontal margins for negative margin-left/right longhands', () => {
      const css = '.band { background: #333; margin-left: -32px; margin-right: -1.5em; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toContain(OVERRIDE);
    });

    it('wins over an authored !important margin via later cascade order', () => {
      const css = '.band { background-color: blue; margin: -2em -2em 1em -2em !important; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toContain(OVERRIDE);
    });

    it('zeroes only the side whose resolved value is negative', () => {
      const css = '.band { background-color: red; margin: 1em -2em 3em 4em; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toContain('margin-right: 0 !important');
      expect(result).not.toContain('margin-left: 0 !important');
    });

    it('resolves later declarations over earlier ones per side', () => {
      const css = '.band { background-color: red; margin: -2em; margin-left: 1em; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toContain('margin-right: 0 !important');
      expect(result).not.toContain('margin-left: 0 !important');
    });

    it('detects a painting background declared after background: none', () => {
      const css = '.band { background: none; background-color: red; margin: 0 -2em; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toContain(OVERRIDE);
    });

    it('treats alpha-zero colors as non-painting', () => {
      const css = '.hang { background-color: rgba(0, 0, 0, 0); margin: 0 -2em; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).not.toContain('margin-right: 0 !important');
    });

    it('leaves negative margins alone when the rule paints no background', () => {
      const css = '.hang { margin-left: -1em; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).not.toContain(OVERRIDE);
    });

    it('leaves negative margins alone when the background is none or transparent', () => {
      const css = '.hang { background: none; margin-left: -1em; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).not.toContain(OVERRIDE);
    });

    it('leaves rules alone when only the vertical margin is negative', () => {
      const css = '.band { background-color: red; margin: -2em 1em 2em; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).not.toContain(OVERRIDE);
    });

    it('preserves auto centering when the horizontal component is auto', () => {
      const css = '.pull { background-color: red; margin: -1em auto; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).not.toContain(OVERRIDE);
    });

    it('skips shorthands containing calc() or var()', () => {
      const css = '.band { background-color: red; margin: calc(0px - 2em) 0; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).not.toContain(OVERRIDE);
    });

    it('does not zero margins when vertical is true', () => {
      const css = 'h1.title { background-color: blue; margin: -2em -2em 1.5em -2em; }';
      const result = transformStylesheet(css, VW, VH, true);
      expect(result).not.toContain(OVERRIDE);
    });
  });

  describe('hardcoded pixel width clamping', () => {
    it('adds max-width and border-box when width exceeds viewport', () => {
      const css = '.calibre8 { display: block; width: 1200px; padding: 2em 0 0 1em; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toContain('max-width: calc(var(--available-width) * 1px)');
      expect(result).toContain('box-sizing: border-box');
    });

    it('does not clamp when width is smaller than viewport', () => {
      const css = '.box { width: 450px; padding: 2em; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).not.toContain('max-width: calc(var(--available-width)');
    });

    it('does not add max-width when one already exists', () => {
      const css = '.box { width: 1200px; max-width: 100%; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      const matches = result.match(/max-width/g);
      expect(matches).toHaveLength(1);
    });

    it('does not affect max-width or min-width properties', () => {
      const css = '.box { max-width: 1200px; min-width: 200px; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).not.toContain('max-width: calc(var(--available-width)');
    });

    it('does not add max-width for non-pixel width values', () => {
      const css = '.box { width: 50%; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).not.toContain('max-width: calc(var(--available-width)');
    });

    it('does not add max-width for em width values', () => {
      const css = '.box { width: 20em; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).not.toContain('max-width: calc(var(--available-width)');
    });
  });

  describe('preserves unrelated CSS', () => {
    it('passes through CSS without any matching patterns unchanged', () => {
      const css = '.custom { display: flex; padding: 10px; margin: 5px; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toBe(css);
    });
  });

  describe('dark mode light backgrounds', () => {
    it('rewrites white backgrounds in EPUB CSS to theme bg', () => {
      localStorage.setItem('themeMode', 'dark');
      localStorage.setItem('themeColor', 'default');
      localStorage.setItem('systemIsDarkMode', 'false');
      const css = '.callout { background-color: #ffffff; padding: 1em; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toMatch(/background-color:\s*#[0-9a-f]{6}/i);
      expect(result).not.toContain('background-color: #ffffff');
      localStorage.removeItem('themeMode');
    });

    it('leaves dark backgrounds unchanged in dark mode', () => {
      localStorage.setItem('themeMode', 'dark');
      const css = '.panel { background-color: #222; }';
      const result = transformStylesheet(css, VW, VH, VERTICAL);
      expect(result).toContain('background-color: #222');
      localStorage.removeItem('themeMode');
    });
  });

  // The paginator sizes the section iframe to the whole multi-column strip, so
  // `(orientation: ...)` inside a section describes the strip, not a page — and
  // the strip is derived from the content, so the query and the page count feed
  // each other and the layout never settles (#6038).
  describe('orientation media queries', () => {
    const LANDSCAPE_CSS = '@media screen and (orientation: landscape) { div { column-count: 2; } }';
    const PORTRAIT_CSS = '@media screen and (orientation:portrait) { div { column-count: 2; } }';

    it('keeps a landscape block when the reader viewport is landscape', () => {
      const result = transformStylesheet(LANDSCAPE_CSS, 1000, 800, VERTICAL);
      expect(result).toContain('@media screen and (min-width: 0px)');
      expect(result).not.toContain('orientation');
    });

    it('drops a landscape block when the reader viewport is portrait', () => {
      const result = transformStylesheet(LANDSCAPE_CSS, 800, 1000, VERTICAL);
      expect(result).toContain('@media screen and (min-width: 999999px)');
      expect(result).not.toContain('orientation');
    });

    it('keeps a portrait block when the reader viewport is portrait', () => {
      const result = transformStylesheet(PORTRAIT_CSS, 800, 1000, VERTICAL);
      expect(result).toContain('@media screen and (min-width: 0px)');
    });

    it('drops a portrait block when the reader viewport is landscape', () => {
      const result = transformStylesheet(PORTRAIT_CSS, 1000, 800, VERTICAL);
      expect(result).toContain('@media screen and (min-width: 999999px)');
    });

    it('leaves the rest of the query and its declarations intact', () => {
      const result = transformStylesheet(LANDSCAPE_CSS, VW, VH, VERTICAL);
      expect(result).toContain('div { column-count: 2; }');
      expect(result.startsWith('@media screen and ')).toBe(true);
    });

    it('leaves a media query with no viewport feature alone', () => {
      const css = '@media print { div { padding: 1em; } }';
      expect(transformStylesheet(css, VW, VH, VERTICAL)).toContain('@media print {');
    });

    it('leaves the literal alone in a declaration value', () => {
      const css = '.q::after { content: "(orientation: landscape)"; }';
      expect(transformStylesheet(css, VW, VH, VERTICAL)).toContain(
        'content: "(orientation: landscape)"',
      );
    });

    it('leaves the literal alone in an attribute selector', () => {
      const css = '[data-q="(orientation: portrait)"] { padding: 1em; }';
      expect(transformStylesheet(css, VW, VH, VERTICAL)).toContain(
        '[data-q="(orientation: portrait)"]',
      );
    });
  });

  // Same circular dependency as the orientation feature: a two-page section
  // makes the strip twice as wide, so a width query can flip on the page count
  // it is itself deciding. The IDPF sample's `(max-width: 480px)` block does
  // exactly that through `h1 { margin: 50% auto 0 0 }`.
  describe('width and height media queries', () => {
    const small = (feature: string) => `@media screen and (${feature}) { h1 { margin: 50%; } }`;

    it('drops a max-width block when the reader viewport is wider', () => {
      expect(transformStylesheet(small('max-width: 480px'), 1000, 800, VERTICAL)).toContain(
        '(min-width: 999999px)',
      );
    });

    it('keeps a max-width block when the reader viewport is narrower', () => {
      expect(transformStylesheet(small('max-width:480px'), 390, 800, VERTICAL)).toContain(
        '@media screen and (min-width: 0px)',
      );
    });

    it('keeps a min-width block when the reader viewport is wide enough', () => {
      expect(transformStylesheet(small('min-width: 600px'), 1000, 800, VERTICAL)).toContain(
        '@media screen and (min-width: 0px)',
      );
    });

    it('drops a min-width block when the reader viewport is too narrow', () => {
      expect(transformStylesheet(small('min-width: 600px'), 390, 800, VERTICAL)).toContain(
        '(min-width: 999999px)',
      );
    });

    it('resolves height features against the reader viewport height', () => {
      expect(transformStylesheet(small('max-height: 500px'), 1000, 800, VERTICAL)).toContain(
        '(min-width: 999999px)',
      );
      expect(transformStylesheet(small('min-height: 500px'), 1000, 800, VERTICAL)).toContain(
        '@media screen and (min-width: 0px)',
      );
    });

    it('leaves a length it cannot resolve to px alone', () => {
      expect(transformStylesheet(small('max-width: 30em'), 1000, 800, VERTICAL)).toContain(
        '(max-width: 30em)',
      );
    });

    it('leaves the same feature alone outside a media prelude', () => {
      const css = '[data-q="(max-width: 480px)"] { padding: 1em; }';
      expect(transformStylesheet(css, VW, VH, VERTICAL)).toContain('[data-q="(max-width: 480px)"]');
    });

    it('leaves a whole prelude alone when it sits inside a quoted value', () => {
      const css = '.note::before { content: "@media (orientation: landscape)"; }';
      expect(transformStylesheet(css, VW, VH, VERTICAL)).toContain(
        'content: "@media (orientation: landscape)"',
      );
    });

    it('does not let a quoted at-rule swallow the rules that follow it', () => {
      const css =
        '.note::before { content: "@media screen"; } @media (max-width: 480px) { p { margin: 0; } }';
      const result = transformStylesheet(css, 390, 800, VERTICAL);
      expect(result).toContain('content: "@media screen"');
      expect(result).toContain('@media (min-width: 0px) {');
    });
  });
});

describe('getFootnoteStyles', () => {
  it('returns a non-empty string', () => {
    const styles = getFootnoteStyles();
    expect(styles.length).toBeGreaterThan(0);
  });

  it('contains expected selectors', () => {
    const styles = getFootnoteStyles();
    expect(styles).toContain('.duokan-footnote-content');
    expect(styles).toContain('.duokan-footnote-item');
    expect(styles).toContain('a:any-link');
    expect(styles).toContain('aside[epub|type~="footnote"]');
    expect(styles).toContain('aside[epub|type~="endnote"]');
  });
});
