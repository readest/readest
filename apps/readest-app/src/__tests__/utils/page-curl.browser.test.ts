import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { PageCurlRenderer } from '@/utils/pageCurl';

// Tests for the WebGL page-curl renderer (readest#555 mesh curl groundwork).
// A synthetic four-quadrant page texture makes the deformation checkable per
// pixel — green/blue across the fold axis, red/yellow rows to pin the
// vertical orientation. The texture reaches the renderer the same way
// production does: PNG blob → createImageBitmap. WebKit ignores
// UNPACK_FLIP_Y_WEBGL for ImageBitmap uploads, so the renderer must not
// depend on it — the orientation assertions catch that (upside-down curl
// on iOS, readest#555).

const W = 400;
const H = 300;

const makePageBitmap = async (): Promise<ImageBitmap> => {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  // Top row: green | blue. Bottom row: red | yellow.
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

describe('PageCurlRenderer (browser)', () => {
  let renderer: PageCurlRenderer;
  let host: HTMLDivElement;

  beforeEach(async () => {
    host = document.createElement('div');
    Object.assign(host.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: `${W}px`,
      height: `${H}px`,
    });
    document.body.appendChild(host);
    renderer = new PageCurlRenderer();
    renderer.attach(host, W, H, 1);
    renderer.setTexture(await makePageBitmap());
  });

  afterEach(() => {
    renderer?.dispose();
    host?.remove();
  });

  it('covers the page exactly and upright at progress 0', () => {
    renderer.render(0);
    const topLeft = renderer.readPixel(40, 75);
    const topRight = renderer.readPixel(W - 20, 75);
    expect(topLeft[3]).toBe(255);
    expect(topLeft[1]).toBeGreaterThan(100); // green
    expect(topRight[3]).toBe(255);
    expect(topRight[2]).toBeGreaterThan(100); // blue
    // Vertical orientation: the bottom half must show the bottom of the
    // page (red), not the top — an upside-down texture swaps these.
    const bottomLeft = renderer.readPixel(40, H - 75);
    expect(bottomLeft[3]).toBe(255);
    expect(bottomLeft[0]).toBeGreaterThan(100); // red
    expect(bottomLeft[1]).toBeLessThan(100);
  });

  it('uses the full device DPR for its backing store', () => {
    renderer.dispose();
    renderer = new PageCurlRenderer();
    renderer.attach(host, W, H, 3);

    const canvas = host.querySelector('canvas')!;
    expect(canvas.width).toBe(W * 3);
    expect(canvas.height).toBe(H * 3);
  });

  it('curls the outer half away, folding its whitened back over the spine side', () => {
    renderer.render(0.45, { x: 1, y: 0.5 });

    // The outer (right) region has curled away: transparent, the live page
    // beneath would show through.
    const outer = renderer.readPixel(W - 60, 75);
    expect(outer[3]).toBe(0);

    // The wrapped-over part lands near the spine ON TOP, showing the page
    // back: whitened blue (the mirrored outer-half content). A straight
    // fold mirrors horizontally only — the top row stays on top, so this
    // is whitened BLUE (not whitened yellow from the bottom row).
    const back = renderer.readPixel(100, 75);
    expect(back[3]).toBe(255);
    expect(back[0]).toBeGreaterThan(140); // whitened
    expect(back[2]).toBeGreaterThan(180); // blue tint preserved
    expect(back[1]).toBeLessThan(back[2]); // not yellow: rows did not flip

    // The far spine edge still shows the flat front (green).
    const front = renderer.readPixel(12, 75);
    expect(front[3]).toBe(255);
    expect(front[1]).toBeGreaterThan(100);
    expect(front[0]).toBeLessThan(120);
  });

  it('tints the folded back with the backdrop paper instead of white', () => {
    const paper = document.createElement('canvas');
    paper.width = W;
    paper.height = H;
    const ctx = paper.getContext('2d')!;
    ctx.fillStyle = 'rgb(20, 20, 20)';
    ctx.fillRect(0, 0, W, H);
    renderer.setBackdrop(paper);
    renderer.render(0.45, { x: 1, y: 0.5 });

    // Same wrapped-over sample point as the whitened-back test: with a dark
    // theme backdrop the mirrored blue content mixes toward the dark paper,
    // not toward white.
    const back = renderer.readPixel(100, 75);
    expect(back[3]).toBe(255);
    expect(back[0]).toBeLessThan(60);
    expect(back[2]).toBeGreaterThan(35); // faint blue remainder
    expect(back[2]).toBeLessThan(90);

    // The flat front is not tinted by the backdrop.
    const front = renderer.readPixel(12, 75);
    expect(front[1]).toBeGreaterThan(100);
  });

  it('fully clears the page at progress 1', () => {
    renderer.render(1, { x: 1, y: 0.5 });
    for (const x of [20, W / 2, W - 20]) {
      expect(renderer.readPixel(x, 150)[3]).toBe(0);
    }
  });

  it('tilts the fold for corner grabs', () => {
    renderer.render(0.4, { x: 1, y: 1 });
    // A bottom-corner grab folds diagonally: at the same x, the bottom is
    // curled away while the top is still flat.
    const top = renderer.readPixel(W - 110, 20);
    const bottom = renderer.readPixel(W - 110, H - 20);
    expect(top[3]).toBe(255);
    expect(bottom[3]).toBe(0);
  });

  it('mirrors the direction for rtl pages', () => {
    renderer.render(0.45, { x: 0, y: 0.5 }, true);
    // rtl grabs the LEFT edge: the left region curls away, the right stays.
    const left = renderer.readPixel(60, 75);
    const right = renderer.readPixel(W - 12, 75);
    expect(left[3]).toBe(0);
    expect(right[3]).toBe(255);
  });
});
