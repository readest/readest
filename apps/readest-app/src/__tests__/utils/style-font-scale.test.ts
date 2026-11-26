// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/utils/misc', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getOSPlatform: vi.fn(() => 'android' as const),
  };
});

import { getOSPlatform } from '@/utils/misc';
import { applyFontScaleToRenderer, transformInlineFonts, transformStylesheet } from '@/utils/style';

/**
 * A fake section document whose two probe divs report the requested layout
 * sizes. Android WebView's system font scale makes a 100px/line-height-1 line
 * box `rendered` px tall while the `1em` ruler stays at CSS px `emLength`.
 * createElement is called in order: probe, glyph, ruler.
 */
const makeDoc = (rendered: number, emLength: number, body = true) => {
  const setProperty = vi.fn();
  const created: HTMLElement[] = [];
  let index = 0;
  const doc = {
    documentElement: { style: { setProperty } },
    body: body ? { appendChild: vi.fn() } : null,
    createElement: (tag: string) => {
      index += 1;
      // 1st element = probe, 2nd = glyph (height), 3rd = ruler (width).
      const at = index;
      const el = {
        tagName: tag.toUpperCase(),
        style: { cssText: '', setProperty: vi.fn() },
        setAttribute: vi.fn(),
        textContent: '',
        append: vi.fn(),
        remove: vi.fn(),
      } as unknown as HTMLElement;
      Object.defineProperties(el, {
        offsetHeight: { get: () => (at === 2 ? rendered : 0) },
        offsetWidth: { get: () => (at === 3 ? emLength : 0) },
      });
      created.push(el);
      return el;
    },
  } as unknown as Document;
  return { doc, setProperty, created };
};

describe('applyFontScaleToRenderer', () => {
  it('leaves --readest-font-scale at 1 when the system size is default', () => {
    const { doc, setProperty } = makeDoc(100, 100);
    applyFontScaleToRenderer(doc);
    expect(setProperty).toHaveBeenCalledWith('--readest-font-scale', '1');
  });

  it('publishes the measured ratio when the system font size is enlarged', () => {
    const { doc, setProperty } = makeDoc(130, 100);
    applyFontScaleToRenderer(doc);
    expect(setProperty).toHaveBeenCalledWith('--readest-font-scale', '1.3');
  });

  it('publishes a ratio below 1 when the system font size is reduced', () => {
    const { doc, setProperty } = makeDoc(85, 100);
    applyFontScaleToRenderer(doc);
    expect(setProperty).toHaveBeenCalledWith('--readest-font-scale', '0.85');
  });

  it('falls back to 1 for nonsensical ratios or a missing body', () => {
    const zero = makeDoc(0, 100);
    applyFontScaleToRenderer(zero.doc);
    expect(zero.setProperty).toHaveBeenCalledWith('--readest-font-scale', '1');

    const noBody = makeDoc(130, 100, false);
    applyFontScaleToRenderer(noBody.doc);
    expect(noBody.setProperty).not.toHaveBeenCalled();
  });

  // A vertical book makes the block's physical height its inline extent, so a
  // probe left in vertical-rl reads a glyph advance instead of the zoomed line
  // box and returns 1. Pinning the probe to horizontal-tb keeps the ratio
  // meaningful in 竖排 books, where a fixed-height 夹批 depends on it.
  it('pins the probe to horizontal-tb so vertical books are measured too', () => {
    const { doc, created } = makeDoc(200, 100);
    applyFontScaleToRenderer(doc);
    const [probe, glyph, ruler] = created;
    expect(probe!.style.cssText).toContain('writing-mode:horizontal-tb');
    expect(glyph!.style.cssText).toContain('writing-mode:horizontal-tb');
    expect(ruler!.style.cssText).toContain('writing-mode:horizontal-tb');
  });

  // With Override Book Layout on, the reader's paragraph rule sets
  // `line-height: 1.5 !important`, and its `div:not(:has(…))` clause matches
  // the probe's text-only divs. A normal inline declaration loses to that, so
  // the line box would report 1.5 × 100px and every compensated length would be
  // enlarged by the user's line spacing on top of the system scale.
  it('keeps the probe immune to the reader’s !important layout rules', () => {
    const { doc, created } = makeDoc(150, 100);
    applyFontScaleToRenderer(doc);
    const [, glyph, ruler] = created;
    expect(glyph!.style.cssText).toContain('line-height:1 !important');
    expect(glyph!.style.cssText).toContain('font-size:100px !important');
    expect(ruler!.style.cssText).toContain('font-size:100px !important');
    expect(ruler!.style.cssText).toContain('width:1em !important');
  });
});

describe('book-authored font-relative lengths (Use Book Layout)', () => {
  const scale = 'calc(2em * var(--readest-font-scale, 1))';

  it('scales em/rem indents from linked and embedded stylesheets', () => {
    const css = 'p { text-indent: 2em; } h2 { text-indent: 1.5rem !important; }';
    const result = transformStylesheet(css, 800, 600, false);
    expect(result).toContain(`text-indent: ${scale}`);
    expect(result).toContain('text-indent: calc(1.5rem * var(--readest-font-scale, 1)) !important');
  });

  it('scales non-font em/rem layout lengths everywhere', () => {
    const css = [
      'p {',
      '  margin: 0.5em 1rem;',
      '  padding-inline: 1em;',
      '  letter-spacing: .05em;',
      '  word-spacing: 0.2em;',
      '  gap: 1.5em;',
      '  border-width: 0.1em;',
      '  text-shadow: 0 0 0.2em black;',
      '  width: 20em;',
      '}',
    ].join('\n');
    const result = transformStylesheet(css, 800, 600, false);
    expect(result).toContain(
      'margin: calc(0.5em * var(--readest-font-scale, 1)) calc(1rem * var(--readest-font-scale, 1))',
    );
    expect(result).toContain('padding-inline: calc(1em * var(--readest-font-scale, 1))');
    expect(result).toContain('letter-spacing: calc(.05em * var(--readest-font-scale, 1))');
    expect(result).toContain('word-spacing: calc(0.2em * var(--readest-font-scale, 1))');
    expect(result).toContain('gap: calc(1.5em * var(--readest-font-scale, 1))');
    expect(result).toContain('border-width: calc(0.1em * var(--readest-font-scale, 1))');
    expect(result).toContain('text-shadow: 0 0 calc(0.2em * var(--readest-font-scale, 1)) black');
    expect(result).toContain('width: calc(20em * var(--readest-font-scale, 1))');
  });

  it('scales custom properties used as lengths, but not font-related ones', () => {
    const result = transformStylesheet(
      'p { --indent: 2em; --font-size: 3em; text-indent: var(--indent); }',
      800,
      600,
      false,
    );
    expect(result).toContain('--indent: calc(2em * var(--readest-font-scale, 1))');
    // A font-related custom property must keep its raw length. Baselines with the
    // min-font-size clamp may rewrite the value (e.g. `max(3em, var(--min-...))`);
    // what this test pins down is that the length is never scaled by us.
    expect(result).toMatch(/--font-size:[^;{}]*3em/);
    expect(result).not.toMatch(/--font-size:[^;{}]*--readest-font-scale/);
    expect(result).toContain('text-indent: var(--indent)');
  });

  it('never scales font-size, line-height or the font shorthand', () => {
    const css =
      'p { font-size: 1.2em; line-height: 1.5em; font: italic 2em/1.4 serif; --font-size: 3em; }';
    const result = transformStylesheet(css, 800, 600, false);
    const fontLine = result.split('\n').find((line) => line.includes('font:'));
    // Values may be rewritten by the min-font-size clamp on newer baselines;
    // the invariant tested here is that none of them is scaled by the factor.
    expect(result).toMatch(/font-size:[^;{}]*1\.2em/);
    expect(result).toMatch(/line-height:[^;{}]*1\.5em/);
    expect(result).toMatch(/--font-size:[^;{}]*3em/);
    expect(fontLine).toContain('2em');
    expect(fontLine).not.toContain('--readest-font-scale');
    expect(result).not.toMatch(/font-size:[^;{}]*--readest-font-scale/);
    expect(result).not.toMatch(/line-height:[^;{}]*--readest-font-scale/);
  });

  it('keeps negative, hanging and zero indents valid', () => {
    const result = transformStylesheet(
      'p.a { text-indent: -2em hanging; } p.b { text-indent: 0em; }',
      800,
      600,
      false,
    );
    expect(result).toContain('text-indent: calc(-2em * var(--readest-font-scale, 1)) hanging');
    expect(result).toContain('text-indent: 0em');
  });

  it('compensates authored calc() once and is idempotent', () => {
    const once = transformStylesheet('p { text-indent: calc(2em + 1px); }', 800, 600, false);
    expect(once).toContain('calc(calc(2em * var(--readest-font-scale, 1)) + 1px)');
    expect(transformStylesheet(once, 800, 600, false)).toBe(once);
    const twice = transformStylesheet('p { margin: 1em; }', 800, 600, false);
    expect(transformStylesheet(twice, 800, 600, false)).toBe(twice);
  });

  it('leaves comments, strings, url(), px, % and at-rule preludes alone', () => {
    const css =
      '/* text-indent: 2em */ @media (min-width: 10em) { p { content: "margin: 1em"; background: url("a2em.png"); margin: 10px 5%; padding: 1em; } }';
    const result = transformStylesheet(css, 800, 600, false);
    expect(result).toContain('/* text-indent: 2em */');
    expect(result).toContain('@media (min-width: 10em)');
    expect(result).toContain('content: "margin: 1em"');
    expect(result).toContain('url("a2em.png")');
    expect(result).toContain('margin: 10px 5%');
    expect(result).toContain('padding: calc(1em * var(--readest-font-scale, 1))');
  });

  // A condition written as `( min-width: 10em )` starts with a space, which the
  // declaration pattern would otherwise accept as a property boundary. Custom
  // properties are not allowed in at-rule conditions, so the query would break.
  it('leaves a spaced at-rule condition alone', () => {
    const result = transformStylesheet(
      '@media ( min-width: 10em ) { p { padding: 1em; } }',
      800,
      600,
      false,
    );
    expect(result).toContain('@media ( min-width: 10em )');
    expect(result).toContain('padding: calc(1em * var(--readest-font-scale, 1))');
  });

  // Identifier suffixes are not lengths: a custom property whose name ends in
  // `2em` must keep working as a reference.
  it('keeps var() references intact when a name ends in a length token', () => {
    const result = transformStylesheet(
      'p { --gap2em: 1em; margin: var(--gap2em); }',
      800,
      600,
      false,
    );
    expect(result).toContain('--gap2em: calc(1em * var(--readest-font-scale, 1))');
    expect(result).toContain('margin: var(--gap2em)');
  });

  // The negative-margin pass below drops the Duokan full-bleed trick (#5711) by
  // appending a zero override. Scaling first would turn `-2em` into a calc(),
  // which that pass skips, and the band would paint onto the next column.
  it('still zeroes a painted rule’s negative margins', () => {
    const result = transformStylesheet(
      '.band { background: red; margin: 0 -2em; }',
      800,
      600,
      false,
    );
    expect(result).toContain('margin-left: 0 !important');
  });

  // A custom property is substituted into the declaration that consumes it, so
  // `--line-height` must stay raw: `line-height` is skipped because WebView
  // already zooms it, and scaling the value would zoom it a second time.
  it('leaves a line-height custom property raw', () => {
    const result = transformStylesheet(
      'p { --line-height: 1.5em; line-height: var(--line-height); --indent: 2em; }',
      800,
      600,
      false,
    );
    expect(result).toMatch(/--line-height:[^;{}]*1\.5em/);
    expect(result).not.toMatch(/--line-height:[^;{}]*--readest-font-scale/);
    expect(result).toContain('--indent: calc(2em * var(--readest-font-scale, 1))');
  });

  // A variable is zoomed by WebView only when its consumer is a font metric, so
  // the decision has to come from the consumer rather than from the name: a
  // `size` in the name is as common for layout boxes as for type.
  it('scales a laid-out variable and leaves one that feeds font-size raw', () => {
    const layout = transformStylesheet(
      'p { --column-size: 20em; height: var(--column-size); }',
      800,
      600,
      false,
    );
    expect(layout).toContain('--column-size: calc(20em * var(--readest-font-scale, 1))');

    const font = transformStylesheet(
      'p { --heading-size: 1.5em; font-size: var(--heading-size); }',
      800,
      600,
      false,
    );
    expect(font).toMatch(/--heading-size:[^;{}]*1\.5em/);
    expect(font).not.toMatch(/--heading-size:[^;{}]*--readest-font-scale/);
  });

  // CSS allows a comment between any two tokens, so a length must still be read
  // as one when a comment is glued to it.
  it('scales a length glued to a comment', () => {
    const result = transformStylesheet(
      'p { margin: 1em/*note*/; padding: /*x*/2em; }',
      800,
      600,
      false,
    );
    expect(result).toContain('calc(1em * var(--readest-font-scale, 1))/*note*/');
    expect(result).toContain('/*x*/calc(2em * var(--readest-font-scale, 1))');
  });

  it('does not touch fixed-layout books', () => {
    const css = 'p { text-indent: 2em; margin: 1em; }';
    expect(transformStylesheet(css, 800, 600, false, true)).toBe(css);
  });

  it('scales style attributes too', () => {
    const result = transformInlineFonts('text-indent: 2em; margin: 1rem; font-family: serif');
    expect(result).toContain(`text-indent: ${scale}`);
    expect(result).toContain('margin: calc(1rem * var(--readest-font-scale, 1))');
  });

  it('leaves book CSS byte-identical off Android', () => {
    const platform = vi.mocked(getOSPlatform);
    platform.mockReturnValue('macos' as const);
    try {
      const css = 'p { text-indent: 2em; margin: 1em; }';
      expect(transformStylesheet(css, 800, 600, false)).toBe(css);
      expect(transformInlineFonts('text-indent: 2em')).toBe('text-indent: 2em');
    } finally {
      platform.mockReturnValue('android' as const);
    }
  });
});
