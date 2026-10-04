import { afterEach, describe, expect, it, vi } from 'vitest';

import 'foliate-js/fixed-layout.js';

// The reader assigns `pageColors` again on every page load. Each assignment
// re-rendered every loaded page and rebuilt its overlayer, so scrolling a PDF
// re-rendered the whole loaded window once per page it brought in. Colors that
// did not change must not re-render anything.

const PAGE_HTML = `<!doctype html><html><head><style>
  html, body { margin: 0; height: 1000px; }
</style></head><body></body></html>`;

type Renderer = HTMLElement & {
  open(book: unknown): void;
  destroy(): void;
  pageColors: unknown;
};

const waitFor = async (condition: () => boolean, timeout = 4000): Promise<void> => {
  const start = performance.now();
  while (!condition()) {
    if (performance.now() - start > timeout) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
};

let renderer: Renderer | null = null;

afterEach(() => {
  renderer?.destroy();
  renderer?.remove();
  renderer = null;
});

describe('fixed-layout page colors', () => {
  it('re-renders the loaded pages only when the colors change', async () => {
    const onZoom = vi.fn();
    const loaded = new Set<number>();
    renderer = document.createElement('foliate-fxl') as Renderer;
    renderer.style.width = '300px';
    renderer.style.height = '600px';
    renderer.setAttribute('flow', 'scrolled');
    renderer.addEventListener('load', (e) => loaded.add((e as CustomEvent).detail.index));
    document.body.append(renderer);
    renderer.open({
      dir: 'ltr',
      rendition: { viewport: { width: 600, height: 1000 }, spread: 'none' },
      sections: Array.from({ length: 3 }, () => ({
        load: async () => ({ src: 'srcdoc', data: PAGE_HTML, onZoom }),
        linear: 'yes',
      })),
    });
    await waitFor(() => loaded.size === 3);
    await new Promise((resolve) => setTimeout(resolve, 100));

    renderer.pageColors = { background: '#000', foreground: '#fff', keepImages: true };
    await waitFor(() => onZoom.mock.calls.length > 0);
    onZoom.mockClear();

    renderer.pageColors = { background: '#000', foreground: '#fff', keepImages: true };
    expect(onZoom).not.toHaveBeenCalled();

    renderer.pageColors = { background: '#fff', foreground: '#000', keepImages: true };
    expect(onZoom).toHaveBeenCalled();
  });
});
