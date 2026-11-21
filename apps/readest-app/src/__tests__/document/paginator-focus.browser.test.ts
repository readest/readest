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

  // A TOC entry for a chapter's start has no fragment: its anchor is 0.
  it.each([
    false,
    true,
  ])('moves focus to the start of a section when asked (scrolled: %s)', async (scrolled) => {
    await setup();
    if (scrolled) {
      paginator.setAttribute('flow', 'scrolled');
      await settle();
    }
    outside.focus();
    await paginator.goTo({ index: CHAPTER + 2, focus: true });
    await settle();
    expect(document.activeElement).toBe(paginator);
    const doc = primaryDoc();
    const focused = doc.activeElement as HTMLElement;
    expect(focused).not.toBe(doc.body);
    // The focused element is where the section starts: its first text.
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        n.textContent!.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP,
    });
    expect(focused.contains(walker.nextNode())).toBe(true);
  });

  it('keeps a focused link in the tab order, with its focus ring', async () => {
    await setup();
    outside.focus();
    let link!: HTMLAnchorElement;
    await paginator.goTo({
      index: CHAPTER,
      anchor: (doc: Document) => {
        const p = doc.querySelectorAll('p')[3]!;
        link = doc.createElement('a');
        link.href = '#here';
        link.textContent = 'a link';
        p.prepend(link);
        // a Range starting in the link, as a CFI to it resolves
        const range = doc.createRange();
        range.setStart(link.firstChild!, 0);
        return range;
      },
      focus: true,
    });
    await settle();
    expect(primaryDoc().activeElement).toBe(link);
    expect(link.tabIndex).toBe(0);
    expect(link.style.outline).toBe('');
  });

  it('focuses the start of a short section, not the next one, when scrolled', async () => {
    await setup();
    paginator.setAttribute('flow', 'scrolled');
    // Tall enough that "About" fills well under half of it
    paginator.style.height = '2400px';
    // Load "About" and the sections after it first, so the next one is
    // already rendered below it when the jump lands.
    await paginator.goTo({ index: 2 });
    await settle(1500);
    outside.focus();
    // "About" is far shorter than the viewport; the next section is preloaded
    // below it and covers the viewport's centre.
    await paginator.goTo({ index: 1, focus: true });
    await settle(600);
    const about = paginator.getContents().find((c) => c.index === 1)!;
    expect(document.activeElement).toBe(paginator);
    expect(about.doc.activeElement).not.toBe(about.doc.body);
  });

  it('keeps a field the user focused while a navigation that asks for focus ran', async () => {
    await setup();
    outside.focus();
    const field = document.createElement('input');
    document.body.appendChild(field);
    try {
      // The user clicks into a field before the destination is reached.
      paginator.addEventListener('relocate', () => field.focus(), { once: true });
      await paginator.goTo({ index: CHAPTER, anchor: midChapterRange, focus: true });
      await settle();
      expect(document.activeElement).toBe(field);
    } finally {
      field.remove();
    }
  });

  it('turns to the page of a focused element in a neighboring section', async () => {
    await setup();
    // At the end of the section, the next one is preloaded next to it.
    await paginator.goTo({ index: CHAPTER, anchor: 1 });
    const start = Date.now();
    while (!paginator.getContents().some((c) => c.index === CHAPTER + 1)) {
      if (Date.now() - start > 10000) throw new Error('next section never loaded');
      await settle(100);
    }
    await settle();
    const next = paginator.getContents().find((c) => c.index === CHAPTER + 1)!;
    const target = next.doc.querySelector('p')!;
    target.tabIndex = 0;
    target.focus(); // Tab past the end of this section into the next one
    await settle();
    const frame = next.doc.defaultView!.frameElement!.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    const box = paginator.getBoundingClientRect();
    const left = frame.left + rect.left;
    expect(left).toBeGreaterThanOrEqual(box.left - 1);
    expect(left).toBeLessThan(box.right);
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
