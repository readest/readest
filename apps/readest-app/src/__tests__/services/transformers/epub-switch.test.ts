import { describe, test, expect } from 'vitest';
import type { ViewSettings } from '@/types/book';
import type { TransformContext } from '@/services/transformers/types';
import { epubSwitchTransformer } from '@/services/transformers/epubSwitch';

const OPS = 'http://www.idpf.org/2007/ops';
const CML = 'http://www.xml-cml.org/schema';
const MATHML = 'http://www.w3.org/1998/Math/MathML';

const makeCtx = (content: string): TransformContext => ({
  bookKey: 'test-book',
  viewSettings: {} as ViewSettings,
  userLocale: 'en',
  isFixedLayout: false,
  content,
  transformers: [],
});

const wrap = (body: string) =>
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="${OPS}"><head><title>t</title></head>` +
  `<body>${body}</body></html>`;

describe('epubSwitchTransformer', () => {
  test('renders the default branch when no case namespace is supported (#480)', async () => {
    // IDPF hefty-water sample: a CML formula with an XHTML fallback.
    const html = wrap(
      '<p>Here the switch begins...</p>' +
        `<epub:switch><epub:case required-namespace="${CML}">` +
        `<chem xmlns="${CML}"><atom>H</atom></chem></epub:case>` +
        '<epub:default><p id="fallback">2H<sub>2</sub> + O<sub>2</sub></p></epub:default>' +
        '</epub:switch><p>... and here the switch ends.</p>',
    );
    const result = await epubSwitchTransformer.transform(makeCtx(html));
    expect(result).toContain('<p id="fallback">2H<sub>2</sub> + O<sub>2</sub></p>');
    expect(result).not.toContain('<atom');
    expect(result).not.toContain('<epub:switch');
    expect(result).not.toContain('<epub:default');
    expect(result).toContain('Here the switch begins...');
    expect(result).toContain('... and here the switch ends.');
  });

  test('renders a MathML case natively and drops the default', async () => {
    const html = wrap(
      `<epub:switch><epub:case required-namespace="${MATHML}">` +
        `<math xmlns="${MATHML}"><mi>x</mi></math></epub:case>` +
        '<epub:default><p id="fallback">x</p></epub:default></epub:switch>',
    );
    const result = await epubSwitchTransformer.transform(makeCtx(html));
    expect(result).toContain('<mi>x</mi>');
    expect(result).not.toContain('fallback');
    expect(result).not.toContain('<epub:case');
  });

  test('resolves a switch declared with a default namespace instead of a prefix', async () => {
    const html = wrap(
      `<switch xmlns="${OPS}"><case required-namespace="${CML}">` +
        `<chem xmlns="${CML}"><atom>H</atom></chem></case>` +
        '<default><p xmlns="http://www.w3.org/1999/xhtml" id="fallback">water</p></default></switch>',
    );
    const result = await epubSwitchTransformer.transform(makeCtx(html));
    expect(result).toContain('id="fallback"');
    expect(result).not.toContain('<atom');
    expect(result).not.toMatch(/<switch/);
  });

  test('resolves a switch bound to a hyphenated namespace prefix', async () => {
    // XML names allow hyphens in prefixes; the fast path must not skip them.
    const html =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub-3="${OPS}"><head><title>t</title></head>` +
      `<body><epub-3:switch><epub-3:case required-namespace="${CML}">` +
      `<chem xmlns="${CML}"><atom>H</atom></chem></epub-3:case>` +
      '<epub-3:default><p id="fallback">water</p></epub-3:default></epub-3:switch></body></html>';
    const result = await epubSwitchTransformer.transform(makeCtx(html));
    expect(result).toContain('id="fallback"');
    expect(result).not.toContain('<atom');
    expect(result).not.toMatch(/<epub-3:switch/);
  });

  test('keeps the XML declaration and doctype of a resolved document', async () => {
    const html =
      '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n' +
      `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="${OPS}"><head></head><body>` +
      '<epub:switch><epub:default><p>d</p></epub:default></epub:switch></body></html>';
    const result = await epubSwitchTransformer.transform(makeCtx(html));
    expect(result).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(result).toContain('<!DOCTYPE html>');
    expect(result).toContain('<p>d</p>');
  });

  test('returns content without a switch untouched', async () => {
    const html = wrap('<p>plain <code>switch</code> statement</p>');
    const result = await epubSwitchTransformer.transform(makeCtx(html));
    expect(result).toBe(html);
  });

  test('returns content that is not well-formed XML untouched', async () => {
    const html =
      '<html><body><p>unclosed<br><epub:switch><epub:default>x</epub:default></epub:switch></body></html>';
    const result = await epubSwitchTransformer.transform(makeCtx(html));
    expect(result).toBe(html);
  });
});
