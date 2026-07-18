import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CapturedPageTurn, CapturedTurnHost } from '@/app/reader/utils/capturedTurn';

// Choreography tests for the captured page-turn controller (readest#555):
// capture the page → overlay the captured bitmap → instantly navigate the
// live view underneath → animate (or scrub) the turn → dispose. Pixel-level
// curl geometry is covered by page-curl.browser.test.ts; these tests assert
// the orchestration contract against a fake host.

const W = 320;
const H = 240;

const makePngBuffer = async (): Promise<ArrayBuffer> => {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgb(200, 60, 60)';
  ctx.fillRect(0, 0, W, H);
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
  return blob.arrayBuffer();
};

describe('CapturedPageTurn (browser)', () => {
  let host: HTMLDivElement;
  let capture: ReturnType<typeof vi.fn<CapturedTurnHost['capture']>>;
  let navigate: ReturnType<typeof vi.fn<CapturedTurnHost['navigate']>>;
  let controller: CapturedPageTurn;

  const contentRect = () => new DOMRect(10, 20, W, H);

  beforeEach(async () => {
    host = document.createElement('div');
    Object.assign(host.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: '400px',
      height: '300px',
    });
    document.body.appendChild(host);
    const png = await makePngBuffer();
    capture = vi.fn<CapturedTurnHost['capture']>().mockResolvedValue(png);
    navigate = vi.fn<CapturedTurnHost['navigate']>().mockResolvedValue(undefined);
    const hostApi: CapturedTurnHost = {
      getHostElement: () => host,
      getContentRect: contentRect,
      capture,
      navigate,
    };
    controller = new CapturedPageTurn(hostApi, { duration: 40 });
  });

  afterEach(() => {
    controller.dispose();
    host.remove();
  });

  it('captures the content rect, navigates once, and disposes after a turn', async () => {
    const ok = await controller.turn(true, false);
    expect(ok).toBe(true);
    expect(capture).toHaveBeenCalledWith({ x: 10, y: 20, width: W, height: H });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(true);
    // Overlay fully cleaned up.
    expect(host.querySelector('canvas')).toBeNull();
  });

  it('mounts the overlay canvas over the content box while animating', async () => {
    // Slow animation so the overlay is reliably observable mid-turn.
    const slow = new CapturedPageTurn(
      { getHostElement: () => host, getContentRect: contentRect, capture, navigate },
      { duration: 5000 },
    );
    const turned = slow.turn(true, false);
    // Wait until the async capture+navigate steps have mounted the overlay.
    await vi.waitFor(() => {
      expect(host.querySelector('canvas')).not.toBeNull();
    });
    const overlay = host.querySelector('canvas')!.parentElement!;
    expect(overlay.style.left).toBe('10px');
    expect(overlay.style.top).toBe('20px');
    slow.dispose();
    await turned;
    expect(host.querySelector('canvas')).toBeNull();
  });

  it('slides the captured page toward the spine on a forward LTR turn', async () => {
    const slow = new CapturedPageTurn(
      { getHostElement: () => host, getContentRect: contentRect, capture, navigate },
      { duration: 5000 },
    );
    const turned = slow.turn(true, false, 'slide');
    await vi.waitFor(() => {
      expect(host.querySelector('canvas')).not.toBeNull();
    });
    const canvas = host.querySelector('canvas')!;
    // The overlay clips the exiting page to the content box like the VT slide.
    expect(canvas.parentElement!.style.overflow).toBe('hidden');
    await vi.waitFor(() => {
      const shift = new DOMMatrixReadOnly(getComputedStyle(canvas).transform).e;
      expect(shift).toBeLessThan(0);
    });
    slow.dispose();
    await turned;
    expect(host.querySelector('canvas')).toBeNull();
  });

  it('slides backward turns out over the outer edge (mirrored)', async () => {
    const slow = new CapturedPageTurn(
      { getHostElement: () => host, getContentRect: contentRect, capture, navigate },
      { duration: 5000 },
    );
    const turned = slow.turn(false, false, 'slide');
    await vi.waitFor(() => {
      expect(host.querySelector('canvas')).not.toBeNull();
    });
    const canvas = host.querySelector('canvas')!;
    await vi.waitFor(() => {
      const shift = new DOMMatrixReadOnly(getComputedStyle(canvas).transform).e;
      expect(shift).toBeGreaterThan(0);
    });
    slow.dispose();
    await turned;
  });

  it('propagates capture failures without navigating or leaving an overlay', async () => {
    capture.mockRejectedValueOnce(new Error('no capture'));
    await expect(controller.turn(true, false)).rejects.toThrow('no capture');
    expect(navigate).not.toHaveBeenCalled();
    expect(host.querySelector('canvas')).toBeNull();
  });

  it('interrupts an in-flight turn when a new one starts', async () => {
    const first = controller.turn(true, false);
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    const second = controller.turn(true, false);
    await Promise.all([first, second]);
    expect(navigate).toHaveBeenCalledTimes(2);
    expect(host.querySelector('canvas')).toBeNull();
  });

  it('scrubs a drag and navigates back when cancelled', async () => {
    const began = await controller.beginDrag(true, false);
    expect(began).toBe(true);
    expect(navigate).toHaveBeenNthCalledWith(1, true);
    expect(host.querySelector('canvas')).not.toBeNull();

    controller.moveDrag(0.3, 0.5);
    await controller.endDrag(false);
    // Cancel: back to flat, then instantly turn back under the overlay.
    expect(navigate).toHaveBeenNthCalledWith(2, false);
    expect(host.querySelector('canvas')).toBeNull();
  });

  it('scrubs a slide drag and cleans up on commit', async () => {
    const began = await controller.beginDrag(true, false, 'slide');
    expect(began).toBe(true);
    const canvas = host.querySelector('canvas')!;
    controller.moveDrag(0.5, 0.5);
    expect(new DOMMatrixReadOnly(getComputedStyle(canvas).transform).e).toBeCloseTo(-W / 2, 0);
    await controller.endDrag(true);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(host.querySelector('canvas')).toBeNull();
  });

  it('commits a drag without a second navigation', async () => {
    await controller.beginDrag(true, false);
    controller.moveDrag(0.7, 0.5);
    await controller.endDrag(true);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(host.querySelector('canvas')).toBeNull();
  });

  // The release's endDrag can arrive while beginDrag's async capture is still
  // in flight — after an instant-highlight release, the queued trailing
  // touchmoves race the unlock and can start a drag milliseconds before the
  // touchend. A direct no-op left the overlay stranded at progress 0 (the
  // degraded captured bitmap on screen) with the live view already turned
  // underneath, making every following turn off by one page.
  it('an endDrag racing the capture still cancels once set up (no stranded overlay)', async () => {
    const png = await makePngBuffer();
    let resolveCapture!: (png: ArrayBuffer) => void;
    capture.mockImplementationOnce(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          resolveCapture = resolve;
        }),
    );

    const began = controller.beginDrag(true, false);
    const ended = controller.endDrag(false);
    await vi.waitFor(() => expect(capture).toHaveBeenCalled());
    resolveCapture(png);
    await Promise.all([began, ended]);

    // The queued cancel navigated back and nothing is left on screen.
    expect(navigate).toHaveBeenNthCalledWith(1, true);
    expect(navigate).toHaveBeenNthCalledWith(2, false);
    expect(navigate).toHaveBeenCalledTimes(2);
    expect(host.querySelector('canvas')).toBeNull();
    expect(controller.active).toBe(false);
  });

  it('an endDrag racing the capture can also commit', async () => {
    const png = await makePngBuffer();
    let resolveCapture!: (png: ArrayBuffer) => void;
    capture.mockImplementationOnce(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          resolveCapture = resolve;
        }),
    );

    const began = controller.beginDrag(true, false);
    const ended = controller.endDrag(true);
    await vi.waitFor(() => expect(capture).toHaveBeenCalled());
    resolveCapture(png);
    await Promise.all([began, ended]);

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(host.querySelector('canvas')).toBeNull();
    expect(controller.active).toBe(false);
  });
});
