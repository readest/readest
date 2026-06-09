import { describe, it, expect } from 'vitest';
import { getPublication } from 'foliate-js/opds.js';
import { getOPDSDescriptionHtml } from '@/app/opds/utils/opdsContent';
import { SYMBOL, type OPDSPublication } from '@/types/opds';

// Render an HTML string the way `dangerouslySetInnerHTML` would and return the
// visible text, so a test can tell "renders as markup" from "shows raw tags".
const renderedText = (html: string): string => {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el.textContent ?? '';
};

const parsePublication = (entryInner: string): OPDSPublication => {
  const xml = `<entry xmlns="http://www.w3.org/2005/Atom"><title>T</title>${entryInner}</entry>`;
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  return getPublication(doc.documentElement) as OPDSPublication;
};

describe('getOPDSDescriptionHtml', () => {
  it('returns empty string for missing content', () => {
    expect(getOPDSDescriptionHtml(undefined)).toBe('');
    expect(getOPDSDescriptionHtml({ value: '', type: 'text' })).toBe('');
  });

  it('renders real (single-escaped) HTML in a text summary as markup', () => {
    // <summary type="text">&lt;p&gt;Hi &amp;quot;q&amp;quot;&lt;/p&gt;</summary>
    const content = { value: '<p>Hi &quot;q&quot;</p>', type: 'text' as const };
    const html = getOPDSDescriptionHtml(content);
    expect(html).toContain('<p>');
    expect(renderedText(html)).toBe('Hi "q"');
  });

  it('renders HTML for type="html" content', () => {
    const content = { value: '<p>Hello <strong>world</strong></p>', type: 'html' as const };
    const html = getOPDSDescriptionHtml(content);
    expect(html).toContain('<strong>');
    expect(renderedText(html)).toBe('Hello world');
  });

  it('renders xhtml content and unwraps the namespaced wrapper div', () => {
    const content = {
      value: '<div xmlns="http://www.w3.org/1999/xhtml"><p>Hi</p></div>',
      type: 'xhtml' as const,
    };
    const html = getOPDSDescriptionHtml(content);
    expect(renderedText(html)).toBe('Hi');
  });

  // The bug: issue #4503. An aggregator feed serves the description as a
  // type="text" summary whose HTML has been escaped twice, so it survives
  // parsing as entity *text* ("&lt;p&gt;...") and showed literal tags.
  it('decodes double-escaped HTML so it renders instead of showing raw tags', () => {
    const content = {
      value:
        '&lt;p&gt;Creators&lt;/p&gt;&lt;p&gt;&amp;quot;Wall&amp;quot; Sollenar&amp;#x27;s&lt;/p&gt;',
      type: 'text' as const,
    };
    const html = getOPDSDescriptionHtml(content);
    // No literal tag/entity text should remain visible to the user.
    const text = renderedText(html);
    expect(text).not.toContain('<p>');
    expect(text).not.toContain('&quot;');
    expect(text).not.toContain('&#x27;');
    expect(text).toContain('Creators');
    expect(text).toContain('"Wall"');
    expect(text).toContain("Sollenar's");
    // The markup itself contains real paragraph elements.
    expect(html).toContain('<p>');
  });

  it('end-to-end: a double-escaped Atom entry (issue #4503) renders as HTML', () => {
    const pub = parsePublication(
      '<summary>&amp;lt;p&amp;gt;Creators: Algis Budrys&amp;lt;/p&amp;gt;' +
        '&amp;lt;p&amp;gt;&amp;amp;quot;Wall of Crystal&amp;amp;quot; by Budrys&amp;lt;/p&amp;gt;</summary>',
    );
    const content = pub.metadata[SYMBOL.CONTENT];
    const html = getOPDSDescriptionHtml(content);
    const text = renderedText(html);
    expect(text).not.toContain('<p>');
    expect(text).toContain('Creators: Algis Budrys');
    expect(text).toContain('"Wall of Crystal"');
    expect(html).toContain('<p>');
  });

  it('leaves mixed real-and-escaped markup untouched (no over-decoding)', () => {
    // Author intentionally shows a literal <code> tag inside a real paragraph.
    const content = { value: '<p>Use &lt;code&gt; here</p>', type: 'text' as const };
    const text = renderedText(getOPDSDescriptionHtml(content));
    expect(text).toBe('Use <code> here');
  });

  it('strips scripts from untrusted feed HTML', () => {
    const content = {
      value: '<p>Hi</p><script>alert(1)</script>',
      type: 'html' as const,
    };
    const html = getOPDSDescriptionHtml(content);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
  });

  it('strips scripts hidden behind double-escaping', () => {
    const content = {
      value: '&lt;script&gt;alert(1)&lt;/script&gt;&lt;p&gt;Hi&lt;/p&gt;',
      type: 'text' as const,
    };
    const html = getOPDSDescriptionHtml(content);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
    expect(renderedText(html)).toContain('Hi');
  });

  it('accepts a plain string value', () => {
    expect(renderedText(getOPDSDescriptionHtml('<p>Plain</p>'))).toBe('Plain');
  });
});
