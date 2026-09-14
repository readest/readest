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

// Two-column spreads turn one leaf hinged at the spine (readest#6106): the
// outer column curls, stops at the middle, and lands on the inner column as
// an exact mirror, showing the incoming page on its back. The incoming
// texture is the inner column of the NEXT spread: a different two-tone
// bitmap (cyan | magenta across its width) so the mirror mapping is
// checkable — once landed, the leaf's back must read like the live page it
// is about to hand over to, pixel for pixel.
describe('PageCurlRenderer two-column leaf (browser)', () => {
  let renderer: PageCurlRenderer;
  let host: HTMLDivElement;
  const HALF = W / 2;

  const makeIncomingBitmap = async (): Promise<ImageBitmap> => {
    const canvas = document.createElement('canvas');
    canvas.width = HALF;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgb(0, 200, 200)';
    ctx.fillRect(0, 0, HALF / 2, H);
    ctx.fillStyle = 'rgb(200, 0, 200)';
    ctx.fillRect(HALF / 2, 0, HALF / 2, H);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), 'image/png'),
    );
    return createImageBitmap(blob);
  };

  const near = (px: number[], rgb: [number, number, number], tolerance = 12) =>
    Math.abs(px[0]! - rgb[0]) <= tolerance &&
    Math.abs(px[1]! - rgb[1]) <= tolerance &&
    Math.abs(px[2]! - rgb[2]) <= tolerance;

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
    renderer.setColumns(2);
  });

  afterEach(() => {
    renderer?.dispose();
    host?.remove();
  });

  it('covers both columns exactly at progress 0', () => {
    renderer.render(0, { x: 1, y: 0.5 });
    expect(renderer.readPixel(20, 20).slice(0, 3)).toEqual([0, 160, 0]);
    expect(renderer.readPixel(W - 20, 20).slice(0, 3)).toEqual([0, 0, 160]);
    expect(renderer.readPixel(20, H - 20).slice(0, 3)).toEqual([160, 0, 0]);
    expect(renderer.readPixel(W - 20, H - 20).slice(0, 3)).toEqual([160, 160, 0]);
    expect(renderer.canvasOpacity).toBe('');
  });

  it('keeps the inner column flat while the outer leaf curls', () => {
    renderer.render(0.35, { x: 1, y: 0.5 });
    // The outer edge has lifted away: transparent, live page beneath.
    expect(renderer.readPixel(W - 12, 75)[3]).toBe(0);
    // The inner column is untouched and unshaded: exact green / red.
    expect(renderer.readPixel(30, 75).slice(0, 3)).toEqual([0, 160, 0]);
    expect(renderer.readPixel(30, H - 30).slice(0, 3)).toEqual([160, 0, 0]);
    // Just inside the spine the leaf's own flat front is still there (blue).
    const spineSide = renderer.readPixel(HALF + 12, 75);
    expect(spineSide[3]).toBe(255);
    expect(spineSide[2]).toBeGreaterThan(120);
  });

  it('lands the leaf on the inner column as an exact mirror of the incoming page', async () => {
    renderer.setIncoming(await makeIncomingBitmap());
    renderer.render(1, { x: 1, y: 0.5 });
    // The outer column has turned away completely.
    for (const x of [HALF + 20, HALF + HALF / 2, W - 20]) {
      expect(renderer.readPixel(x, 150)[3]).toBe(0);
    }
    // The inner column now shows the incoming page, unmirrored and unshaded:
    // cyan on its left half, magenta on its right half, at every row.
    for (const y of [10, 75, 150, 225, H - 10]) {
      const left = renderer.readPixel(HALF / 4, y);
      const right = renderer.readPixel((3 * HALF) / 4, y);
      expect(left[3]).toBe(255);
      expect(right[3]).toBe(255);
      expect(near(left, [0, 200, 200])).toBe(true);
      expect(near(right, [200, 0, 200])).toBe(true);
    }
    // The spine edge and the outer edge of the incoming column both land.
    expect(near(renderer.readPixel(HALF - 3, 150), [200, 0, 200])).toBe(true);
    expect(near(renderer.readPixel(3, 150), [0, 200, 200])).toBe(true);
    expect(renderer.canvasOpacity).toBe('');
  });

  it('shows the incoming page on the back of the leaf mid-turn', async () => {
    renderer.setIncoming(await makeIncomingBitmap());
    renderer.render(0.7, { x: 1, y: 0.5 });
    // The landed part of the leaf lies over the inner column left of the
    // spine. The leaf carries its content: the outer edge of the leaf is
    // heading for the far edge of the inner column, so what has landed so
    // far is the incoming page's far (cyan) half, unshaded.
    const landed = renderer.readPixel(HALF - 20, 150);
    expect(landed[3]).toBe(255);
    expect(near(landed, [0, 200, 200])).toBe(true);
    // Far from the spine the old inner page is still uncovered (green).
    expect(renderer.readPixel(20, 75).slice(0, 3)).toEqual([0, 160, 0]);
  });

  it('fades out at the end when no incoming page is available', () => {
    renderer.render(0.5, { x: 1, y: 0.5 });
    expect(renderer.canvasOpacity).toBe('');
    renderer.render(0.9, { x: 1, y: 0.5 });
    expect(parseFloat(renderer.canvasOpacity)).toBeCloseTo(0.5, 1);
    renderer.render(1, { x: 1, y: 0.5 });
    expect(renderer.canvasOpacity).toBe('0');
    // The paper back still lands on the inner column (whitened blue/yellow),
    // never mirrored-away transparency, so the fade has something to fade.
    const landed = renderer.readPixel(HALF / 2, 75);
    expect(landed[3]).toBe(255);
    expect(landed[0]).toBeGreaterThan(140);
  });

  it('turns the left column onto the right for rtl / backward leaves', async () => {
    renderer.setIncoming(await makeIncomingBitmap());
    renderer.render(1, { x: 0, y: 0.5 }, true);
    // The left column has turned away; the right column shows the incoming
    // page unmirrored: cyan on its left half, magenta on its right half.
    expect(renderer.readPixel(20, 150)[3]).toBe(0);
    expect(renderer.readPixel(HALF - 20, 150)[3]).toBe(0);
    expect(near(renderer.readPixel(HALF + HALF / 4, 150), [0, 200, 200])).toBe(true);
    expect(near(renderer.readPixel(HALF + (3 * HALF) / 4, 150), [200, 0, 200])).toBe(true);
  });

  it('leaves single-column pages untouched by leaf state', async () => {
    renderer.setIncoming(await makeIncomingBitmap());
    renderer.setColumns(1);
    renderer.render(1, { x: 1, y: 0.5 });
    for (const x of [20, W / 2, W - 20]) {
      expect(renderer.readPixel(x, 150)[3]).toBe(0);
    }
    expect(renderer.canvasOpacity).toBe('');
  });
});
