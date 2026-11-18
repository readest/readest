import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { FootnoteHandler } from 'foliate-js/footnotes.js';
import type { FoliateView } from '@/types/view';

// The reporters' books (#7564): FB2 converted to EPUB. A bare bracketed
// reference in the text, `<a href="ch2.xhtml#id17" class="a">[54]</a>`, points
// into a notes section where each note is an inline `<span id>` placed straight
// in `<body>`, wrapping a title block with the note's number and its text, with
// no link back to the reference:
//
//   <span id="id17"><div class="title1"><p class="p">54</p></div>
//   <p class="p1">Note text.</p></span>
//
// foliate climbed from the inline span to `<body>` and gave up, and `check`
// (earned by the `[54]` text) rejected a note with no backlink. The popup
// showed the whole notes section, or the reader jumped to it.
const NOTES_BODY = `
  <div class="title"><p class="p">Примечания</p></div>
  <span id="id18"><div class="title1">
  <p class="p">53</p>
  </div><p class="p1">Предыдущее примечание.</p></span>
  <span id="id17"><div class="title1">
  <p class="p">54</p>
  </div><p class="p1">Мексиканская революция 1910–1917 гг.</p></span>
  <span id="id15"><div class="title1">
  <p class="p">55</p>
  </div><p class="p1">Первый абзац длинного примечания.</p><p class="p1">Второй абзац.</p><p class="p1">Третий абзац.</p><p class="p1">Четвёртый абзац.</p></span>
  <span id="id13"><div class="title1">
  <p class="p">56</p>
  </div><p class="p1">Следующее примечание.</p></span>
  <div id="ch5"><h2>5. Глава</h2><p>Абзац.</p><p>Абзац.</p><p>Абзац.</p></div>
`;

const TEXT_BODY = `
  <p class="p1">Краузе слышал про мексиканского бандита, который во время беспорядков
  семнадцатого года<a href="ch2.xhtml#id17" class="a">[54]</a> терроризировал округу.</p>
  <p class="p1">Длинное примечание<a href="ch2.xhtml#id15" class="a">[55]</a>.</p>
  <p class="p1">Неверный номер<a href="ch2.xhtml#id13" class="a">[9]</a>.</p>
  <p class="p1">См. главу<a href="ch2.xhtml#ch5" class="a">[5]</a>.</p>
`;

const xhtml = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>T</title></head><body class="z">${body}</body></html>`;

const makeSection = (id: string, body: string) => {
  const content = xhtml(body);
  const url = URL.createObjectURL(new Blob([content], { type: 'application/xhtml+xml' }));
  return {
    id,
    linear: 'yes',
    size: content.length,
    load: () => url,
    loadContent: () => content,
    unload: () => {},
    resolveHref: (href: string) => href,
  };
};

const makeBook = () => ({
  dir: 'ltr',
  sections: [makeSection('ch1.xhtml', TEXT_BODY), makeSection('ch2.xhtml', NOTES_BODY)],
  resolveHref: (href: string) => {
    const id = href.split('#')[1]!;
    return { index: 1, anchor: (doc: Document) => doc.getElementById(id) };
  },
});

const getRefAnchor = (id: string) => {
  const doc = new DOMParser().parseFromString(xhtml(TEXT_BODY), 'application/xhtml+xml');
  return doc.querySelector(`a[href="ch2.xhtml#${id}"]`) as HTMLAnchorElement;
};

describe('Footnote popup for a note wrapped in a body-level span (#7564, browser)', () => {
  let popup: HTMLElement | undefined;

  beforeAll(async () => {
    await import('foliate-js/view.js');
  });

  afterEach(() => {
    popup?.remove();
    popup = undefined;
  });

  const openPopup = (id: string) => {
    const handler = new FootnoteHandler();
    handler.addEventListener('before-render', (e) => {
      popup = (e as CustomEvent<{ view: FoliateView }>).detail.view as unknown as HTMLElement;
      Object.assign(popup.style, { display: 'block', width: '400px', height: '300px' });
      document.body.append(popup);
    });
    const rendered = new Promise<FoliateView>((resolve) => {
      handler.addEventListener('render', (e) =>
        resolve((e as CustomEvent<{ view: FoliateView }>).detail.view),
      );
    });
    // Readest asks for `check` on a link whose text looks like a note marker.
    const detail = { a: getRefAnchor(id), href: `ch2.xhtml#${id}`, check: true };
    const event = new CustomEvent('link', { cancelable: true, detail });
    const handled = handler.handle(makeBook(), event);
    return { handled, rendered };
  };

  const popupText = (view: FoliateView) =>
    view.renderer.getContents()[0]!.doc.body.textContent!.replace(/\s+/g, ' ').trim();

  it('shows only the note that starts with the reference number', async () => {
    const { handled, rendered } = await openPopup('id17');
    await handled;
    expect(popupText(await rendered)).toBe('54 Мексиканская революция 1910–1917 гг.');
  });

  it('shows every paragraph of a long note that starts with the reference number', async () => {
    const { handled, rendered } = await openPopup('id15');
    await handled;
    const text = popupText(await rendered);
    expect(text).toContain('Первый абзац длинного примечания.');
    expect(text).toContain('Четвёртый абзац.');
    expect(text).not.toContain('Примечания');
    expect(text).not.toContain('Следующее примечание.');
  });

  it('still rejects a note that does not start with the reference number', async () => {
    const { handled } = await openPopup('id13');
    await expect(handled).rejects.toThrow('Failed to locate footnote content');
  });

  it('still rejects a long block that opens with the reference number', async () => {
    const { handled } = await openPopup('ch5');
    await expect(handled).rejects.toThrow('Failed to locate footnote content');
  });
});
