import { describe, it, expect } from 'vitest';
import { parseNoteMarkdown } from '@/app/reader/utils/noteMarkdown';

/**
 * Notes are rendered with dangerouslySetInnerHTML in both the sidebar and the
 * annotation bubble popup, and they can arrive from annotation imports and
 * sync, not only from the local editor. The shared parser must therefore
 * strip active content while keeping the Markdown and KaTeX output intact.
 */
describe('parseNoteMarkdown', () => {
  it('renders GitHub-flavored markdown', () => {
    const html = parseNoteMarkdown('# Title\n\n- one\n- two\n\n~~gone~~ **bold**');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<del>gone</del>');
    expect(html).toContain('<strong>bold</strong>');
  });

  it('keeps KaTeX MathML output, including after a line break', () => {
    const html = parseNoteMarkdown('energy\n$E=mc^2$');
    expect(html).toContain('<math');
    expect(html).toContain('<msup>');
    expect(html).toContain('class="katex"');
  });

  it('strips scripts and event handlers', () => {
    const html = parseNoteMarkdown('<script>alert(1)</script><img src=x onerror=alert(1)>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
  });

  it('drops javascript: links but keeps http links', () => {
    const html = parseNoteMarkdown('[bad](javascript:alert(1)) [ok](https://example.com)');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="https://example.com"');
  });

  it('removes iframes, forms, styles, and inline svg', () => {
    const html = parseNoteMarkdown(
      '<iframe src="https://x"></iframe><form><input name=a></form><style>p{display:none}</style><svg onload=alert(1)></svg>',
    );
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('<style');
    expect(html).not.toContain('<svg');
  });
});
