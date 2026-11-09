import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { Renderer } from '@/types/view';

// A paginated page turn repaints the per-view background segments more than
// once: as it scrolls, from the container's scroll event, and as it
// relocates. Each pass replaced the segments with new elements even when they
// were the same, so each one changed the page (a repaint, on e-ink a refresh)
// for nothing.

const html = `<!doctype html><html><head><style>
  html, body { margin: 0; } p { margin: 0 0 24px; line-height: 24px; }
</style></head><body>${Array.from({ length: 200 }, (_, i) => `<p>Paragraph ${i + 1} of the chapter.</p>`).join('')}</body></html>`;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Paginator page backgrounds', () => {
  let paginator: Renderer;

  beforeAll(async () => {
    await import('foliate-js/paginator.js');
  }, 30000);

  afterEach(() => {
    paginator?.destroy();
    paginator?.remove();
  });

  it('keeps the background segments when they have not changed', async () => {
    paginator = document.createElement('foliate-paginator') as Renderer;
    Object.assign(paginator.style, {
      width: '800px',
      height: '600px',
      position: 'absolute',
      left: '0',
      top: '0',
    });
    document.body.appendChild(paginator);
    const src = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    paginator.open({
      dir: 'ltr',
      sections: [{ id: 'ch1', linear: 'yes', size: html.length, load: async () => src }],
    } as unknown as Parameters<Renderer['open']>[0]);
    await paginator.goTo({ index: 0, anchor: 0 });
    await paginator.next();
    await wait(600);
    const background = paginator.shadowRoot!.getElementById('background')!;
    const segments = [...background.children];
    expect(segments.length).toBeGreaterThan(0);

    // the scroll listener paints the backgrounds again at the same position
    paginator.shadowRoot!.getElementById('container')!.dispatchEvent(new Event('scroll'));
    expect([...background.children].every((s, i) => s === segments[i])).toBe(true);
  });
});
