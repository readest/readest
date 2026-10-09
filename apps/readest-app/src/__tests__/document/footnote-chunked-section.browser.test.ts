import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { FootnoteHandler } from 'foliate-js/footnotes.js';
import type { FoliateView } from '@/types/view';

// Notes kept at the end of a single-file book: the notes section is big enough
// that the paginator renders it in chunks (foliate-js section-chunks.js), and a
// note deep inside lives in a later chunk.
const NOTES = 9000;
const FILLER = 'In the beginning was the Word, and the Word was with God. '.repeat(2);

const makeSection = (id: string, body: string) => {
  const content = `<!DOCTYPE html><html><head><title>T</title></head><body>${body}</body></html>`;
  const url = URL.createObjectURL(new Blob([content], { type: 'text/html' }));
  return {
    id,
    linear: 'yes',
    size: content.length,
    load: () => url,
    loadContent: () => content,
    unload: () => {},
  };
};

const makeBook = () => {
  const notes = Array.from(
    { length: NOTES },
    (_, i) => `<aside epub:type="footnote" id="n${i}"><p>Note ${i}. ${FILLER}</p></aside>`,
  );
  return {
    dir: 'ltr',
    sections: [makeSection('notes.html', notes.join('\n'))],
    resolveHref: (href: string) => {
      const id = href.split('#')[1]!;
      return { index: 0, anchor: (doc: Document) => doc.getElementById(id) };
    },
  };
};

describe('Footnote popup into a chunked section (browser)', () => {
  let popup: HTMLElement | undefined;

  beforeAll(async () => {
    await import('foliate-js/view.js');
  });

  afterEach(() => {
    popup?.remove();
  });

  it('shows a note that lives in a later chunk', async () => {
    const handler = new FootnoteHandler();
    handler.addEventListener('before-render', (e) => {
      popup = (e as CustomEvent<{ view: FoliateView }>).detail.view as unknown as HTMLElement;
      Object.assign(popup.style, { display: 'block', width: '400px', height: '300px' });
      document.body.append(popup);
    });
    const rendered = new Promise<FoliateView>((resolve) =>
      handler.addEventListener('render', (e) =>
        resolve((e as CustomEvent<{ view: FoliateView }>).detail.view),
      ),
    );

    const a = document.createElement('a');
    a.setAttribute('href', 'notes.html#n7000');
    const event = new CustomEvent('link', {
      cancelable: true,
      detail: { a, href: 'notes.html#n7000', follow: true },
    });
    await handler.handle(makeBook(), event);

    const view = await rendered;
    const text = view.renderer.getContents()[0]!.doc.body.textContent!;
    expect(text).toContain('Note 7000.');
    expect(text).not.toContain('Note 0.');
  });
});
