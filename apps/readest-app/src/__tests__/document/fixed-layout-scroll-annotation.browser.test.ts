import { afterEach, describe, expect, it } from 'vitest';

import 'foliate-js/fixed-layout.js';

// Regression test for readest#5586. PDF pages rebuild their text-layer DOM in
// the async onZoom callback. Any annotation overlayer created before that
// callback settles holds Range objects into the old DOM and must be recreated
// so the reader can re-anchor its saved highlights against the new text layer.

const PAGE_HTML = `<!doctype html><html><head><style>
  html, body { margin: 0; width: 600px; height: 1000px; }
</style></head><body><div class="textLayer">highlighted text</div></body></html>`;

const waitFor = async (condition: () => boolean, timeout = 4000): Promise<void> => {
  const start = performance.now();
  while (!condition()) {
    if (performance.now() - start > timeout) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
};

type Renderer = HTMLElement & {
  open(book: unknown): void;
  destroy(): void;
};

let renderer: Renderer | null = null;

afterEach(() => {
  renderer?.destroy();
  renderer?.remove();
  renderer = null;
});

describe('fixed-layout scroll-mode PDF annotations (readest#5586)', () => {
  it('recreates the overlayer after an async PDF text-layer render', async () => {
    let finishRender!: () => void;
    const renderFinished = new Promise<void>((resolve) => {
      finishRender = resolve;
    });
    let renderStarted = false;
    const book = {
      dir: 'ltr',
      rendition: { viewport: { width: 600, height: 1000 }, spread: 'none' },
      sections: [
        {
          load: async () => ({
            src: 'srcdoc',
            data: PAGE_HTML,
            onZoom: () => {
              renderStarted = true;
              return renderFinished;
            },
          }),
          linear: 'yes',
        },
      ],
    };

    renderer = document.createElement('foliate-fxl') as Renderer;
    renderer.style.width = '600px';
    renderer.style.height = '400px';
    renderer.setAttribute('flow', 'scrolled');

    const overlayers: SVGSVGElement[] = [];
    renderer.addEventListener('create-overlayer', (event) => {
      const element = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      overlayers.push(element);
      (event as CustomEvent).detail.attach({ element, redraw: () => {} });
    });

    document.body.append(renderer);
    renderer.open(book);

    await waitFor(() => renderStarted && overlayers.length === 1);
    const staleOverlayer = overlayers[0]!;
    expect(staleOverlayer.isConnected).toBe(true);

    finishRender();

    await waitFor(() => overlayers.length > 1);
    expect(staleOverlayer.isConnected).toBe(false);
    expect(overlayers.at(-1)!.isConnected).toBe(true);
  });
});
