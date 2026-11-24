import { afterEach, describe, expect, it } from 'vitest';

// Registers the <foliate-fxl> custom element (the fixed-layout / PDF renderer).
import 'foliate-js/fixed-layout.js';

// Switching to scrolled mode while a paginated page turn is still loading its
// page (Shift+J as a PDF opens) left the view blank about one time in four: the
// turn finished after the scrolled strip was built and hid every other child of
// the renderer, the strip included. The strip must stay the view.

const PAGE_HTML = `<!doctype html><html><head><style>
  html, body { margin: 0; height: 1000px; }
</style></head><body></body></html>`;

const page = { src: 'srcdoc', data: PAGE_HTML };

type Renderer = HTMLElement & {
  open(book: unknown): void;
  goToSpread(index: number, side: string, reason?: string): Promise<void>;
};

let renderer: Renderer | null = null;

afterEach(() => {
  renderer?.remove();
  renderer = null;
});

const mount = (load: () => Promise<typeof page>) => {
  renderer = document.createElement('foliate-fxl') as Renderer;
  renderer.style.width = '600px';
  renderer.style.height = '400px';
  renderer.setAttribute('flow', 'paginated');
  document.body.append(renderer);
  renderer.open({
    dir: 'ltr',
    rendition: { viewport: { width: 600, height: 1000 }, spread: 'none' },
    sections: Array.from({ length: 6 }, () => ({ load, linear: 'yes' })),
  });
  return renderer;
};

const expectStripShown = (r: Renderer) => {
  const strip = r.shadowRoot!.querySelector<HTMLElement>('.scroll-container')!;
  expect(getComputedStyle(strip).visibility).toBe('visible');
  // Six 1000px pages at 600px wide: the strip scrolls well past the view.
  expect(r.scrollHeight).toBeGreaterThan(r.clientHeight * 2);
};

describe('fixed-layout scroll mode entered during a page turn', () => {
  it('keeps the strip when the switch comes while the page loads', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const r = mount(async () => {
      await gate;
      return page;
    });

    const turn = r.goToSpread(0, 'center', 'page');
    r.setAttribute('flow', 'scrolled');
    release();
    await turn;

    expectStripShown(r);
  });

  it('keeps the strip when the switch comes while the page frame loads', async () => {
    const r = mount(async () => page);
    // The turn appends the page's frame, then awaits its iframe load. An
    // observer callback is a microtask, so it runs before that load event.
    const observer = new MutationObserver(() => {
      observer.disconnect();
      r.setAttribute('flow', 'scrolled');
    });
    observer.observe(r.shadowRoot!, { childList: true });

    await r.goToSpread(0, 'center', 'page');

    expect(r.getAttribute('flow')).toBe('scrolled');
    expectStripShown(r);
  });
});
