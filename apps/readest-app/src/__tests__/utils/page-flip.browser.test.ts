import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { PageCurlRenderer } from '@/utils/pageCurl';

// Page Flip on the captured-turn canvas: the whole sheet lifts over the
// spine instead of curling. Same four-quadrant page as page-curl's tests:
// green | blue on top, red | yellow below.

const W = 400;
const H = 300;

const makePageBitmap = async (): Promise<ImageBitmap> => {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgb(0, 160, 0)';
  ctx.fillRect(0, 0, W / 2, H / 2);
  ctx.fillStyle = 'rgb(0, 0, 160)';
  ctx.fillRect(W / 2, 0, W / 2, H / 2);
  ctx.fillStyle = 'rgb(160, 0, 0)';
  ctx.fillRect(0, H / 2, W / 2, H / 2);
  ctx.fillStyle = 'rgb(160, 160, 0)';
  ctx.fillRect(W / 2, H / 2, W / 2, H / 2);
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
  return createImageBitmap(blob);
};

const solid = (rgb: string) => {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = rgb;
  ctx.fillRect(0, 0, W, H);
  return canvas;
};

describe('PageCurlRenderer Page Flip (browser)', () => {
  let renderer: PageCurlRenderer;
  let host: HTMLDivElement;
  const grab = { x: 1, y: 0.5 };

  /** Settle a released flip, counting its frames. */
  const settle = (rtl = false) => {
    let frames = 0;
    while (renderer.advance(1 / 60, rtl)) expect(++frames).toBeLessThan(200);
    return frames;
  };

  beforeEach(async () => {
    host = document.createElement('div');
    Object.assign(host.style, { position: 'absolute', left: '0', top: '0' });
    document.body.appendChild(host);
    renderer = new PageCurlRenderer({ pageFlip: true });
    renderer.attach(host, W, H, 1);
    renderer.setTexture(await makePageBitmap());
  });

  afterEach(() => {
    renderer?.dispose();
    host?.remove();
  });

  it('covers the page flat and upright before the turn', () => {
    expect(renderer.setFlip(true)).toBe(true);
    renderer.render(0, grab, false);
    expect(renderer.readPixel(40, 75)).toEqual([0, 160, 0, 255]);
    expect(renderer.readPixel(W - 20, 75)).toEqual([0, 0, 160, 255]);
    expect(renderer.readPixel(40, H - 75)).toEqual([160, 0, 0, 255]);
  });

  it('lifts the whole sheet off its free edge while held', () => {
    renderer.setFlip(true);
    renderer.render(0, grab, false);
    renderer.render(0.6, grab, false);
    // The live page shows where the sheet has left: at most a cast shadow.
    const edge = renderer.readPixel(W - 4, 75);
    expect(edge.slice(0, 3)).toEqual([0, 0, 0]);
    expect(edge[3]).toBeLessThan(120);
    // The sheet still rises from the spine.
    expect(renderer.readPixel(4, 75)[3]).toBe(255);
  });

  it('plays a tapped turn off the page, leaving nothing behind', () => {
    renderer.setFlip(true);
    renderer.render(0, grab, false);
    expect(renderer.release(true)).toBe(true);
    const frames = settle();
    expect(frames).toBeGreaterThan(5);
    renderer.render(1, grab, false);
    for (const x of [4, W / 2, W - 4]) expect(renderer.readPixel(x, 75)[3]).toBe(0);
  });

  it('returns a cancelled drag flat over the page', () => {
    renderer.setFlip(true);
    renderer.render(0.3, grab, false);
    renderer.release(false);
    settle();
    renderer.render(0, grab, false);
    expect(renderer.readPixel(W - 20, 75)).toEqual([0, 0, 160, 255]);
  });

  it('brings a backward sheet over the current page from beyond the spine', () => {
    renderer.setReturning(solid('rgb(180, 60, 200)'));
    renderer.setFlip(true);
    // Waiting off the page: only the current page shows.
    renderer.render(0, grab, false);
    expect(renderer.readPixel(4, 75)).toEqual([0, 160, 0, 255]);
    expect(renderer.readPixel(W - 4, 75)).toEqual([0, 0, 160, 255]);
    renderer.release(true);
    // Its first frame already shows part of the sheet: no invisible lead-in.
    renderer.advance(0, false);
    const shown = [4, W / 4, W / 2].some(
      (x) => renderer.readPixel(x, 75).join() !== [0, 160, 0, 255].join(),
    );
    expect(shown).toBe(true);
    settle();
    renderer.render(1, grab, false);
    expect(renderer.readPixel(4, 75)).toEqual([180, 60, 200, 255]);
    expect(renderer.readPixel(W - 4, 75)).toEqual([180, 60, 200, 255]);
  });

  it('puts the spine on the right for rtl pages', () => {
    renderer.setFlip(true);
    renderer.render(0, grab, true);
    renderer.render(0.6, grab, true);
    expect(renderer.readPixel(W - 4, 75)[3]).toBe(255);
    expect(renderer.readPixel(4, 75)[3]).toBeLessThan(120);
  });

  it('curls on a renderer built only for the curl', () => {
    const curl = new PageCurlRenderer();
    curl.attach(host, W, H, 1);
    try {
      expect(curl.setFlip(true)).toBe(false);
      expect(curl.release(true)).toBe(false);
    } finally {
      curl.dispose();
    }
  });

  it('keeps curling a two-column spread', () => {
    renderer.setColumns(2);
    expect(renderer.setFlip(true)).toBe(false);
    expect(renderer.release(true)).toBe(false);
  });
});
