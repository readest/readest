import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { Renderer } from '@/types/view';

// A page turn scrolls the container and relocates right away (#scrollTo ->
// #afterScroll). The container's scroll event then reached the debounced
// listener, which ran #afterScroll('container-scroll') again 250 ms later at
// the same position: a second visible-range walk, CFI and relocate per turn,
// and a second progress commit in the host. A scroll the paginator didn't
// make (native scrolling, a clamp after reflow) must still relocate, and so
// must a turn whose page reflowed before that listener ran.

const makeHtml = (writingMode: string) => `<!doctype html><html><head><style>
  html { writing-mode: ${writingMode}; } html, body { margin: 0; }
  p { margin: 0 0 24px; line-height: 24px; }
</style></head><body>${Array.from(
  { length: 200 },
  (_, i) => `<p>Paragraph ${i + 1} of the only chapter, long enough to fill a line.</p>`,
).join('')}</body></html>`;

const makeBook = (dir: string, writingMode: string) => {
  const html = makeHtml(writingMode);
  const src = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  return {
    dir,
    sections: [{ id: 'ch1', linear: 'yes', size: html.length, load: async () => src }],
  };
};

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

type Book = ReturnType<typeof makeBook>;
type RelocateDetail = { reason: string; fraction: number; index: number; range: Range };
type Paginator = Renderer & { scrollProp: 'scrollLeft' | 'scrollTop' };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const cases = [
  { name: 'left to right', dir: 'ltr', writingMode: 'horizontal-tb', step: 1 },
  { name: 'right to left', dir: 'rtl', writingMode: 'horizontal-tb', step: -1 },
  { name: 'vertical', dir: 'ltr', writingMode: 'vertical-rl', step: 1 },
];

describe('Paginator page turn', () => {
  let paginator: Paginator;
  let relocates: RelocateDetail[];

  beforeAll(async () => {
    await import('foliate-js/paginator.js');
  }, 30000);

  const open = async (book: Book) => {
    paginator = document.createElement('foliate-paginator') as Paginator;
    Object.assign(paginator.style, {
      width: '800px',
      height: '600px',
      position: 'absolute',
      left: '0',
      top: '0',
    });
    document.body.appendChild(paginator);
    paginator.open(book as unknown as Parameters<Renderer['open']>[0]);
    await paginator.goTo({ index: 0, anchor: 0 });
    // past the debounced scroll of the opening navigation
    await wait(600);
    relocates = [];
    paginator.addEventListener('relocate', (e) => {
      relocates.push((e as CustomEvent<RelocateDetail>).detail);
    });
  };

  afterEach(() => {
    paginator?.destroy();
    paginator?.remove();
  });

  it.each(cases)('relocates once per turn ($name)', async ({ dir, writingMode }) => {
    await open(makeBook(dir, writingMode));
    await paginator.next();
    await wait(600);
    expect(relocates.map((d) => d.reason)).toEqual(['page']);

    await paginator.next();
    await wait(600);
    expect(relocates.map((d) => d.reason)).toEqual(['page', 'page']);
  });

  it.each(cases)('still relocates on a scroll the paginator did not make ($name)', async ({
    dir,
    writingMode,
    step,
  }) => {
    await open(makeBook(dir, writingMode));
    await paginator.next();
    await wait(600);
    const container = paginator.shadowRoot!.getElementById('container')!;
    const turned = relocates[0]!.fraction;
    container[paginator.scrollProp] += step * paginator.size;
    await wait(600);
    expect(relocates.map((d) => d.reason)).toEqual(['page', 'container-scroll']);
    expect(relocates[1]!.fraction).toBeGreaterThan(turned);
  });

  it('relocates again when the page reflows while the next section loads', async () => {
    // Two columns a page: ch1 is 2 pages, ch2 4. Entering ch2 starts preloading
    // ch3, whose load never finishes, so the preload is still running when
    // the next turn's page reflows; a view that grows while sections preload
    // is not re-anchored.
    await open({
      dir: 'ltr',
      sections: [
        makeColumns('ch1', 4),
        makeColumns('ch2', 8),
        { id: 'ch3', linear: 'yes', size: 100, load: () => new Promise<string>(() => {}) },
      ],
    } as unknown as Book);
    expect(paginator.columnCount).toBe(2);
    await paginator.next();
    await paginator.next();
    await wait(600);
    expect(relocates.at(-1)!.index).toBe(1);
    relocates = [];

    await paginator.next();
    const turned = relocates[0]!.range.startContainer.textContent;
    const doc = paginator.getContents().find((c) => c.index === 1)!.doc;
    const extra = doc.createElement('div');
    extra.textContent = 'ch2 inserted column';
    doc.body.prepend(extra);
    doc.body.children[1]!.setAttribute('style', 'break-before: column');
    await wait(800);
    expect(relocates.map((d) => d.reason)).toEqual(['page', 'container-scroll']);
    expect(relocates[1]!.range.startContainer.textContent).not.toBe(turned);
  });
});
