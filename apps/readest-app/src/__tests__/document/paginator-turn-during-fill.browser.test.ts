import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { Renderer } from '@/types/view';

// A turn past the loaded pages waits for the sections still loading after a
// navigation. It then went to the section after the last one loaded by then,
// skipping the sections that wait had just loaded.

// A section of `columns` columns, one block each.
const makeColumns = (name: string, columns: number) => {
  const html = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><style>body { font: 16px/1.5 serif; }</style></head>
<body>${Array.from(
    { length: columns },
    (_, i) => `<div${i ? ' style="break-before: column"' : ''}>${name} column ${i}</div>`,
  ).join('')}</body></html>`;
  const src = URL.createObjectURL(new Blob([html], { type: 'application/xhtml+xml' }));
  return { id: name, linear: 'yes', size: html.length, load: async () => src };
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Paginator turn during fill', () => {
  let paginator: Renderer;

  beforeAll(async () => {
    await import('foliate-js/paginator.js');
  }, 30000);

  afterEach(() => {
    paginator?.destroy();
    paginator?.remove();
  });

  it('turns to the next page when the wait loads it', async () => {
    paginator = document.createElement('foliate-paginator') as Renderer;
    Object.assign(paginator.style, {
      width: '800px',
      height: '600px',
      position: 'absolute',
      left: '0',
      top: '0',
    });
    document.body.appendChild(paginator);
    // Two columns a page: ch1 is one page, the others two each.
    paginator.open({
      dir: 'ltr',
      sections: [
        makeColumns('ch1', 2),
        makeColumns('ch2', 4),
        makeColumns('ch3', 4),
        makeColumns('ch4', 4),
        makeColumns('ch5', 4),
      ],
    } as unknown as Parameters<Renderer['open']>[0]);
    let index: number | undefined;
    paginator.addEventListener('relocate', (e) => {
      index = (e as CustomEvent<{ index: number }>).detail.index;
    });
    // ch1 is shown; the sections after it are still loading.
    await paginator.goTo({ index: 0, anchor: 0 });
    expect(paginator.columnCount).toBe(2);
    await paginator.next();
    expect(index).toBe(1);
  });

  // One column a page: ch0 is eight pages, ch1 to ch6 one each, each taking
  // 400 ms to load (ch1 `ch1Delay`). Opens at ch0.
  const openSlowBook = async (ch1Delay = 400) => {
    paginator = document.createElement('foliate-paginator') as Renderer;
    Object.assign(paginator.style, {
      width: '800px',
      height: '600px',
      position: 'absolute',
      left: '0',
      top: '0',
    });
    paginator.setAttribute('max-column-count', '1');
    document.body.appendChild(paginator);
    const slow = (section: ReturnType<typeof makeColumns>, delay = 400) => ({
      ...section,
      load: async () => {
        await wait(delay);
        return section.load();
      },
    });
    paginator.open({
      dir: 'ltr',
      sections: [
        makeColumns('ch0', 8),
        ...Array.from({ length: 6 }, (_, i) =>
          slow(makeColumns(`ch${i + 1}`, 1), i ? 400 : ch1Delay),
        ),
      ],
    } as unknown as Parameters<Renderer['open']>[0]);
    const book = { index: undefined as number | undefined, loaded: [] as number[] };
    paginator.addEventListener('relocate', (e) => {
      book.index = (e as CustomEvent<{ index: number }>).detail.index;
    });
    paginator.addEventListener('load', (e) => {
      book.loaded.push((e as CustomEvent<{ index: number }>).detail.index);
    });
    await paginator.goTo({ index: 0, anchor: 0 });
    expect(paginator.columnCount).toBe(1);
    book.loaded.length = 0;
    return book;
  };

  // Entering a section starts loading sections until five pages are ready
  // ahead: after one-page sections, that is five loads in a row. A turn past
  // the loaded pages waited for all of them, where it needs only the next
  // (7 s on a Kindle).
  it('turns once the section it needs is loaded, not the ones after it', async () => {
    const book = await openSlowBook();
    // ch1 loads while the pages turn.
    for (let turn = 0; turn < 8; turn++) await paginator.next();
    expect(book.index).toBe(1);
    expect(book.loaded).toEqual([1]);
    // Entering ch1 started loading ch2 to ch6. This turn needs only ch2.
    await paginator.next();
    expect(book.index).toBe(2);
    expect(book.loaded).toEqual([1, 2]);
  });

  // A tap may turn again once the page the last turn went to is on screen,
  // before that turn has returned. A turn that starts waiting for a load then
  // kept waiting after the last turn stopped: the load was held back again,
  // as for any page turn, until the taps stopped (13 s on a Kindle).
  it('loads at once for a turn that starts as the last waiting one ends', async () => {
    // ch1 is still loading when the turns reach it.
    const book = await openSlowBook(1500);
    for (let turn = 0; turn < 7; turn++) await paginator.next();
    expect(book.index).toBe(0);
    const tap = () => paginator.next(undefined, { discrete: true });
    // The turn into ch1 waits for it; a tap in the frame that shows ch1 turns
    // on into ch2, which is not loaded yet.
    let second: Promise<void> | undefined;
    const container = paginator.shadowRoot!.querySelector('[part="container"]')!;
    container.addEventListener('scroll', () => requestAnimationFrame(() => (second ??= tap())), {
      once: true,
    });
    await tap();
    expect(book.loaded).toEqual([1]);
    expect(second).toBeDefined();
    let turned = false;
    second!.then(() => (turned = true));
    const taps = setInterval(tap, 200);
    try {
      await Promise.race([second, wait(2500)]);
      expect(turned).toBe(true);
      expect(book.loaded).toContain(2);
    } finally {
      clearInterval(taps);
    }
  });
});
