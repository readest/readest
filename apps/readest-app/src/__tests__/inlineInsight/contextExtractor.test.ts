import { describe, expect, it } from 'vitest';
import { extractContext } from '@/services/inlineInsight/contextExtractor';
import type { TextSelection } from '@/utils/sel';

const createDoc = (body: string): Document =>
  new DOMParser().parseFromString(`<html><body>${body}</body></html>`, 'text/html');

function createSelection(doc: Document, text: string): TextSelection {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();

  while (node) {
    const offset = node.textContent?.indexOf(text) ?? -1;
    if (offset >= 0) {
      const range = doc.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + text.length);
      return {
        key: 'inlineinsight-test',
        text,
        page: 1,
        range,
        index: 0,
      };
    }
    node = walker.nextNode();
  }

  throw new Error(`Text not found: ${text}`);
}

describe('extractContext', () => {
  it('collects nearby readable blocks across nested chapter content', () => {
    const doc = createDoc(`
      <main>
        <section>
          <h1>Knowledge</h1>
          <p>Before paragraph with doxa and common opinion.</p>
          <p>The Greek word episteme appears in the selected sentence.</p>
          <p>After paragraph explains systematic knowledge.</p>
        </section>
      </main>
    `);

    const context = extractContext(createSelection(doc, 'episteme'), 200);

    expect(context).toContain('Before:');
    expect(context).toContain('Before paragraph with doxa');
    expect(context).toContain('Selected:\nepisteme');
    expect(context).toContain('After paragraph explains systematic knowledge');
  });

  it('uses same-block text around the selection before adjacent blocks', () => {
    const doc = createDoc(`
      <article>
        <p>Earlier block.</p>
        <p>Local before selected phrase local after.</p>
        <p>Later block.</p>
      </article>
    `);

    const context = extractContext(createSelection(doc, 'selected phrase'), 80);

    expect(context).toContain('Local before');
    expect(context).toContain('Selected:\nselected phrase');
    expect(context).toContain('local after');
  });

  it('skips script and style content', () => {
    const doc = createDoc(`
      <main>
        <p>Before visible text.</p>
        <script>secret script text</script>
        <p>target text</p>
        <style>.secret { content: "hidden" }</style>
        <p>After visible text.</p>
      </main>
    `);

    const context = extractContext(createSelection(doc, 'target'), 200);

    expect(context).toContain('Before visible text');
    expect(context).toContain('After visible text');
    expect(context).not.toContain('secret script text');
    expect(context).not.toContain('hidden');
  });
});
