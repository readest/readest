import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { Renderer } from '@/types/view';

// Loading a section runs the host's content transforms over it and builds its
// document. Where nothing that load awaits yields to the event loop (Readest
// Lite), it runs as one task: up to a second on a Kindle. A page turn that left
// fewer than five pages loaded ahead started preloading the next section from
// the container's scroll listener, before the turned page was painted.

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

describe('Paginator preload', () => {
  let paginator: Renderer;

  beforeAll(async () => {
    await import('foliate-js/paginator.js');
  }, 30000);

  afterEach(() => {
    paginator?.destroy();
    paginator?.remove();
  });

  it('preloads the next section after the turned page is painted', async () => {
    const ch3 = makeColumns('ch3', 2);
    let painted = false;
    let startedBeforePaint: boolean | undefined;
    paginator = document.createElement('foliate-paginator') as Renderer;
    Object.assign(paginator.style, {
      width: '800px',
      height: '600px',
      position: 'absolute',
      left: '0',
      top: '0',
    });
    document.body.appendChild(paginator);
    // Two columns a page: ch1 is 2 pages and ch2 4, so the book opens with
    // five pages ahead and ch3 unloaded.
    paginator.open({
      dir: 'ltr',
      sections: [
        makeColumns('ch1', 4),
        makeColumns('ch2', 8),
        {
          ...ch3,
          load: () => {
            startedBeforePaint ??= !painted;
            return ch3.load();
          },
        },
      ],
    } as unknown as Parameters<Renderer['open']>[0]);
    await paginator.goTo({ index: 0, anchor: 0 });
    await wait(600);
    expect(paginator.columnCount).toBe(2);
    expect(startedBeforePaint).toBeUndefined();

    for (let turn = 0; turn < 3 && startedBeforePaint === undefined; turn++) {
      painted = false;
      // A task queued from the next frame's callbacks runs once that frame,
      // the first to show the turned page, is painted.
      requestAnimationFrame(() => setTimeout(() => (painted = true)));
      await paginator.next();
      await wait(300);
    }
    expect(startedBeforePaint).toBe(false);
  });
});
