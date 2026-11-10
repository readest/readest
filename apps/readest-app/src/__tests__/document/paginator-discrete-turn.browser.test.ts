import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { Renderer } from '@/types/view';

// A page turn holds the paginator until its relocate handlers and the work
// they queue have run: over a second on a Kindle, where a tap that came in
// meanwhile was dropped. A tap or key (`discrete`) may turn again once the
// page the last turn showed is on screen; a wheel still waits.

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
const busy = (ms: number) => {
  const end = performance.now() + ms;
  while (performance.now() < end);
};

describe('Paginator discrete turns', () => {
  let paginator: Renderer;
  type Next = (distance?: number, opts?: { discrete?: boolean }) => Promise<void>;
  const next: Next = (...args) => (paginator.next as Next)(...args);
  const page = () => Math.round(paginator.containerPosition / paginator.size);

  beforeAll(async () => {
    await import('foliate-js/paginator.js');
  }, 30000);

  afterEach(() => {
    paginator?.destroy();
    paginator?.remove();
  });

  // One section of eight pages, two columns each.
  const open = async () => {
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
      sections: [makeColumns('ch1', 16)],
    } as unknown as Parameters<Renderer['open']>[0]);
    await paginator.goTo({ index: 0, anchor: 0 });
    await wait(300);
    expect(paginator.columnCount).toBe(2);
    expect(page()).toBe(0);
  };

  // The first turn's relocate handler runs for 150 ms, then a second turn
  // comes while the first still holds the paginator.
  const turnDuringRelocate = async (opts?: { discrete?: boolean }) => {
    let second: Promise<void> | undefined;
    const relocated: number[] = [];
    paginator.addEventListener('relocate', () => {
      relocated.push(page());
      if (relocated.length > 1) return;
      busy(150);
      setTimeout(() => (second = next(undefined, opts)));
    });
    await next(undefined, opts);
    await second;
    await wait(300);
    return relocated;
  };

  it('turns again on a tap once the turned page is on screen', async () => {
    await open();
    const relocated = await turnDuringRelocate({ discrete: true });
    expect(page()).toBe(2);
    expect(relocated).toEqual([1, 2]);
  });

  it('still drops a wheel turn while the last turn holds the paginator', async () => {
    await open();
    const relocated = await turnDuringRelocate();
    expect(page()).toBe(1);
    expect(relocated).toEqual([1]);
  });

  it('drops the relocate of a turn a tap overtakes before it is sent', async () => {
    await open();
    const relocated: number[] = [];
    paginator.addEventListener('relocate', () => relocated.push(page()));
    const first = next(undefined, { discrete: true });
    // A frame that takes 150 ms: the second turn comes after the first
    // turn's page is painted and before its relocate is sent.
    let second: Promise<void> | undefined;
    requestAnimationFrame(() => {
      busy(150);
      second = next(undefined, { discrete: true });
    });
    await first;
    await second;
    await wait(300);
    expect(page()).toBe(2);
    expect(relocated).toEqual([2]);
  });
});
