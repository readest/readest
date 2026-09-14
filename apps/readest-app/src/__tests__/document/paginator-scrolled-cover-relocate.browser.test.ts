import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { Renderer } from '@/types/view';

// In scrolled mode the paginator picks the visible range from the view that
// covers the viewport centre and skips views whose visible range is collapsed.
// A cover section made of one oversized <svg><image/> (or any section whose
// in-view elements are all partially clipped) has no accepted nodes, so its
// range collapses onto <body>. When no other loaded view overlaps the viewport
// the walk returns nothing, #afterScroll bails, and no `relocate` is ever
// dispatched — the host never learns the book's position, so reading progress
// is never recorded or synced until the user scrolls into text. Paginated mode
// relocates on the same collapsed range, so the two modes must agree.

const COVER_HTML = `<!doctype html><html><head><style>
  html, body { margin: 0; }
</style></head><body><div><svg xmlns="http://www.w3.org/2000/svg" width="400" height="2000" viewBox="0 0 400 2000">
  <rect width="400" height="2000" fill="#48c" />
</svg></div></body></html>`;

const TEXT_HTML = `<!doctype html><html><head><style>
  html, body { margin: 0; }
  p { margin: 0 0 24px; line-height: 24px; }
</style></head><body>${Array.from({ length: 60 }, (_, i) => `<p>Paragraph ${i + 1} of the first chapter.</p>`).join('')}</body></html>`;

const blobUrl = (html: string) => URL.createObjectURL(new Blob([html], { type: 'text/html' }));

const makeBook = () => ({
  dir: 'ltr',
  sections: [
    { id: 'cover', linear: 'yes', size: COVER_HTML.length, load: async () => blobUrl(COVER_HTML) },
    { id: 'ch1', linear: 'yes', size: TEXT_HTML.length, load: async () => blobUrl(TEXT_HTML) },
  ],
});

type RelocateDetail = { reason: string; index: number; range: Range; fraction: number };

const waitForRelocate = (el: HTMLElement, timeout = 3000) =>
  new Promise<RelocateDetail | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), timeout);
    el.addEventListener(
      'relocate',
      (e) => {
        clearTimeout(timer);
        resolve((e as CustomEvent<RelocateDetail>).detail);
      },
      { once: true },
    );
  });

describe('Paginator scrolled mode relocates on an image-only cover', () => {
  let paginator: Renderer;

  beforeAll(async () => {
    await import('foliate-js/paginator.js');
  }, 30000);

  const createPaginator = () => {
    const el = document.createElement('foliate-paginator') as Renderer;
    Object.assign(el.style, {
      width: '800px',
      height: '600px',
      position: 'absolute',
      left: '0',
      top: '0',
    });
    el.setAttribute('flow', 'scrolled');
    document.body.appendChild(el);
    return el;
  };

  afterEach(() => {
    if (paginator) {
      try {
        paginator.destroy();
      } catch {
        /* iframe body may already be torn down */
      }
      paginator.remove();
    }
  });

  it('dispatches a relocate for the cover section on open', async () => {
    paginator = createPaginator();
    paginator.open(makeBook() as unknown as Parameters<Renderer['open']>[0]);

    const relocated = waitForRelocate(paginator);
    await paginator.goTo({ index: 0, anchor: 0 });
    const detail = await relocated;

    expect(detail).not.toBeNull();
    expect(detail!.index).toBe(0);
    expect(detail!.fraction).toBe(0);
  });

  it('still prefers a view with visible text over a collapsed cover range', async () => {
    paginator = createPaginator();
    paginator.open(makeBook() as unknown as Parameters<Renderer['open']>[0]);

    await paginator.goTo({ index: 0, anchor: 0 });
    // Let the fill pass load the text chapter below the cover.
    const start = Date.now();
    while (paginator.getContents().length < 2 && Date.now() - start < 5000) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(paginator.getContents().length).toBe(2);

    // Scroll so the cover's tail sits in the top of the viewport and the text
    // chapter covers the centre: the relocate must report the chapter. The
    // paginator swallows the first debounced scroll after a navigation (it is
    // normally the anchoring scroll itself) and skips scrolls while the fill
    // pass is still stabilizing, so nudge until a relocate arrives.
    const container = paginator.shadowRoot!.getElementById('container')!;
    let detail: RelocateDetail | null = null;
    for (let nudge = 0; nudge < 6 && !detail; nudge++) {
      const relocated = waitForRelocate(paginator, 500);
      container.scrollTop = 1900 + nudge;
      detail = await relocated;
    }

    expect(detail).not.toBeNull();
    expect(detail!.index).toBe(1);
    expect(detail!.range.collapsed).toBe(false);
  });
});
