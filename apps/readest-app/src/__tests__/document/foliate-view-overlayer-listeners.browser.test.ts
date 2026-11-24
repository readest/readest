import { afterEach, describe, expect, it, vi } from 'vitest';
import 'foliate-js/view.js';
import { Overlayer } from 'foliate-js/overlayer.js';

// A fixed-layout page refreshes its overlayer (after a text-layer rebuild, or
// when a retained turn brings a cached page in). The listeners of the overlayer
// it replaces must stop answering clicks, or a deleted highlight still opens.

type View = HTMLElement & {
  open(book: unknown): Promise<void>;
  renderer: HTMLElement;
};
type Layer = { add(key: string, range: Range, draw: unknown): void };

let view: View | null = null;
let frame: HTMLIFrameElement | null = null;
afterEach(() => {
  view?.remove();
  frame?.remove();
  view = frame = null;
});

const createOverlayer = (doc: Document) => {
  let layer!: Layer;
  view!.renderer.dispatchEvent(
    new CustomEvent('create-overlayer', {
      detail: { doc, index: 0, attach: (o: Layer) => (layer = o) },
    }),
  );
  return layer;
};

describe('View overlayer listeners', () => {
  it('stops a replaced overlayer from showing annotations', async () => {
    view = document.createElement('foliate-view') as View;
    document.body.append(view);
    await view.open({
      dir: 'ltr',
      rendition: { layout: 'pre-paginated', viewport: { width: 600, height: 900 } },
      sections: [{ linear: 'yes', load: async () => ({ src: 'srcdoc', data: '<p>x</p>' }) }],
    });
    frame = document.createElement('iframe');
    frame.srcdoc = '<!doctype html><p id="p" style="margin:0">Highlighted text</p>';
    document.body.append(frame);
    await new Promise((resolve) => frame!.addEventListener('load', resolve, { once: true }));
    const doc = frame.contentDocument!;
    const range = doc.createRange();
    range.selectNodeContents(doc.getElementById('p')!);
    const rect = range.getBoundingClientRect();
    const click = () =>
      doc
        .getElementById('p')!
        .dispatchEvent(
          new MouseEvent('click', { bubbles: true, clientX: rect.left + 2, clientY: rect.top + 2 }),
        );
    const shown = vi.fn();
    view.addEventListener('show-annotation', shown);

    createOverlayer(doc).add('highlight', range, Overlayer.highlight);
    click();
    expect(shown).toHaveBeenCalledTimes(1);

    // The refreshed overlayer no longer holds the highlight (it was deleted).
    createOverlayer(doc);
    shown.mockClear();
    click();
    expect(shown, 'the old overlayer must not answer clicks').not.toHaveBeenCalled();
  });
});
