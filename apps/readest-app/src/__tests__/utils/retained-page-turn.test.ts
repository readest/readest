import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Renderer } from '@/types/view';
import { RetainedPageTurn } from '@/app/reader/utils/retainedPageTurn';

let controller: RetainedPageTurn;
let allowed: boolean;
let frames: FrameRequestCallback[];
const capture = vi.fn();
const navigate = vi.fn();
const committed = vi.fn();
const api = {
  preparePageTurn: vi.fn(async () => true),
  beginPageTurn: vi.fn(async () => true),
  movePageTurn: vi.fn(),
  endPageTurn: vi.fn(async (commit: boolean) => commit),
  cancelPageTurn: vi.fn(),
};
beforeEach(() => {
  vi.clearAllMocks();
  allowed = true;
  frames = [];
  api.beginPageTurn.mockImplementation(async () => true);
  api.endPageTurn.mockImplementation(async (commit) => commit);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const element = Object.assign(document.createElement('div'), api) as unknown as Renderer;
  controller = new RetainedPageTurn(
    {
      getHostElement: () => null,
      getContentRect: () => null,
      capture,
      navigate,
      isCaptureAllowed: () => allowed,
    },
    { renderer: element, enabled: () => true, call: vi.fn(async () => ({})) },
    committed,
  );
});
afterEach(() => {
  controller.dispose();
  vi.unstubAllGlobals();
});

describe('retained page-turn controller', () => {
  it('prepares both neighbours without capturing or navigating', async () => {
    expect(await controller.prepareCapture('push')).toBe(true);
    expect(api.preparePageTurn.mock.calls).toEqual([[true], [false]]);
    expect(capture).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
  it('coalesces touch samples and commits the actual views', async () => {
    expect(await controller.beginDrag(true, false, 'push')).toBe(true);
    api.movePageTurn.mockClear();
    controller.moveDrag(0.2, 0.5);
    controller.moveDrag(0.4, 0.5);
    controller.moveDrag(0.7, 0.5);
    expect(api.movePageTurn).not.toHaveBeenCalled();
    frames[0]!(16);
    expect(api.movePageTurn).toHaveBeenCalledExactlyOnceWith(0.7);
    await controller.endDrag(true);
    expect(api.endPageTurn).toHaveBeenCalledExactlyOnceWith(true, expect.any(Number));
    expect(committed).toHaveBeenCalledOnce();
    expect(capture).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
  it('buffers a quick release until the incoming view is ready', async () => {
    let ready!: (value: boolean) => void;
    api.beginPageTurn.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          ready = resolve;
        }),
    );
    const beginning = controller.beginDrag(true, false, 'push');
    await Promise.resolve();
    controller.moveDrag(0.8, 0.5);
    const ending = controller.endDrag(true);
    expect(api.endPageTurn).not.toHaveBeenCalled();
    ready(true);
    await beginning;
    await ending;
    expect(api.movePageTurn).toHaveBeenLastCalledWith(0.8);
    expect(api.endPageTurn).toHaveBeenCalledWith(true, expect.any(Number));
    expect(committed).toHaveBeenCalledOnce();
  });
  it('leaves the active page unchanged when the finger turns back', async () => {
    await controller.beginDrag(true, false, 'push');
    controller.moveDrag(0.3, 0.5);
    await controller.endDrag(false);
    expect(api.endPageTurn).toHaveBeenCalledWith(false, expect.any(Number));
    expect(committed).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
  it('does not commit if an overlay cancels the interaction', async () => {
    await controller.beginDrag(true, false, 'push');
    allowed = false;
    controller.invalidatePreparedCapture();
    await controller.endDrag(true);
    expect(api.cancelPageTurn).toHaveBeenCalled();
    expect(committed).not.toHaveBeenCalled();
  });
  it('does not revive a turn that was disposed during preparation', async () => {
    let ready!: (value: boolean) => void;
    api.beginPageTurn.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          ready = resolve;
        }),
    );
    const beginning = controller.beginDrag(true, false, 'push');
    await Promise.resolve();
    controller.dispose();
    api.cancelPageTurn.mockClear();
    ready(true);
    expect(await beginning).toBe(false);
    expect(api.cancelPageTurn).not.toHaveBeenCalled();
    expect(committed).not.toHaveBeenCalled();
  });
});
