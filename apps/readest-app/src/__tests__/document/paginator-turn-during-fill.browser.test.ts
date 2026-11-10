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
});
