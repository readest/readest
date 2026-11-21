// readest/readest#7732: the paginator takes focus only when a navigation asks
// for it, gives it back after a section load only when nothing else took it,
// and turns to the page of an element the browser scrolled to for focus.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { DocumentLoader } from '@/libs/document';
import type { BookDoc } from '@/libs/document';
import type { Renderer } from '@/types/view';

const EPUB_URL = new URL('../fixtures/data/sample-alice.epub', import.meta.url).href;

let book: BookDoc;

const loadEPUB = async () => {
  const resp = await fetch(EPUB_URL);
  const file = new File([await resp.arrayBuffer()], 'sample-alice.epub', {
    type: 'application/epub+zip',
  });
  return (await new DocumentLoader(file).open()).book;
};

const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));

// The fixture's chapters are several pages long at 800x600.
const CHAPTER = 6;

describe('Paginator focus (browser)', () => {
  let paginator: Renderer;
  let outside: HTMLButtonElement;

  beforeAll(async () => {
    book = await loadEPUB();
    await import('foliate-js/paginator.js');
  }, 30000);

  const setup = async () => {
    outside = document.createElement('button');
    outside.textContent = 'Outside';
    document.body.appendChild(outside);
    paginator = document.createElement('foliate-paginator') as Renderer;
    Object.assign(paginator.style, {
      width: '800px',
      height: '600px',
      position: 'absolute',
      left: '0',
      top: '40px',
    });
    document.body.appendChild(paginator);
    paginator.open(book);
    await paginator.goTo({ index: CHAPTER });
    await settle();
  };

  const primaryDoc = () => {
    const content = paginator.getContents().find((c) => c.index === paginator.primaryIndex);
    return content!.doc;
  };

  // A Range in the middle of the chapter, as a CFI resolves to.
  const midChapterRange = (doc: Document) => {
    const ps = doc.querySelectorAll('p');
    const p = ps[Math.floor(ps.length / 2)]!;
    const range = doc.createRange();
    range.setStart(p.firstChild!, 0);
    return range;
  };

  afterEach(() => {
    try {
      paginator?.destroy();
    } catch {
      /* iframe body may already be torn down */
    }
    paginator?.remove();
    outside?.remove();
  });

  it('leaves focus where it is when a navigation does not ask for it', async () => {
    await setup();
    outside.focus();
    await paginator.goTo({ index: CHAPTER, anchor: midChapterRange });
    await settle();
    expect(document.activeElement).toBe(outside);
    expect(primaryDoc().activeElement).toBe(primaryDoc().body);
  });

  it('moves focus to the destination when the navigation asks for it', async () => {
    await setup();
    outside.focus();
    await paginator.goTo({ index: CHAPTER, anchor: midChapterRange, focus: true });
    await settle();
    expect(document.activeElement).toBe(paginator);
    expect(primaryDoc().activeElement?.localName).toBe('p');
  });

  it('keeps the focus another element took while a navigation ran', async () => {
    await setup();
    paginator.focusView!();
    await settle(50);
    // The book had focus when the navigation started; a dialog takes it
    // before the navigation ends.
    paginator.addEventListener('relocate', () => outside.focus(), { once: true });
    await paginator.goTo({ index: CHAPTER, anchor: 0.5 });
    await settle();
    expect(document.activeElement).toBe(outside);
  });

  it('turns to the page of an element the browser scrolled to for focus', async () => {
    await setup();
    const doc = primaryDoc();
    const ps = [...doc.querySelectorAll('p')];
    const target = ps[Math.floor(ps.length * 0.7)]!;
    target.tabIndex = 0;
    target.focus(); // like Tab or a screen reader moving focus: scrolls into view
    await settle();
    const afterFocus = paginator.containerPosition;
    // Where the paginator itself puts that element: the start of its page.
    await paginator.scrollToAnchor!(target);
    await settle();
    expect(afterFocus).toBe(paginator.containerPosition);
  });

  it('does not move when focus returns to an element without scrolling', async () => {
    await setup();
    const doc = primaryDoc();
    const first = doc.querySelector('p')!;
    first.tabIndex = -1;
    first.focus({ preventScroll: true });
    await settle();
    const start = paginator.containerPosition;
    await paginator.next();
    await settle();
    const before = paginator.containerPosition;
    expect(before).toBeGreaterThan(start);
    // The window becoming active again re-fires focus on the element that
    // held it, pages ago.
    first.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await settle();
    expect(paginator.containerPosition).toBe(before);
  });
});
