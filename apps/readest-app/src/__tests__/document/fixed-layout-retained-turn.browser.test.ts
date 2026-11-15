import { afterEach, describe, expect, it, vi } from 'vitest';
import 'foliate-js/fixed-layout.js';
import { RetainedPageTurn } from '@/app/reader/utils/retainedPageTurn';
import type { Renderer } from '@/types/view';

type Fxl = HTMLElement & {
  open(book: unknown): void;
  goToSpread(index: number, side: string, reason?: string): Promise<void>;
  next(): Promise<void>;
  prev(): Promise<void>;
  index: number;
  getContents(): { doc: Document; index: number }[];
  pageColors: { background?: string; foreground?: string };
  preparePageTurn?: (forward: boolean) => Promise<boolean>;
  beginPageTurn?: (forward: boolean) => Promise<boolean>;
  movePageTurn: (progress: number) => void;
  endPageTurn: (commit: boolean, duration?: number) => Promise<boolean>;
  cancelPageTurn: () => void;
};
let renderer: Fxl;
const drawn = new WeakMap<Document, number>();
const rasterized = vi.fn();
// Hold a section's load or its draw until the test releases it.
const loadGate = new Map<number, Promise<void>>();
const drawGate = new Map<number, Promise<void>>();
const hold = (gates: Map<number, Promise<void>>, index: number) => {
  let release!: () => void;
  gates.set(index, new Promise<void>((resolve) => (release = resolve)));
  return release;
};
const cachedSections = () =>
  [...renderer.shadowRoot!.querySelectorAll('iframe')].map((f) =>
    Number(f.dataset['sectionIndex']),
  );
const docAt = (index: number) =>
  [...renderer.shadowRoot!.querySelectorAll('iframe')].find(
    (f) => f.dataset['sectionIndex'] === String(index),
  )!.contentDocument!;
const mount = async (dir = 'ltr', spread = 'none', scaleFactor = '100') => {
  renderer = document.createElement('foliate-fxl') as Fxl;
  Object.assign(renderer.style, { width: '400px', height: '800px' });
  renderer.setAttribute('zoom', 'fit-page');
  renderer.setAttribute('scale-factor', scaleFactor);
  document.body.append(renderer);
  renderer.open({
    dir,
    rendition: { viewport: { width: 600, height: 900 }, spread },
    sections: Array.from({ length: 7 }, (_, index) => ({
      linear: 'yes',
      load: async () => ({
        src: await Promise.resolve(loadGate.get(index)).then(() => 'srcdoc'),
        data: '<!doctype html><html><body style="margin:0"><canvas></canvas><span>Selectable page</span></body></html>',
        onZoom: async ({ doc, scale }: { doc: Document; scale: number }) => {
          await drawGate.get(index);
          if (!doc || drawn.get(doc) === scale) return;
          drawn.set(doc, scale);
          rasterized(index, scale);
          const canvas = doc.querySelector('canvas')!;
          canvas.width = 600 * scale;
          canvas.height = 900 * scale;
          canvas.style.width = `${600 * scale}px`;
          canvas.style.height = `${900 * scale}px`;
          canvas.getContext('2d')!.fillStyle = index % 2 ? 'blue' : 'green';
          canvas.getContext('2d')!.fillRect(0, 0, canvas.width, canvas.height);
        },
      }),
    })),
  });
  await renderer.goToSpread(2, spread === 'none' ? 'center' : 'left', 'page');
  return renderer;
};
afterEach(() => {
  renderer?.cancelPageTurn?.();
  renderer?.remove();
  rasterized.mockClear();
  loadGate.clear();
  drawGate.clear();
});

describe('retained fixed-layout page turns', () => {
  it.each([
    'ltr',
    'rtl',
  ])('slides the original page views and commits without replacing their canvases (%s)', async (dir) => {
    await mount(dir);
    const original = docAt(2);
    const canvas = original.querySelector('canvas');
    const text = original.querySelector('span');
    expect(await renderer.beginPageTurn?.(true)).toBe(true);
    const incoming = docAt(3);
    const nextCanvas = incoming.querySelector('canvas');
    const before = rasterized.mock.calls.filter(([index]) => index === 2 || index === 3).length;
    expect(renderer.index).toBe(2);
    renderer.movePageTurn(0.5);
    expect(original.defaultView!.frameElement!.isConnected).toBe(true);
    expect(original.querySelector('canvas')).toBe(canvas);
    expect(original.querySelector('span')).toBe(text);
    expect(renderer.shadowRoot!.querySelector('canvas')).toBeNull();
    expect(await renderer.endPageTurn(true, 0)).toBe(true);
    expect(renderer.index).toBe(3);
    expect(renderer.getContents().map(({ index }) => index)).toEqual([3]);
    expect(docAt(3)).toBe(incoming);
    expect(incoming.querySelector('canvas')).toBe(nextCanvas);
    expect(rasterized.mock.calls.filter(([index]) => index === 2 || index === 3).length).toBe(
      before,
    );
  });

  it.each(['ltr', 'rtl'])('retains the exact landing geometry of a spread (%s)', async (dir) => {
    await mount(dir, 'auto');
    Object.assign(renderer.style, { width: '1200px', height: '600px' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(await renderer.beginPageTurn?.(true)).toBe(true);
    renderer.movePageTurn(1);
    const incoming = [
      ...renderer.shadowRoot!.querySelectorAll<HTMLElement>('[data-page-turn-view="incoming"]'),
    ];
    const before = incoming.map((e) => e.getBoundingClientRect().toJSON());
    await renderer.endPageTurn(true, 0);
    incoming.forEach((e, i) => {
      const after = e.getBoundingClientRect();
      expect(
        after.left,
        JSON.stringify({
          before,
          after: after.toJSON(),
          styles: incoming.map((e) => e.style.cssText),
          host: renderer.style.cssText,
        }),
      ).toBeCloseTo(before[i]!.x, 1);
      expect(after.top).toBeCloseTo(before[i]!.y, 1);
      expect(after.width).toBeCloseTo(before[i]!.width, 1);
      expect(after.height).toBeCloseTo(before[i]!.height, 1);
    });
  });

  it.each(
    ['ltr', 'rtl'].flatMap((dir) =>
      [100, 200].flatMap((zoom) => [false, true].map((commit) => ({ dir, zoom, commit }))),
    ),
  )('keeps the other portrait page hidden until its turn ($dir, $zoom%, commit=$commit)', async ({
    dir,
    zoom,
    commit,
  }) => {
    await mount(dir, 'auto');
    renderer.setAttribute('scale-factor', String(zoom));
    await new Promise((resolve) => setTimeout(resolve, 30));
    const frames = [...renderer.shadowRoot!.querySelectorAll('iframe')];
    const inCurrentSpread = frames.filter(
      (frame) => getComputedStyle(frame.parentElement!).visibility === 'visible',
    );
    const current = inCurrentSpread.find(
      (frame) => getComputedStyle(frame.parentElement!).display !== 'none',
    )!;
    const next = inCurrentSpread.find(
      (frame) => getComputedStyle(frame.parentElement!).display === 'none',
    )!.parentElement!;
    const before = current.getBoundingClientRect().toJSON();
    expect(getComputedStyle(next).display).toBe('none');

    expect(await renderer.preparePageTurn?.(dir === 'ltr')).toBe(true);
    expect(
      getComputedStyle(next).display,
      'preparation must keep the other page hidden and out of flow',
    ).toBe('none');
    expect(current.getBoundingClientRect().toJSON()).toEqual(before);

    const preparedStyle = next.style.cssText;
    expect(await renderer.beginPageTurn?.(dir === 'ltr')).toBe(true);
    expect(getComputedStyle(next).visibility).toBe('visible');
    expect([...renderer.shadowRoot!.querySelectorAll('[data-page-turn-view="outgoing"]')]).toEqual([
      current.parentElement,
    ]);
    renderer.movePageTurn(commit ? 1 : 0.4);
    const landing = next.getBoundingClientRect().toJSON();
    await renderer.endPageTurn(commit, 0);
    if (commit) {
      expect(getComputedStyle(next).display, 'the landed page must remain visible').toBe('block');
      expect(getComputedStyle(next).visibility).toBe('visible');
      expect(next.getBoundingClientRect().toJSON()).toEqual(landing);
      expect(renderer.index).toBe(Number(next.querySelector('iframe')!.dataset['sectionIndex']));
      await (dir === 'ltr' ? renderer.prev() : renderer.next());
      expect(getComputedStyle(current.parentElement!).visibility).toBe('visible');
      expect(getComputedStyle(current.parentElement!).position).toBe('relative');
      await (dir === 'ltr' ? renderer.next() : renderer.prev());
      Object.assign(renderer.style, { width: '1200px', height: '600px' });
      await vi.waitFor(() => {
        for (const page of [current.parentElement!, next]) {
          expect(getComputedStyle(page).display).toBe('block');
          expect(getComputedStyle(page).visibility, 'rotation must show both pages').toBe(
            'visible',
          );
          expect(getComputedStyle(page).position).toBe('relative');
        }
      });
    } else {
      expect(next.style.cssText, 'cancellation must restore the prepared sibling exactly').toBe(
        preparedStyle,
      );
      expect(getComputedStyle(next).display).toBe('none');
      expect(current.getBoundingClientRect().toJSON()).toEqual(before);
      await (dir === 'ltr' ? renderer.next() : renderer.prev());
      expect(renderer.index).toBe(Number(next.querySelector('iframe')!.dataset['sectionIndex']));
      expect(getComputedStyle(next).display).toBe('block');
      expect(getComputedStyle(next).visibility).toBe('visible');
      expect(getComputedStyle(next).position).toBe('relative');
    }
  });

  it.each([
    { zoom: 50, mode: 'fit-page', expected: 50 },
    { zoom: 80, mode: 'fit-page', expected: 80 },
    { zoom: 50, mode: 'fit-width', expected: 100 },
  ])('lands at $expected% after a $zoom% $mode push', async ({ zoom, mode, expected }) => {
    await mount();
    renderer.setAttribute('zoom', mode);
    renderer.setAttribute('scale-factor', String(zoom));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(await renderer.beginPageTurn?.(true)).toBe(true);
    const next = docAt(3).defaultView!.frameElement!.parentElement!;
    expect(parseFloat(next.style.width)).toBeCloseTo((renderer.clientWidth * expected) / 100, 1);
    renderer.movePageTurn(1);
    const landing = next.getBoundingClientRect().toJSON();
    await renderer.endPageTurn(true, 0);
    expect(renderer.getAttribute('scale-factor')).toBe(String(expected));
    expect(next.getBoundingClientRect().toJSON()).toEqual(landing);
    expect(getComputedStyle(next).display).toBe(expected < 100 ? 'flex' : 'block');
  });

  it.each(
    ['ltr', 'rtl'].flatMap((dir) => [50, 100].map((zoom) => ({ dir, zoom }))),
  )('activates both pages when a portrait turn enters a new spread ($dir, $zoom%)', async ({
    dir,
    zoom,
  }) => {
    await mount(dir, 'auto');
    renderer.setAttribute('scale-factor', String(zoom));
    for (let i = 0; i < 2; i++) {
      expect(await renderer.beginPageTurn?.(dir === 'ltr')).toBe(true);
      await renderer.endPageTurn(true, 0);
    }
    const first = docAt(renderer.index).defaultView!.frameElement!.parentElement!;
    const expected = renderer.index + (dir === 'ltr' ? 1 : -1);
    expect(
      renderer
        .getContents()
        .map(({ index }) => index)
        .sort((a, b) => a - b),
    ).toEqual([renderer.index, expected].sort((a, b) => a - b));
    await (dir === 'ltr' ? renderer.next() : renderer.prev());
    expect(renderer.index).toBe(expected);
    const second = docAt(expected).defaultView!.frameElement!.parentElement!;
    expect(getComputedStyle(second).display).not.toBe('none');
    expect(
      getComputedStyle(second).visibility,
      'normal navigation must reveal the preloaded sibling',
    ).toBe('visible');
    expect(getComputedStyle(second).position).toBe('relative');
    Object.assign(renderer.style, { width: '1200px', height: '600px' });
    await vi.waitFor(() => {
      for (const page of [first, second]) {
        expect(getComputedStyle(page).display).not.toBe('none');
        expect(getComputedStyle(page).visibility).toBe('visible');
        expect(getComputedStyle(page).position).toBe('relative');
      }
    });
  });

  it('cancels safely when the viewport resizes during a drag', async () => {
    await mount();
    expect(await renderer.beginPageTurn?.(true)).toBe(true);
    renderer.movePageTurn(0.5);
    renderer.style.width = '500px';
    await vi.waitFor(() =>
      expect(renderer.shadowRoot!.querySelector('[data-page-turn-view]')).toBeNull(),
    );
    expect(await renderer.endPageTurn(true, 0)).toBe(false);
    expect(renderer.index).toBe(2);
    expect(renderer.style.width).toBe('500px');
    expect(renderer.shadowRoot!.querySelector('[data-page-turn-view]')).toBeNull();
  });

  it('runs the app controller against the real views without snapshot or navigation calls', async () => {
    await mount();
    const capture = vi.fn(async () => {
      throw new Error('A retained turn must not take a snapshot');
    });
    const navigate = vi.fn(async () => {});
    const committed = vi.fn();
    const call = vi.fn(async () => ({}));
    const controller = new RetainedPageTurn(
      {
        getHostElement: () => renderer,
        getContentRect: () => renderer.getBoundingClientRect(),
        capture,
        navigate,
      },
      { renderer: renderer as unknown as Renderer, enabled: () => true, call },
      committed,
    );
    try {
      await controller.prepareCapture('push');
      const original = docAt(2),
        destination = docAt(3);
      const canvas = destination.querySelector('canvas');
      expect(await controller.beginDrag(true, false, 'push')).toBe(true);
      controller.moveDrag(0.6, 0.5);
      expect(renderer.index).toBe(2);
      expect(original.defaultView!.frameElement!.isConnected).toBe(true);
      await controller.endDrag(true);
      expect(renderer.index).toBe(3);
      expect(docAt(3)).toBe(destination);
      expect(destination.querySelector('canvas')).toBe(canvas);
      expect(committed).toHaveBeenCalledOnce();
      expect(capture).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
      expect(call.mock.calls).toEqual([]);
    } finally {
      controller.dispose();
    }
  });

  it('cancels a zoomed swipe without rebuilding its page or changing its pan', async () => {
    await mount();
    renderer.setAttribute('scale-factor', '200');
    await new Promise((resolve) => setTimeout(resolve, 20));
    renderer.scrollLeft = 100000;
    renderer.scrollTop = 100;
    const before = [renderer.scrollLeft, renderer.scrollTop];
    const doc = docAt(2);
    const startRect = doc.defaultView!.frameElement!.getBoundingClientRect();
    const canvas = doc.querySelector('canvas');
    const text = doc.querySelector('span');
    expect(await renderer.beginPageTurn?.(true)).toBe(true);
    const preparedRect = doc.defaultView!.frameElement!.getBoundingClientRect();
    expect(preparedRect.left).toBeCloseTo(startRect.left, 1);
    expect(preparedRect.top).toBeCloseTo(startRect.top, 1);
    renderer.movePageTurn(0.6);
    await renderer.endPageTurn(false, 0);
    expect(renderer.index).toBe(2);
    expect(renderer.getAttribute('scale-factor')).toBe('200');
    expect([renderer.scrollLeft, renderer.scrollTop]).toEqual(before);
    expect(doc.querySelector('canvas')).toBe(canvas);
    expect(doc.querySelector('span')).toBe(text);
  });

  it.each(
    [
      { forward: true, background: undefined, color: 'rgb(255, 255, 255)' },
      { forward: false, background: undefined, color: 'rgb(255, 255, 255)' },
      { forward: true, background: '#123456', color: 'rgb(18, 52, 86)' },
      { forward: false, background: '#123456', color: 'rgb(18, 52, 86)' },
    ].flatMap((testCase) => ['ltr', 'rtl'].map((dir) => ({ ...testCase, dir }))),
  )('keeps PDF paper opaque across a fractional swipe ($dir, $forward, $background)', async ({
    dir,
    forward,
    background,
    color,
  }) => {
    await mount(dir);
    if (background) renderer.pageColors = { background, foreground: '#ffffff' };
    renderer.setAttribute('scale-factor', '146');
    await new Promise((resolve) => setTimeout(resolve, 30));
    renderer.scrollLeft = (renderer.scrollWidth - renderer.clientWidth) * 0.6;
    renderer.scrollTop = 35;
    const iframe = docAt(2).defaultView!.frameElement as HTMLElement;
    const page = iframe.parentElement!;
    const before = iframe.getBoundingClientRect();
    const host = renderer.getBoundingClientRect();
    const style = page.style.cssText;
    const pan = [renderer.scrollLeft, renderer.scrollTop];
    expect(
      getComputedStyle(page).backgroundColor,
      'PDF paper must stay opaque before the gesture',
    ).toBe(color);
    expect(await renderer.beginPageTurn?.(forward)).toBe(true);
    const incoming = renderer.shadowRoot!.querySelector<HTMLElement>(
      '[data-page-turn-view="incoming"]',
    )!;
    expect(getComputedStyle(page).backgroundColor).toBe(color);
    expect(getComputedStyle(incoming).backgroundColor).toBe(color);
    renderer.movePageTurn(0.4);
    const shift = new DOMMatrixReadOnly(page.style.transform).m41;
    const next = incoming.getBoundingClientRect();
    const overlap =
      forward !== (dir === 'rtl')
        ? host.right + shift - next.left
        : next.right - (host.left + shift);
    expect(overlap, 'opaque page surfaces must overlap across the compositor seam').toBeCloseTo(
      2 / devicePixelRatio,
      1,
    );
    renderer.movePageTurn(0);
    expect(iframe.getBoundingClientRect().left).toBeCloseTo(before.left, 1);
    expect(iframe.isConnected).toBe(true);
    await renderer.endPageTurn(false, 0);
    expect(page.style.cssText).toBe(style);
    expect([renderer.scrollLeft, renderer.scrollTop]).toEqual(pan);
  });

  it('renders its neighbour before the gesture and retains that document at release', async () => {
    await mount();
    expect(await renderer.preparePageTurn?.(true)).toBe(true);
    const incoming = docAt(3);
    const canvas = incoming.querySelector('canvas');
    const before = rasterized.mock.calls.filter(([index]) => index === 2 || index === 3).length;
    expect(await renderer.beginPageTurn?.(true)).toBe(true);
    renderer.movePageTurn(0.8);
    await renderer.endPageTurn(true, 0);
    expect(docAt(3)).toBe(incoming);
    expect(incoming.querySelector('canvas')).toBe(canvas);
    expect(
      getComputedStyle(incoming.defaultView!.frameElement!.parentElement!).backgroundColor,
    ).toBe('rgb(255, 255, 255)');
    expect(rasterized.mock.calls.filter(([index]) => index === 2 || index === 3).length).toBe(
      before,
    );
  });

  it.each([
    '50',
    '100',
    '150',
  ])('preloads the next page at the zoom a tap turn shows it (zoom %s)', async (zoom) => {
    await mount('ltr', 'none', zoom);
    await vi.waitFor(() => expect(rasterized).toHaveBeenCalledWith(3, expect.any(Number)));
    rasterized.mockClear();
    await renderer.next();
    expect(renderer.index).toBe(3);
    expect(
      rasterized.mock.calls.filter(([index]) => index === 3),
      'the preloaded page must not be drawn again when it is shown',
    ).toEqual([]);
  });

  it('keeps the page it turned away from cached for a turn back', async () => {
    await mount();
    await vi.waitFor(() => expect(cachedSections().sort()).toEqual([1, 2, 3]));
    expect(await renderer.beginPageTurn?.(true)).toBe(true);
    await renderer.endPageTurn(true, 0);
    await vi.waitFor(() => expect(cachedSections()).toContain(4));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(cachedSections(), 'the trim must drop an older preload, not page 2').toContain(2);
  });

  it('keeps the destination of a turn back while a preload trims the cache', async () => {
    await mount();
    await vi.waitFor(() => expect(cachedSections().sort()).toEqual([1, 2, 3]));
    const releaseLoad = hold(loadGate, 4);
    expect(await renderer.beginPageTurn?.(true)).toBe(true);
    await renderer.endPageTurn(true, 0);
    const releaseDraw = hold(drawGate, 2);
    const begun = renderer.beginPageTurn!(false);
    releaseLoad();
    await vi.waitFor(() => expect(cachedSections()).toContain(4));
    await new Promise((resolve) => setTimeout(resolve, 50));
    releaseDraw();
    expect(await begun).toBe(true);
    await renderer.endPageTurn(true, 0);
    expect(renderer.index).toBe(2);
    const landed = [...renderer.shadowRoot!.querySelectorAll('iframe')].find(
      (f) => f.dataset['sectionIndex'] === '2',
    );
    expect(landed?.isConnected, 'the turn must land on an attached page').toBe(true);
  });

  it('creates the overlayer of the hidden page a portrait turn brings in', async () => {
    await mount('ltr', 'auto');
    const created: number[] = [];
    renderer.addEventListener('create-overlayer', (e) =>
      created.push((e as CustomEvent<{ index: number }>).detail.index),
    );
    for (let i = 0; i < 2; i++) {
      expect(await renderer.beginPageTurn?.(true)).toBe(true);
      await renderer.endPageTurn(true, 0);
    }
    expect(renderer.index).toBe(5);
    await renderer.next();
    expect(renderer.index).toBe(6);
    expect(created, 'page 6 needs an overlayer for its annotations').toContain(6);
  });

  it.each([
    true,
    false,
  ])('keeps the paper overlap until settling finishes (commit=%s)', async (commit) => {
    await mount();
    await renderer.beginPageTurn?.(true);
    renderer.movePageTurn(0.4);
    const outgoing = renderer.shadowRoot!.querySelector<HTMLElement>(
      '[data-page-turn-view="outgoing"]',
    )!;
    const incoming = renderer.shadowRoot!.querySelector<HTMLElement>(
      '[data-page-turn-view="incoming"]',
    )!;
    const host = renderer.getBoundingClientRect();
    const ending = renderer.endPageTurn(commit, 1000);
    const animations = [...outgoing.getAnimations(), ...incoming.getAnimations()];
    try {
      for (const animation of animations) {
        animation.pause();
        animation.currentTime = 500;
      }
      await new Promise(requestAnimationFrame);
      const shift = new DOMMatrixReadOnly(getComputedStyle(outgoing).transform).m41;
      const overlap = host.right + shift - incoming.getBoundingClientRect().left;
      expect(
        overlap,
        'the paper must keep covering the seam during the release animation',
      ).toBeCloseTo(2 / devicePixelRatio, 1);
    } finally {
      for (const animation of animations) animation.finish();
      await ending;
    }
  });
});
