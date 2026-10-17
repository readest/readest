import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { BookDoc } from '@/libs/document';
import type { Renderer } from '@/types/view';

// A navigation hands focus back to the book when it ends. A text field the
// reader focused in the meantime (a note typed while Read Aloud turns the
// page, #6837) keeps it.
const html = (body: string) =>
  `<!DOCTYPE html><html><head><title>T</title></head><body>${body}</body></html>`;

const paragraphs = (prefix: string) =>
  Array.from({ length: 40 }, (_, i) => `<p id="${prefix}${i}">${prefix} ${i} text text</p>`).join(
    '',
  );

const makeSection = (id: string, body: string) => {
  const content = html(body);
  const url = URL.createObjectURL(new Blob([content], { type: 'text/html' }));
  return {
    id,
    linear: 'yes',
    size: content.length,
    load: async () => url,
    loadContent: () => content,
    unload: () => {},
  };
};

const waitFor = (el: HTMLElement, type: string, timeout = 10000) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${type} timeout`)), timeout);
    el.addEventListener(
      type,
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

describe('Paginator navigation and a focused text field (browser)', () => {
  let paginator: Renderer;
  let editor: HTMLTextAreaElement;
  let sections: ReturnType<typeof makeSection>[];

  beforeAll(async () => {
    await import('foliate-js/paginator.js');
  });

  afterEach(() => {
    paginator?.destroy?.();
    paginator?.remove();
    editor?.remove();
  });

  const open = async (noPreload = true) => {
    sections = [makeSection('a.html', paragraphs('a')), makeSection('b.html', paragraphs('b'))];
    paginator = document.createElement('foliate-paginator') as Renderer;
    if (noPreload) paginator.setAttribute('no-preload', '');
    Object.assign(paginator.style, { width: '800px', height: '600px', display: 'block' });
    document.body.append(paginator);
    editor = document.createElement('textarea');
    document.body.append(editor);
    const stabilized = waitFor(paginator, 'stabilized');
    paginator.open({ dir: 'ltr', sections } as unknown as BookDoc);
    await paginator.goTo({ index: 0 });
    await stabilized;
    // Read Aloud keeps focus in the book while it follows the voice
    (paginator as Renderer & { focusView: () => void }).focusView();
  };

  const bookHasFocus = () => paginator.getContents().some((c) => c.doc.hasFocus());
  const preloaded = async (index: number) => {
    for (let i = 0; i < 50 && !paginator.getContents().some((c) => c.index === index); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(paginator.getContents().some((c) => c.index === index)).toBe(true);
  };

  it('leaves focus in a text field focused while moving to a loaded section', async () => {
    await open(false);
    await preloaded(1);

    // the reader focuses the note mid-navigation, once the section is resolved
    await paginator.goTo({
      index: 1,
      anchor: (() => {
        editor.focus();
        return 0;
      }) as unknown as (doc: Document) => Range,
    });

    expect(document.activeElement).toBe(editor);
  });

  it('leaves focus in a text field when navigating to an anchor', async () => {
    await open();
    editor.focus();

    await paginator.goTo({
      index: 0,
      anchor: ((doc: Document) => doc.getElementById('a30')) as unknown as (doc: Document) => Range,
    });

    expect(document.activeElement).toBe(editor);
  });

  it('still hands focus back to the book when no text field took it', async () => {
    await open(false);
    await preloaded(1);

    await paginator.goTo({ index: 1 });

    expect(bookHasFocus()).toBe(true);
  });
});
