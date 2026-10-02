import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import 'foliate-js/fixed-layout.js';

// Regression test for readest#6484. In Webtoon Mode (scrolled, zero gap) the
// pages of a zoomed comic must butt together. At a zoom whose page size is not
// a whole number of device pixels, each page's edge was anti-aliased against
// the scroll background, which showed through as a line between the images.

const PAGE_HTML = `<!doctype html><html><head><style>
  html, body { margin: 0; width: 600px; height: 1000px; background: rgb(255, 0, 0); }
</style></head><body></body></html>`;

const waitFor = async (condition: () => boolean, timeout = 4000): Promise<void> => {
  const start = performance.now();
  while (!condition()) {
    if (performance.now() - start > timeout) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
};

const nextFrames = async (count = 3) => {
  for (let i = 0; i < count; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
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

const decodeScreenshot = async (base64: string) => {
  const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
};

// Device pixels along a line across the page boundary that are not page red.
const findSeam = async (horizontal: boolean) => {
  const base64 = await page.screenshot({ element: renderer!, save: false });
  const image = await decodeScreenshot(base64);
  const length = horizontal ? image.width : image.height;
  const across = Math.floor((horizontal ? image.height : image.width) / 4);
  const seam: number[] = [];
  for (let i = 0; i < length; i++) {
    const [x, y] = horizontal ? [i, across] : [across, i];
    if (image.data[(y * image.width + x) * 4]! < 250) seam.push(i);
  }
  return seam;
};

const openStrip = async (scaleFactor: string, horizontal: boolean) => {
  const loaded = new Set<number>();
  const book = {
    dir: 'ltr',
    rendition: { viewport: { width: 600, height: 1000 }, spread: 'none' },
    sections: Array.from({ length: 4 }, () => ({
      load: async () => ({ src: 'srcdoc', data: PAGE_HTML }),
      linear: 'yes',
    })),
  };
  renderer = document.createElement('foliate-fxl') as Renderer;
  renderer.style.width = '587px';
  renderer.style.height = '487px';
  renderer.style.setProperty('--scroll-bg-color', 'rgb(0, 0, 0)');
  renderer.setAttribute('flow', 'scrolled');
  renderer.setAttribute('scroll-gap', '0');
  if (horizontal) renderer.setAttribute('scroll-direction', 'horizontal');
  renderer.addEventListener('load', (e) => loaded.add((e as CustomEvent).detail.index));
  document.body.append(renderer);
  renderer.open(book);
  renderer.setAttribute('scale-factor', scaleFactor);
  await waitFor(() => loaded.has(0));
  await nextFrames();
  return loaded;
};

describe('fixed-layout Webtoon Mode seams (readest#6484)', () => {
  it.each([
    '100',
    '137',
    '163',
    '211',
  ])('leaves no line between vertically scrolled pages at scale-factor %s', async (scaleFactor) => {
    const loaded = await openStrip(scaleFactor, false);
    const pages = renderer!.shadowRoot!.querySelectorAll<HTMLElement>('.scroll-page');
    const hostRect = renderer!.getBoundingClientRect();
    for (const boundary of [1, 2]) {
      const top = pages[boundary]!.getBoundingClientRect().top;
      renderer!.scrollTop += top - hostRect.top - hostRect.height / 2;
      await waitFor(() => loaded.has(boundary - 1) && loaded.has(boundary));
      await nextFrames();
      expect(await findSeam(false), `boundary ${boundary}`).toEqual([]);
    }
  });

  it.each([
    '129',
    '211',
    '250',
  ])('leaves no line between horizontally scrolled pages at scale-factor %s', async (scaleFactor) => {
    const loaded = await openStrip(scaleFactor, true);
    const pages = renderer!.shadowRoot!.querySelectorAll<HTMLElement>('.scroll-page');
    const hostRect = renderer!.getBoundingClientRect();
    const left = pages[1]!.getBoundingClientRect().left;
    renderer!.scrollLeft += left - hostRect.left - hostRect.width / 2;
    await waitFor(() => loaded.has(0) && loaded.has(1));
    await nextFrames();
    expect(await findSeam(true)).toEqual([]);
  });
});
