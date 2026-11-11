import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Renderer } from '@/types/view';

// Loading a section runs the host's content transforms over it and builds its
// document. Where nothing that load awaits yields to the event loop (Readest
// Lite), each step runs as one task: up to a second on a Kindle. A page turn
// that left fewer than five pages loaded ahead started preloading the next
// section from the container's scroll listener, before the turned page was
// painted, and the next turns waited behind the rest of that load.
//
// Holding a preload back until no page had turned for a second then made a
// reader turning pages faster than that reach the end of the loaded pages
// with the next section not started: that turn waited for all of its load,
// about 4 s on a Kindle.

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

  // Two columns a page: ch1 is 2 pages and ch2 4, so the book opens with five
  // pages ahead and ch3 unloaded. `onLoad` runs when ch3 starts loading.
  const open = async (onLoad: () => void) => {
    const ch3 = makeColumns('ch3', 2);
    paginator = document.createElement('foliate-paginator') as Renderer;
    Object.assign(paginator.style, {
      width: '800px',
      height: '600px',
      position: 'absolute',
      left: '0',
      top: '0',
    });
    document.body.appendChild(paginator);
    paginator.open({
      dir: 'ltr',
      sections: [
        makeColumns('ch1', 4),
        makeColumns('ch2', 8),
        {
          ...ch3,
          load: () => {
            onLoad();
            return ch3.load();
          },
        },
      ],
    } as unknown as Parameters<Renderer['open']>[0]);
    await paginator.goTo({ index: 0, anchor: 0 });
    await wait(600);
    expect(paginator.columnCount).toBe(2);
  };

  it('preloads the next section after the turned page is painted', async () => {
    let painted = false;
    let startedBeforePaint: boolean | undefined;
    await open(() => (startedBeforePaint ??= !painted));
    expect(startedBeforePaint).toBeUndefined();

    for (let turn = 0; turn < 3 && startedBeforePaint === undefined; turn++) {
      painted = false;
      // A task queued from the next frame's callbacks runs once that frame,
      // the first to show the turned page, is painted.
      requestAnimationFrame(() => setTimeout(() => (painted = true)));
      await paginator.next();
      await wait(300);
    }
    await vi.waitFor(() => expect(startedBeforePaint).toBeDefined(), { timeout: 3000 });
    expect(startedBeforePaint).toBe(false);
  });

  it('preloads between page turns, without waiting for them to stop', async () => {
    let loaded = false;
    await open(() => (loaded = true));

    // Pages 1 to 4 are all loaded: the first turn leaves four ahead.
    for (let turn = 0; turn < 4; turn++) {
      await paginator.next();
      await wait(200);
    }
    expect(loaded).toBe(true);
  });
});
