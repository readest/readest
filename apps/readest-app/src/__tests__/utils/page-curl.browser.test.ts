import { describe, it, expect, afterEach } from 'vitest';
import { PageCurlRenderer } from '@/utils/pageCurl';

// Tests for the WebGL page-curl renderer (readest#555 mesh curl groundwork).
// A synthetic two-tone page texture makes the deformation checkable per
// pixel: green on the spine half, dark blue on the outer half. Mid-curl the
// outer half must have curled away (transparent), its whitened mirrored back
// landing on top of the spine side.

const W = 400;
const H = 300;

const makePageTexture = () => {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgb(0, 160, 0)';
  ctx.fillRect(0, 0, W / 2, H);
  ctx.fillStyle = 'rgb(0, 0, 160)';
  ctx.fillRect(W / 2, 0, W / 2, H);
  return canvas;
};

describe('PageCurlRenderer (browser)', () => {
  let renderer: PageCurlRenderer;
  let host: HTMLDivElement;

  afterEach(() => {
    renderer?.dispose();
    host?.remove();
  });

  const setup = () => {
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
    renderer.setTexture(makePageTexture());
  };

  it('covers the page exactly at progress 0', () => {
    setup();
    renderer.render(0);
    const left = renderer.readPixel(40, 150);
    const right = renderer.readPixel(W - 20, 150);
    expect(left[3]).toBe(255);
    expect(left[1]).toBeGreaterThan(100); // green half
    expect(right[3]).toBe(255);
    expect(right[2]).toBeGreaterThan(100); // blue half
  });

  it('curls the outer half away, folding its whitened back over the spine side', () => {
    setup();
    renderer.render(0.45, { x: 1, y: 0.5 });

    // The outer (right) region has curled away: transparent, the live page
    // beneath would show through.
    const outer = renderer.readPixel(W - 60, 150);
    expect(outer[3]).toBe(0);

    // The wrapped-over part lands near the spine ON TOP, showing the page
    // back: whitened blue (the mirrored outer-half content).
    const back = renderer.readPixel(100, 150);
    expect(back[3]).toBe(255);
    expect(back[0]).toBeGreaterThan(140); // whitened
    expect(back[2]).toBeGreaterThan(180); // blue tint preserved

    // The far spine edge still shows the flat front (green).
    const front = renderer.readPixel(12, 150);
    expect(front[3]).toBe(255);
    expect(front[1]).toBeGreaterThan(100);
    expect(front[0]).toBeLessThan(120);
  });

  it('fully clears the page at progress 1', () => {
    setup();
    renderer.render(1, { x: 1, y: 0.5 });
    for (const x of [20, W / 2, W - 20]) {
      expect(renderer.readPixel(x, 150)[3]).toBe(0);
    }
  });

  it('tilts the fold for corner grabs', () => {
    setup();
    renderer.render(0.4, { x: 1, y: 1 });
    // A bottom-corner grab folds diagonally: at the same x, the bottom is
    // curled away while the top is still flat.
    const top = renderer.readPixel(W - 110, 20);
    const bottom = renderer.readPixel(W - 110, H - 20);
    expect(top[3]).toBe(255);
    expect(bottom[3]).toBe(0);
  });

  it('mirrors the direction for rtl pages', () => {
    setup();
    renderer.render(0.45, { x: 0, y: 0.5 }, true);
    // rtl grabs the LEFT edge: the left region curls away, the right stays.
    const left = renderer.readPixel(60, 150);
    const right = renderer.readPixel(W - 12, 150);
    expect(left[3]).toBe(0);
    expect(right[3]).toBe(255);
  });
});
