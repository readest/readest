import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import type { BookDoc } from '@/libs/document';
import type { Renderer } from '@/types/view';
import { CHUNK_ATTRIBUTE } from 'foliate-js/section-chunks.js';

// A book whose middle spine item holds ~1.2 MB in one file, like a
// single-file book or a concordance: the paginator renders it in chunks but
// must keep reporting spine index 1 and section-wide fractions.
const PARAGRAPHS = 9000;
const FILLER = 'In the beginning was the Word, and the Word was with God. '.repeat(2);

const html = (body: string) =>
  `<!DOCTYPE html><html><head><title>T</title></head><body>${body}</body></html>`;

const makeSection = (id: string, body: string, delay = 0) => {
  const content = html(body);
  const url = URL.createObjectURL(new Blob([content], { type: 'text/html' }));
  return {
    id,
    linear: 'yes',
    size: content.length,
    // a reader's loads take a while (unzipping, transforms)
    load: () => new Promise((resolve) => setTimeout(() => resolve(url), delay)),
    loadContent: () => content,
    unload: () => {},
  };
};

const paragraphs = (n = PARAGRAPHS) =>
  Array.from({ length: n }, (_, i) => `<p id="p${i}">${i}. ${FILLER}</p>`);
// Converters often wrap the whole body in one element
const wrap = (blocks: string[]) => [`<div class="wrapper">${blocks.join('\n')}</div>`];

const makeBook = (big = paragraphs(), delay = 0) =>
  ({
    dir: 'ltr',
    sections: [
      makeSection('a.html', '<p id="a0">Before</p>'),
      makeSection('big.html', big.join('\n'), delay),
      makeSection('c.html', '<p id="c0">After</p>'),
    ],
  }) as unknown as BookDoc;

const waitFor = (el: HTMLElement, type: string, timeout = 15000) =>
  new Promise<Event>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${type} timeout`)), timeout);
    el.addEventListener(
      type,
      (e) => {
        clearTimeout(timer);
        resolve(e);
      },
      { once: true },
    );
  });

describe('Paginator chunked section (browser)', () => {
  let paginator: Renderer;
  let relocations: { index: number; fraction: number; range: Range; reason: string }[];

  beforeAll(async () => {
    await import('foliate-js/paginator.js');
  });

  afterEach(() => {
    paginator?.destroy?.();
    paginator?.remove();
  });

  const open = (book = makeBook()) => {
    paginator = document.createElement('foliate-paginator') as Renderer;
    Object.assign(paginator.style, { width: '800px', height: '600px', display: 'block' });
    document.body.append(paginator);
    relocations = [];
    paginator.addEventListener('relocate', (e) => {
      const { index, fraction, range, reason } = (e as CustomEvent).detail;
      relocations.push({ index, fraction, range, reason });
    });
    paginator.open(book);
  };

  it('lands on an anchor deep in a chunked section and reports the spine index', async () => {
    open();
    const target = 6000;
    const stabilized = waitFor(paginator, 'stabilized');
    const t0 = performance.now();
    await paginator.goTo({
      index: 1,
      anchor: ((doc: Document) => doc.getElementById(`p${target}`)) as unknown as (
        doc: Document,
      ) => Range,
    });
    await stabilized;
    const elapsed = performance.now() - t0;

    expect(paginator.primaryIndex).toBe(1);
    const contents = paginator.getContents();
    expect(contents.every((c) => [0, 1, 2].includes(c.index ?? -1))).toBe(true);
    const holder = contents.find(
      (c) => c.index === 1 && !c.doc.getElementById(`p${target}`)?.hasAttribute(CHUNK_ATTRIBUTE),
    );
    expect(holder).toBeDefined();
    const el = holder!.doc.getElementById(`p${target}`)!;
    // the chunk holds the real paragraph, and only part of the section
    expect(el.textContent).toContain(`${target}.`);
    const real = holder!.doc.body.querySelectorAll(`:scope > :not([${CHUNK_ATTRIBUTE}])`).length;
    expect(real).toBeLessThan(PARAGRAPHS / 2);

    const last = relocations.at(-1)!;
    expect(last.index).toBe(1);
    expect(last.fraction).toBeGreaterThan(target / PARAGRAPHS - 0.1);
    expect(last.fraction).toBeLessThan(target / PARAGRAPHS + 0.1);
    // a 1.2 MB section rendered whole takes far longer than one chunk
    expect(elapsed).toBeLessThan(5000);
  });

  it.each([
    ['top-level blocks', paragraphs()],
    ['blocks in a wrapper', wrap(paragraphs())],
  ])('pages forward across a chunk boundary within the same section (%s)', async (_, big) => {
    open(makeBook(big));
    const stabilized = waitFor(paginator, 'stabilized');
    // near the end of the first of five chunks
    await paginator.goTo({ index: 1, anchor: 0.199 });
    await stabilized;
    const start = relocations.at(-1)!;
    expect(start.index).toBe(1);

    const startDoc = start.range.startContainer.ownerDocument;
    for (let i = 0; i < 40; i++) {
      await paginator.next();
      if (relocations.at(-1)!.range.startContainer.ownerDocument !== startDoc) break;
    }
    const end = relocations.at(-1)!;
    expect(end.index).toBe(1);
    expect(end.fraction).toBeGreaterThan(start.fraction);
    expect(end.range.startContainer.ownerDocument).not.toBe(startDoc);

    // Right past the boundary both chunks are rendered; consumers that look up
    // "the section's document" by spine index must get the one on screen
    const contents = paginator.getContents();
    expect(contents.filter((c) => c.index === 1).length).toBeGreaterThan(1);
    const primary = contents.find((c) => c.index === paginator.primaryIndex);
    expect(primary!.doc).toBe(end.range.startContainer.ownerDocument);
  });

  it('reports a page turned onto a chunk still loading once it renders', async () => {
    // Hold every chunk after the one opened, as a loaded machine does: until
    // its document commits, the iframe holds its initial about:blank
    const srcdoc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'srcdoc')!;
    const held: (() => void)[] = [];
    let loads = 0;
    Object.defineProperty(HTMLIFrameElement.prototype, 'srcdoc', {
      ...srcdoc,
      set(this: HTMLIFrameElement, value: string) {
        if (loads++ === 0) srcdoc.set!.call(this, value);
        else held.push(() => srcdoc.set!.call(this, value));
      },
    });
    let start: (typeof relocations)[number];
    let turned: number;
    try {
      open();
      // one column, so the next chunk starts on a page of its own
      paginator.setAttribute('max-column-count', '1');
      const stabilized = waitFor(paginator, 'stabilized');
      await paginator.goTo({ index: 1, anchor: 0.199 });
      await stabilized;
      start = relocations.at(-1)!;
      const startDoc = start.range.startContainer.ownerDocument;
      // page onto the next chunk's placeholder while it loads
      await vi.waitFor(() => expect(held.length).toBeGreaterThan(0));
      for (let i = 0; i < 40; i++) {
        const count = relocations.length;
        await paginator.next();
        if (relocations.length === count) break;
        if (relocations.at(-1)!.range.startContainer.ownerDocument !== startDoc) break;
      }
      expect(relocations.map((r) => r.range.startContainer.ownerDocument!.URL)).not.toContain(
        'about:blank',
      );
      // a resize re-anchors meanwhile: it must keep the page turned to
      turned = relocations.length;
      paginator.render?.();
    } finally {
      Object.defineProperty(HTMLIFrameElement.prototype, 'srcdoc', srcdoc);
    }
    const relocated = waitFor(paginator, 'relocate', 5000);
    held.splice(0).forEach((load) => load());
    await relocated;

    const end = relocations[turned]!;
    expect(end.reason).toBe('page');
    expect(end.index).toBe(1);
    expect(end.fraction).toBeGreaterThan(start.fraction);
    const primary = paginator.getContents().find((c) => c.index === paginator.primaryIndex);
    expect(end.range.startContainer.ownerDocument).toBe(primary!.doc);
    // the chunk's first page, where the turn landed
    const first = primary!.doc.body.querySelector(`:scope > :not([${CHUNK_ATTRIBUTE}])`)!;
    expect(end.range.intersectsNode(first)).toBe(true);
  });

  it('reports a position scrolled onto a chunk still loading once it renders', async () => {
    open();
    paginator.setAttribute('flow', 'scrolled');
    // let the navigation settle: its fill loads the next chunk too
    const settled = new Promise<void>((resolve) => {
      let count = 0;
      paginator.addEventListener('stabilized', () => ++count === 2 && resolve());
    });
    await paginator.goTo({ index: 1, anchor: 0.199 });
    await settled;
    await new Promise((r) => setTimeout(r, 100));

    // Hold the chunk after it, which scrolling to its end preloads
    const srcdoc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'srcdoc')!;
    const held: (() => void)[] = [];
    Object.defineProperty(HTMLIFrameElement.prototype, 'srcdoc', {
      ...srcdoc,
      set(this: HTMLIFrameElement, value: string) {
        if (value.includes('>4500. ')) held.push(() => srcdoc.set!.call(this, value));
        else srcdoc.set!.call(this, value);
      },
    });
    const scroll = async (top: number) => {
      container.scrollTop = top;
      // past the scroll listener's debounce
      await new Promise((r) => setTimeout(r, 500));
    };
    const container = paginator.shadowRoot!.getElementById('container')!;
    let turned: number;
    try {
      await scroll(container.scrollHeight - container.clientHeight);
      await vi.waitFor(() => expect(held.length).toBe(1));
      // scroll onto its placeholder, the chunk before's last pixel still in
      // view: it holds no text to report either
      const placeholder = Array.from(container.children).find(
        (el) => el.querySelector('iframe')?.contentDocument?.URL === 'about:blank',
      ) as HTMLElement;
      turned = relocations.length;
      await scroll(placeholder.offsetTop - 1);
      expect(container.scrollTop).toBe(placeholder.offsetTop - 1);
      expect(relocations.slice(turned)).toEqual([]);
    } finally {
      Object.defineProperty(HTMLIFrameElement.prototype, 'srcdoc', srcdoc);
    }
    const relocated = waitFor(paginator, 'relocate', 5000);
    held.splice(0).forEach((load) => load());
    await relocated;

    const end = relocations[turned]!;
    expect(end.reason).toBe('scroll');
    expect(end.index).toBe(1);
    const primary = paginator.getContents().find((c) => c.index === paginator.primaryIndex);
    expect(end.range.startContainer.ownerDocument).toBe(primary!.doc);
    const first = primary!.doc.body.querySelector(`:scope > :not([${CHUNK_ATTRIBUTE}])`)!;
    expect(end.range.intersectsNode(first)).toBe(true);
  });

  // A concordance-like section: tens of thousands of short entries, so every
  // chunk holds a few hundred of them and tens of thousands of placeholders.
  const refs = Array.from({ length: 30 }, (_, j) => `<a href="#e${j}">${j}:1</a>`).join(' ');
  const entries = Array.from({ length: 40000 }, (_, i) => `<p id="e${i}">w${i}: ${refs}</p>`);
  it.each([
    ['top-level entries', entries],
    ['entries in a wrapper', wrap(entries)],
  ])('turns pages without measuring the placeholders (%s)', async (_, big) => {
    open(makeBook(big));
    const stabilized = waitFor(paginator, 'stabilized');
    await paginator.goTo({ index: 1, anchor: 0.5 });
    await stabilized;

    let measured = 0;
    const restores = paginator.getContents().map(({ doc }) => {
      const proto = (doc.defaultView as unknown as typeof window).Element.prototype;
      const orig = proto.getBoundingClientRect;
      proto.getBoundingClientRect = function (this: Element) {
        if (this.hasAttribute(CHUNK_ATTRIBUTE)) measured++;
        return orig.call(this);
      };
      return () => (proto.getBoundingClientRect = orig);
    });
    for (let i = 0; i < 5; i++) await paginator.next();
    restores.forEach((restore) => restore());

    expect(relocations.at(-1)!.index).toBe(1);
    expect(measured).toBe(0);
  });

  it('pages over the chunks a wrapper inside a wrapper leaves empty', async () => {
    // Only one level of wrapper is cut: the inner one stays whole in the
    // first chunk, and the chunks it spans hold nothing to show.
    open(makeBook([`<div><div>${paragraphs(4500).join('\n')}</div></div>`, '<p id="end">End</p>']));
    let stabilized = waitFor(paginator, 'stabilized');
    await paginator.goTo({ index: 2, anchor: 0 });
    await stabilized;

    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      await paginator.prev();
      const { index, range } = relocations.at(-1)!;
      seen.push(`${index}:${range.toString().trim().slice(0, 12)}`);
    }
    // back from the next section (whose page shares the closing paragraph)
    // straight into the end of the wrapped text: the empty chunks are neither
    // shown nor rendered
    expect(seen).toEqual([
      expect.stringMatching(/^1:44\d\d\./),
      expect.stringMatching(/^1:44\d\d\./),
      expect.stringMatching(/^1:44\d\d\./),
    ]);
    expect(paginator.getContents().every((c) => c.doc.body.textContent!.trim())).toBe(true);

    // a fraction in the span of the empty chunks lands in the wrapped text
    stabilized = waitFor(paginator, 'stabilized');
    await paginator.goTo({ index: 1, anchor: 0.6 });
    await stabilized;
    const { fraction, range } = relocations.at(-1)!;
    expect(range.toString().trim()).not.toBe('');
    expect(fraction).toBeGreaterThan(0.5);
    expect(fraction).toBeLessThan(0.7);
  });

  it('keeps the target of a jump past a long chunk while it loads', async () => {
    // A jump keeps the views near its target. A scroll that settles while the
    // target still loads (a dropped view shifting the pages) finds the old
    // position, tens of pages before the target: the target must stay the
    // primary view, not be trimmed as far off screen.
    open();
    let stabilized = waitFor(paginator, 'stabilized');
    await paginator.goTo({ index: 1, anchor: 0 });
    await stabilized;

    // a reader's load takes a while (styles, transforms): hold the iframe's
    // load event past the 250 ms the scroll handler waits for
    const { addEventListener } = HTMLIFrameElement.prototype;
    HTMLIFrameElement.prototype.addEventListener = function (
      this: HTMLIFrameElement,
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) {
      const held =
        type === 'load' && typeof listener === 'function'
          ? (e: Event) => setTimeout(() => listener.call(this, e), 500)
          : listener;
      return addEventListener.call(this, type, held, options);
    } as typeof addEventListener;
    try {
      stabilized = waitFor(paginator, 'stabilized');
      const jump = paginator.goTo({ index: 1, anchor: 0.5 });
      await new Promise((r) => setTimeout(r, 100));
      paginator.shadowRoot!.getElementById('container')!.dispatchEvent(new Event('scroll'));
      await jump;
      await stabilized;
    } finally {
      HTMLIFrameElement.prototype.addEventListener = addEventListener;
    }
    await new Promise((r) => setTimeout(r, 500));
    const { index, fraction } = relocations.at(-1)!;
    expect(index).toBe(1);
    expect(fraction).toBeGreaterThan(0.45);
    expect(fraction).toBeLessThan(0.55);
  });
});
