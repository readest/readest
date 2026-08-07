import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Marked } from 'marked';
import markedKatex from 'marked-katex-extension';

// A copy of the annotation note parser in BOOKNOTE_ITEM below. Importing that
// component pulls in the store/Supabase graph, which needs env config to load
// at all, so the options are mirrored here instead. Every behaviour case below
// pins one of them, and the first test fails if the two ever diverge — without
// it these would describe a parser the app does not use.
const KATEX_OPTIONS = { throwOnError: false, output: 'mathml', nonStandard: true } as const;

const noteMarkdown = new Marked({ gfm: true }).use(markedKatex({ ...KATEX_OPTIONS }));

const BOOKNOTE_ITEM = 'src/app/reader/components/sidebar/BooknoteItem.tsx';

const parse = (src: string) => noteMarkdown.parse(src) as string;

const mathCount = (html: string) => (html.match(/<math/g) ?? []).length;

describe('annotation note markdown', () => {
  // The component builds its own parser, so without this guard an option
  // changed there would leave every behaviour case below green while the app
  // rendered something else entirely.
  it('mirrors the markedKatex options BooknoteItem configures', () => {
    const source = readFileSync(resolve(process.cwd(), BOOKNOTE_ITEM), 'utf-8');
    expect(source).toContain('new Marked({ gfm: true })');

    const call = /markedKatex\(\{([\s\S]*?)\}\)/.exec(source);
    expect(call, `no markedKatex({...}) call found in ${BOOKNOTE_ITEM}`).not.toBeNull();

    const configured = call![1]!
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('//'))
      .sort();
    const expected = Object.entries(KATEX_OPTIONS)
      .map(([key, value]) => `${key}: ${typeof value === 'string' ? `'${value}'` : value},`)
      .sort();

    expect(configured).toEqual(expected);
  });

  it('renders inline math as MathML', () => {
    const html = parse('Mass: $E = mc^2$');
    expect(mathCount(html)).toBe(1);
    expect(html).toContain('<annotation encoding="application/x-tex">E = mc^2</annotation>');
  });

  it('renders $$…$$ in display mode', () => {
    expect(parse('x $$a+b$$ y')).toContain('display="block"');
  });

  // output: 'mathml'. The default (htmlAndMathml) emits a second, visual
  // rendering that only katex.min.css hides, and no KaTeX CSS is loaded here.
  it('emits no HTML twin of the equation', () => {
    const html = parse('Mass: $E = mc^2$');
    expect(html).not.toContain('katex-html');
    expect(html).not.toContain('katex-mathml');
  });

  // nonStandard: true. Under the default rule an opening `$` must follow a
  // literal space, so a note whose equation starts a line renders as plain
  // text with no error at all.
  it('renders an equation that starts a line', () => {
    expect(mathCount(parse('Key formula\n$E = mc^2$\nworth remembering'))).toBe(1);
  });

  it('renders two equations separated by a word without spaces', () => {
    expect(mathCount(parse('x $a$word$b$ y'))).toBe(2);
  });

  // The documented cost of nonStandard: bare dollar signs are parsed as math.
  // Change this expectation only alongside the option itself.
  it('parses bare dollar signs as math', () => {
    expect(mathCount(parse('cost $5 and $10 here'))).toBe(1);
  });

  it('leaves escaped dollar signs as text', () => {
    const html = parse('cost \\$5 and \\$10 here');
    expect(mathCount(html)).toBe(0);
    expect(html).toContain('cost $5 and $10 here');
  });

  // throwOnError: false.
  it('renders malformed math inline instead of throwing', () => {
    const html = parse('broken $\\frac{1}$ end');
    expect(html).toContain('katex-error');
    expect(html).toContain('title="ParseError');
  });

  it('still renders GFM markdown around the math', () => {
    const html = parse('**bold** and $x$\n\n- a\n- b');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<li>a</li>');
    expect(mathCount(html)).toBe(1);
  });
});
