import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MeshCurlTurn, MeshCurlHost } from '@/app/reader/utils/meshCurl';

// Choreography tests for the mesh page-curl controller (readest#555):
// capture the page → overlay the captured bitmap → instantly navigate the
// live view underneath → animate (or scrub) the curl → dispose. Pixel-level
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

describe('MeshCurlTurn (browser)', () => {
  let host: HTMLDivElement;
  let capture: ReturnType<typeof vi.fn<MeshCurlHost['capture']>>;
  let navigate: ReturnType<typeof vi.fn<MeshCurlHost['navigate']>>;
  let controller: MeshCurlTurn;

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
    capture = vi.fn<MeshCurlHost['capture']>().mockResolvedValue(png);
    navigate = vi.fn<MeshCurlHost['navigate']>().mockResolvedValue(undefined);
    const hostApi: MeshCurlHost = {
      getHostElement: () => host,
      getContentRect: contentRect,
      capture,
      navigate,
    };
    controller = new MeshCurlTurn(hostApi, { duration: 40 });
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
    const slow = new MeshCurlTurn(
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
    // Cancel: un-curl, then instantly turn back under the overlay.
    expect(navigate).toHaveBeenNthCalledWith(2, false);
    expect(host.querySelector('canvas')).toBeNull();
  });

  it('commits a drag without a second navigation', async () => {
    await controller.beginDrag(true, false);
    controller.moveDrag(0.7, 0.5);
    await controller.endDrag(true);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(host.querySelector('canvas')).toBeNull();
  });
});
