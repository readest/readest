import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
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

  it('selects resident neighbouring sheets without uploading during either turn', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'blue';
    ctx.fillRect(0, 0, W, H);
    const previous = await createImageBitmap(canvas);
    ctx.fillStyle = 'green';
    ctx.fillRect(0, 0, W, H);
    const next = await createImageBitmap(canvas);
    renderer.prepareAdjacent(previous, next);
    previous.close();
    next.close();
    const gl = host.querySelector('canvas')!.getContext('webgl')!;
    const upload = vi.spyOn(gl, 'texImage2D');
    try {
      expect(renderer.selectAdjacent(true)).toBe(true);
      renderer.render(1);
      expect(renderer.readPixel(W / 2, H / 2)).toEqual([0, 128, 0, 255]);
      expect(renderer.selectAdjacent(false)).toBe(true);
      renderer.render(1);
      expect(renderer.readPixel(W / 2, H / 2)).toEqual([0, 0, 255, 255]);
      expect(upload).not.toHaveBeenCalled();
    } finally {
      upload.mockRestore();
    }
  });

  it('uses the full device DPR for its backing store', () => {
    renderer.dispose();
    renderer = new PageCurlRenderer();
    renderer.attach(host, W, H, 3);

    const canvas = host.querySelector('canvas')!;
    expect(canvas.width).toBe(W * 3);
    expect(canvas.height).toBe(H * 3);
  });

  it('uses the eBoox neutral translucent paper back instead of bleaching it white', () => {
    renderer.render(0.45, { x: 1, y: 0.5 });
    const back = renderer.readPixel(100, 75);
    expect(back[3]).toBe(255);
    expect(back[0]).toBeGreaterThan(35);
    expect(back[0]).toBeLessThan(130);
    expect(back[2]).toBeLessThan(180);
    expect(back[2]).toBeGreaterThan(back[0]);
  });

  it('curls the outer half away, folding its translucent back over the spine side', () => {
    renderer.render(0.45, { x: 1, y: 0.5 });

    // The outer (right) region has curled away: transparent, the live page
    // beneath would show through.
    const outer = renderer.readPixel(W - 60, 75);
    expect(outer[3]).toBe(0);

    // The wrapped-over part lands near the spine ON TOP, showing the page
    // back: translucent blue (the mirrored outer-half content). A straight
    // fold mirrors horizontally only — the top row stays on top, so this
    // is translucent BLUE (not translucent yellow from the bottom row).
    const back = renderer.readPixel(100, 75);
    expect(back[3]).toBe(255);
    expect(back[0]).toBeGreaterThanOrEqual(50); // neutral grey plus the edge tint
    expect(back[0]).toBeLessThan(90);
    expect(back[2]).toBeGreaterThan(130); // blue printing remains visible
    expect(back[2]).toBeLessThan(160);
    expect(back[1]).toBeLessThan(back[2]); // not yellow: rows did not flip

    // The far spine edge still shows the flat front (green).
    const front = renderer.readPixel(12, 75);
    expect(front[3]).toBe(255);
    expect(front[1]).toBeGreaterThan(100);
    expect(front[0]).toBeLessThan(120);
  });

  it('keeps the neutral translucent back independent of the host backdrop', () => {
    const paper = document.createElement('canvas');
    paper.width = W;
    paper.height = H;
    const ctx = paper.getContext('2d')!;
    ctx.fillStyle = 'rgb(20, 20, 20)';
    ctx.fillRect(0, 0, W, H);
    renderer.setBackdrop(paper);
    renderer.render(0.45, { x: 1, y: 0.5 });

    // eBoox derives its translucent back from the captured printing and a
    // neutral grey tint, including when a separate dark backdrop is supplied.
    const back = renderer.readPixel(100, 75);
    expect(back[3]).toBe(255);
    expect(back[0]).toBeLessThan(90);
    expect(back[2]).toBeGreaterThan(35); // faint blue remainder
    expect(back[2]).toBeGreaterThan(130);
    expect(back[2]).toBeLessThan(160);

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

  it('updates the page without allocating another GPU texture', async () => {
    const gl = host.querySelector('canvas')!.getContext('webgl')!;
    const allocate = vi.spyOn(gl, 'createTexture');
    try {
      const page = await makePageBitmap();
      renderer.setTexture(page);
      page.close();
      expect(allocate).not.toHaveBeenCalled();
      renderer.render(0);
      expect(renderer.readPixel(20, 20).slice(0, 3)).toEqual([0, 160, 0]);
    } finally {
      allocate.mockRestore();
    }
  });

  it('keeps the detached GPU frame alive until the DOM removal has painted', async () => {
    renderer.render(0);
    const gl = host.querySelector('canvas')!.getContext('webgl')!;
    renderer.dispose();
    expect(host.querySelector('canvas')).toBeNull();
    expect(gl.isContextLost()).toBe(false);
    await vi.waitFor(() => expect(gl.isContextLost()).toBe(true));
  });

  it('tilts the fold with vertical finger displacement', () => {
    renderer.render(0.4, { x: 1, y: 1 });
    // Dragging downward rotates the fold: the upper edge curls away first.
    const top = renderer.readPixel(W - 200, 20);
    const bottom = renderer.readPixel(W - 200, H - 20);
    expect(top[3]).toBe(0);
    expect(bottom[3]).toBe(255);
  });

  it('mirrors the direction for rtl pages', () => {
    renderer.render(0.45, { x: 0, y: 0.5 }, true);
    // rtl grabs the LEFT edge: the left region curls away, the right stays.
    const left = renderer.readPixel(60, 75);
    const right = renderer.readPixel(W - 12, 75);
    expect(left[3]).toBe(0);
    expect(right[3]).toBe(255);
  });

  it('returns the previous page over the current one around the same spine', () => {
    const previous = document.createElement('canvas');
    previous.width = W;
    previous.height = H;
    const ctx = previous.getContext('2d')!;
    ctx.fillStyle = 'rgb(180, 60, 200)';
    ctx.fillRect(0, 0, W, H);
    renderer.setReturning(previous);
    renderer.render(0, { x: 1, y: 0.5 }, false);
    expect(renderer.readPixel(20, 75).slice(0, 3)).toEqual([0, 160, 0]);
    expect(renderer.readPixel(W - 20, 75).slice(0, 3)).toEqual([0, 0, 160]);
    renderer.render(0.4, { x: 1, y: 0.5 }, false);
    // The previous leaf is arriving from the LEFT; its right edge has not
    // covered the outer edge of the current page yet.
    expect(renderer.readPixel(W - 20, 75).slice(0, 3)).toEqual([0, 0, 160]);
    renderer.render(1, { x: 1, y: 0.5 }, false);
    expect(renderer.readPixel(20, 75).slice(0, 3)).toEqual([180, 60, 200]);
    expect(renderer.readPixel(W - 20, 75).slice(0, 3)).toEqual([180, 60, 200]);
    renderer.render(0, { x: 1, y: 0.5 }, false);
    expect(renderer.readPixel(20, 75).slice(0, 3)).toEqual([0, 160, 0]);
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
    // The paper back still lands on the inner column (translucent blue/yellow),
    // never mirrored-away transparency, so the fade has something to fade.
    const landed = renderer.readPixel(HALF / 2, 75);
    expect(landed[3]).toBe(255);
    expect(landed[0]).toBeCloseTo(51, -1);
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

  it('returns a spread without replacing the current inner column too early', () => {
    const previous = document.createElement('canvas');
    previous.width = W;
    previous.height = H;
    const ctx = previous.getContext('2d')!;
    ctx.fillStyle = 'rgb(0, 200, 200)';
    ctx.fillRect(0, 0, HALF, H);
    ctx.fillStyle = 'rgb(200, 0, 200)';
    ctx.fillRect(HALF, 0, HALF, H);
    for (const rtl of [false, true]) {
      renderer.setReturning(previous);
      renderer.render(0, { x: rtl ? 0 : 1, y: 0.5 }, rtl);
      expect(renderer.readPixel(20, 75).slice(0, 3)).toEqual([0, 160, 0]);
      expect(renderer.readPixel(W - 20, 75).slice(0, 3)).toEqual([0, 0, 160]);
      renderer.render(1, { x: rtl ? 0 : 1, y: 0.5 }, rtl);
      expect(renderer.readPixel(20, 75).slice(0, 3)).toEqual([0, 200, 200]);
      expect(renderer.readPixel(W - 20, 75).slice(0, 3)).toEqual([200, 0, 200]);
      expect(renderer.canvasOpacity).toBe('');
    }
  });
});
