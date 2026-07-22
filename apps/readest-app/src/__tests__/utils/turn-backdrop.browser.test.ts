import { describe, it, expect, afterEach } from 'vitest';
import { renderTurnBackdrop } from '@/app/reader/utils/turnBackdrop';

// Tests for the captured-turn backdrop painter: the "paper" shown on the
// back of the WebGL page curl. It must reproduce the theme background —
// the solid theme color plus the active background texture composited the
// way the viewer's ::before layer draws it (blend mode, opacity).

const readPixel = (canvas: HTMLCanvasElement, x: number, y: number) =>
  Array.from(canvas.getContext('2d')!.getImageData(x, y, 1, 1).data);

const solidPngUrl = (r: number, g: number, b: number) => {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 4;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
  ctx.fillRect(0, 0, 4, 4);
  return canvas.toDataURL('image/png');
};

describe('renderTurnBackdrop (browser)', () => {
  const mounted: Element[] = [];
  const mount = <T extends Element>(el: T): T => {
    document.body.appendChild(el);
    mounted.push(el);
    return el;
  };

  afterEach(() => {
    for (const el of mounted.splice(0)) el.remove();
  });

  it('paints the plain theme color when no texture is active', async () => {
    const viewer = mount(document.createElement('div'));
    const canvas = await renderTurnBackdrop(viewer, 'rgb(30, 40, 50)', 60, 40);
    expect(canvas).not.toBeNull();
    expect(readPixel(canvas!, 30, 20)).toEqual([30, 40, 50, 255]);
  });

  it('composites the ::before texture with its blend mode and opacity', async () => {
    const style = mount(document.createElement('style'));
    style.textContent = `
      .backdrop-tex::before {
        content: "";
        position: absolute;
        inset: 0;
        background-image: url("${solidPngUrl(100, 100, 100)}");
        background-size: cover;
        mix-blend-mode: lighten;
        opacity: 0.5;
      }
    `;
    const viewer = mount(document.createElement('div'));
    viewer.className = 'backdrop-tex';

    const canvas = await renderTurnBackdrop(viewer, 'rgb(40, 40, 40)', 64, 48);
    expect(canvas).not.toBeNull();
    // lighten(40, 100) = 100, layered at 0.5 over the base 40 -> 70.
    const [r, g, b, a] = readPixel(canvas!, 32, 24);
    expect(a).toBe(255);
    for (const channel of [r, g, b]) {
      expect(channel).toBeGreaterThan(66);
      expect(channel).toBeLessThan(74);
    }
  });

  it('falls back to the plain color when the texture image cannot load', async () => {
    const style = mount(document.createElement('style'));
    style.textContent = `
      .backdrop-broken::before {
        content: "";
        position: absolute;
        inset: 0;
        background-image: url("data:image/png;base64,broken");
      }
    `;
    const viewer = mount(document.createElement('div'));
    viewer.className = 'backdrop-broken';

    const canvas = await renderTurnBackdrop(viewer, 'rgb(10, 20, 30)', 20, 20);
    expect(canvas).not.toBeNull();
    expect(readPixel(canvas!, 10, 10)).toEqual([10, 20, 30, 255]);
  });
});
