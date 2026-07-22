import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CapturedPageTurn,
  CapturedTurnHost,
  type CapturedTurnStyle,
} from '@/app/reader/utils/capturedTurn';

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
  const slideSheet = () => host.querySelector<HTMLElement>('[data-page-slide-sheet]')!;

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

  it('notifies the host after the covering frame is mounted and before navigation', async () => {
    const onCovered = vi.fn<NonNullable<CapturedTurnHost['onCovered']>>(async (style) => {
      expect(style).toBe('curl');
      expect(host.querySelector('canvas')).not.toBeNull();
      expect(navigate).not.toHaveBeenCalled();
    });
    const covered = new CapturedPageTurn({
      getHostElement: () => host,
      getContentRect: contentRect,
      capture,
      onCovered,
      navigate,
    });

    expect(await covered.beginDrag(true, false)).toBe(true);
    expect(onCovered).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledOnce();
    covered.dispose();
  });

  it('records host state before starting the native snapshot', async () => {
    const order: string[] = [];
    const onBeforeCapture = vi.fn(() => {
      order.push('before');
    });
    const orderedCapture = vi.fn<CapturedTurnHost['capture']>(async (rect) => {
      order.push('capture');
      return capture(rect);
    });
    const prepared = new CapturedPageTurn({
      getHostElement: () => host,
      getContentRect: contentRect,
      capture: orderedCapture,
      onBeforeCapture,
      navigate,
    });

    expect(await prepared.beginDrag(true, false)).toBe(true);
    expect(order).toEqual(['before', 'capture']);
    prepared.dispose();
  });

  it('uses a prepared decoded snapshot without recapturing at turn time', async () => {
    expect(await controller.prepareCapture('slide')).toBe(true);
    expect(capture).toHaveBeenCalledTimes(1);

    expect(await controller.turn(true, false, 'slide')).toBe(true);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('falls back to a live capture after the prepared snapshot is invalidated', async () => {
    expect(await controller.prepareCapture('slide')).toBe(true);
    controller.invalidatePreparedCapture();

    expect(await controller.turn(true, false, 'slide')).toBe(true);
    expect(capture).toHaveBeenCalledTimes(2);
  });

  it('lets a turn reuse a matching warm-up already in flight', async () => {
    const png = await makePngBuffer();
    let resolveCapture!: (image: ArrayBuffer) => void;
    capture.mockImplementationOnce(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          resolveCapture = resolve;
        }),
    );

    const warming = controller.prepareCapture('slide');
    await vi.waitFor(() => expect(capture).toHaveBeenCalledOnce());
    const turning = controller.turn(true, false, 'slide');
    resolveCapture(png);

    expect(await warming).toBe(true);
    expect(await turning).toBe(true);
    expect(capture).toHaveBeenCalledTimes(1);
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

  it('draws the host backdrop on the back of the curling page', async () => {
    const paper = document.createElement('canvas');
    paper.width = W;
    paper.height = H;
    const ctx = paper.getContext('2d')!;
    ctx.fillStyle = 'rgb(20, 20, 20)';
    ctx.fillRect(0, 0, W, H);
    const getBackdrop = vi.fn(() => paper);
    const withBackdrop = new CapturedPageTurn(
      { getHostElement: () => host, getContentRect: contentRect, capture, navigate, getBackdrop },
      { duration: 5000 },
    );

    expect(await withBackdrop.beginDrag(true, false)).toBe(true);
    expect(getBackdrop).toHaveBeenCalledOnce();
    withBackdrop.moveDrag(0.45, 0.5);

    // The wrapped-over back face shows the red page mixed toward the dark
    // theme paper — the hardcoded whitened back would read near-white here.
    const canvas = host.querySelector('canvas')!;
    const gl = canvas.getContext('webgl')!;
    const dpr = canvas.width / W;
    const px = new Uint8Array(4);
    gl.readPixels(
      Math.round(100 * dpr),
      canvas.height - 1 - Math.round(60 * dpr),
      1,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      px,
    );
    expect(px[3]).toBe(255);
    expect(px[0]).toBeLessThan(100);
    withBackdrop.dispose();
  });

  it('uses the official WebGL mesh renderer for curl turns', async () => {
    const slow = new CapturedPageTurn(
      { getHostElement: () => host, getContentRect: contentRect, capture, navigate },
      { duration: 5000 },
    );
    const turned = slow.turn(true, false);
    await vi.waitFor(() => {
      const canvas = host.querySelector('canvas');
      expect(canvas).not.toBeNull();
      expect(canvas?.dataset['pageCurlBackend']).toBeUndefined();
      expect(canvas?.getContext('webgl')).not.toBeNull();
    });
    slow.dispose();
    await turned;
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
    const sheet = slideSheet();
    // The overlay clips the exiting page to the content box like the VT slide.
    expect(sheet.parentElement!.style.overflow).toBe('hidden');
    expect(sheet.style.willChange).toBe('transform');
    expect(canvas.style.boxShadow).toBe('');
    expect(host.querySelector<HTMLElement>('[data-page-slide-shadow]')?.style.left).toBe('100%');
    await vi.waitFor(() => {
      const shift = new DOMMatrixReadOnly(getComputedStyle(sheet).transform).e;
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
    const sheet = slideSheet();
    expect(host.querySelector<HTMLElement>('[data-page-slide-shadow]')?.style.left).toBe('-28px');
    await vi.waitFor(() => {
      const shift = new DOMMatrixReadOnly(getComputedStyle(sheet).transform).e;
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

  it('restores host state and removes the overlay when instant navigation fails', async () => {
    const onCancelled = vi.fn<NonNullable<CapturedTurnHost['onCancelled']>>();
    navigate.mockRejectedValueOnce(new Error('navigation failed'));
    const failing = new CapturedPageTurn({
      getHostElement: () => host,
      getContentRect: contentRect,
      capture,
      onCancelled,
      navigate,
    });

    await expect(failing.turn(true, false)).rejects.toThrow('navigation failed');

    expect(onCancelled).toHaveBeenCalledWith('curl');
    expect(host.querySelector('canvas')).toBeNull();
    failing.dispose();
  });

  it('restores host state and removes the overlay when reverse navigation fails', async () => {
    const onCancelled = vi.fn<NonNullable<CapturedTurnHost['onCancelled']>>();
    navigate
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('reverse navigation failed'));
    const failing = new CapturedPageTurn(
      {
        getHostElement: () => host,
        getContentRect: contentRect,
        capture,
        onCancelled,
        navigate,
      },
      { duration: 1 },
    );

    expect(await failing.beginDrag(true, false)).toBe(true);
    failing.moveDrag(0.2, 0.5);
    await expect(failing.endDrag(false)).rejects.toThrow('reverse navigation failed');

    expect(onCancelled).toHaveBeenCalledWith('curl');
    expect(failing.active).toBe(false);
    expect(host.querySelector('canvas')).toBeNull();

    // A rejected cancellation must not poison the serialized turn queue.
    await expect(failing.turn(true, false)).resolves.toBe(true);
    failing.dispose();
  });

  it('drops a concurrent programmatic turn instead of queuing it', async () => {
    // A programmatic turn (key/tap/page-turner) arriving while one is still
    // running is dropped, like the paginator's #locked push turn — it does not
    // queue behind the animation. This is what keeps a spurious opposite key
    // (e.g. the echo an iOS volume press emits when the session volume resets)
    // from turning the page straight back the moment the first turn lands.
    const first = controller.turn(true, false);
    const second = controller.turn(false, false);
    await expect(second).resolves.toBe(false);
    await first;
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(true);
    expect(host.querySelector('canvas')).toBeNull();
  });

  it('does not queue a finger drag behind a running programmatic turn', async () => {
    const turning = controller.turn(true, false);

    await expect(controller.beginDrag(true, false)).resolves.toBe(false);
    await turning;

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(true);
    expect(host.querySelector('canvas')).toBeNull();
  });

  it('runs sequential programmatic turns once the previous one settles', async () => {
    expect(await controller.turn(true, false)).toBe(true);
    expect(await controller.turn(true, false)).toBe(true);
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

  it.each([
    'curl',
    'slide',
  ] as CapturedTurnStyle[])('notifies the host under the flat overlay when a %s drag is cancelled', async (style) => {
    const onCancelled = vi.fn(async (cancelledStyle: CapturedTurnStyle) => {
      expect(cancelledStyle).toBe(style);
      expect(navigate).toHaveBeenNthCalledWith(2, false);
      expect(host.querySelector('canvas')).not.toBeNull();
      if (cancelledStyle === 'slide') {
        expect(new DOMMatrixReadOnly(getComputedStyle(slideSheet()).transform).e).toBeCloseTo(0, 5);
      }
    });
    const cancellable = new CapturedPageTurn({
      getHostElement: () => host,
      getContentRect: contentRect,
      capture,
      onCancelled,
      navigate,
    });

    expect(await cancellable.beginDrag(true, false, style)).toBe(true);
    cancellable.moveDrag(0.3, 0.5);
    await cancellable.endDrag(false);

    expect(onCancelled).toHaveBeenCalledOnce();
    expect(host.querySelector('canvas')).toBeNull();
    cancellable.dispose();
  });

  it('scrubs a slide drag and cleans up on commit', async () => {
    const began = await controller.beginDrag(true, false, 'slide');
    expect(began).toBe(true);
    const sheet = slideSheet();
    controller.moveDrag(0.5, 0.5);
    expect(new DOMMatrixReadOnly(getComputedStyle(sheet).transform).e).toBeCloseTo(-W / 2, 0);
    await controller.endDrag(true);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(host.querySelector('canvas')).toBeNull();
  });

  it('keeps Curl settle on the requestAnimationFrame path', async () => {
    const paced = new CapturedPageTurn(
      { getHostElement: () => host, getContentRect: contentRect, capture, navigate },
      { duration: 1000 },
    );
    expect(await paced.beginDrag(true, false, 'curl')).toBe(true);
    paced.moveDrag(0.5, 0.5);

    const frames: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    try {
      const ending = paced.endDrag(true, 1.5);
      await vi.waitFor(() => expect(frames).toHaveLength(1));

      const expectedDuration = 500 / 1.5;
      frames.shift()!(expectedDuration - 1);
      expect(paced.active).toBe(true);
      expect(frames).toHaveLength(1);

      frames.shift()!(expectedDuration);
      await ending;
      expect(paced.active).toBe(false);
    } finally {
      paced.dispose();
      raf.mockRestore();
      now.mockRestore();
    }
  });

  it.each([
    { progress: 0.5, velocity: 1.5, commit: true, expectedDuration: 250 },
    { progress: 0.5, velocity: 0.6, commit: true, expectedDuration: 500 / 1.5 },
    { progress: 0.8, velocity: 1.5, commit: true, expectedDuration: 100 },
    {
      progress: 0.95,
      velocity: 1.5,
      commit: true,
      expectedDuration: 1000 * Math.abs(1 - 0.95),
    },
    { progress: 0.5, velocity: -1.5, commit: true, expectedDuration: 500 },
    { progress: 0.5, velocity: -1.5, commit: false, expectedDuration: 250 },
  ] as const)('settles Slide from $progress toward commit=$commit on WAAPI at the bounded momentum duration', async ({
    progress,
    velocity,
    commit,
    expectedDuration,
  }) => {
    const paced = new CapturedPageTurn(
      { getHostElement: () => host, getContentRect: contentRect, capture, navigate },
      { duration: 1000 },
    );
    expect(await paced.beginDrag(true, false, 'slide')).toBe(true);
    paced.moveDrag(progress, 0.5);
    const sheet = slideSheet();
    const nativeAnimate = sheet.animate.bind(sheet);
    const animate = vi.spyOn(sheet, 'animate').mockImplementation((keyframes, options) => {
      const animation = nativeAnimate(keyframes, options);
      animation.pause();
      return animation;
    });
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    try {
      const ending = paced.endDrag(commit, velocity);
      await vi.waitFor(() => expect(animate).toHaveBeenCalledOnce());
      const animation = animate.mock.results[0]!.value;
      const effect = animation.effect as KeyframeEffect;

      expect(Number(effect.getTiming().duration)).toBeCloseTo(expectedDuration, 5);
      expect(effect.getTiming().easing).toBe('linear');
      const keyframes = effect.getKeyframes();
      expect(keyframes).toHaveLength(33);
      expect(keyframes[0]!.offset).toBe(0);
      expect(keyframes.at(-1)!.offset).toBe(1);
      expect(raf).not.toHaveBeenCalled();

      animation.finish();
      await ending;
      expect(paced.active).toBe(false);
      if (!commit) expect(navigate).toHaveBeenLastCalledWith(false);
    } finally {
      paced.dispose();
      animate.mockRestore();
      raf.mockRestore();
    }
  });

  it('falls back to requestAnimationFrame when Slide WAAPI is unavailable', async () => {
    const paced = new CapturedPageTurn(
      { getHostElement: () => host, getContentRect: contentRect, capture, navigate },
      { duration: 1000 },
    );
    expect(await paced.beginDrag(true, false, 'slide')).toBe(true);
    paced.moveDrag(0.5, 0.5);
    const sheet = slideSheet();
    Object.defineProperty(sheet, 'animate', { value: undefined, configurable: true });

    const frames: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    try {
      const ending = paced.endDrag(true);
      await vi.waitFor(() => expect(frames).toHaveLength(1));
      frames.shift()!(499);
      expect(paced.active).toBe(true);
      frames.shift()!(500);
      await ending;
      expect(paced.active).toBe(false);
    } finally {
      Reflect.deleteProperty(sheet, 'animate');
      paced.dispose();
      raf.mockRestore();
      now.mockRestore();
    }
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

  it('finishes a fast swipe released before its snapshot is ready', async () => {
    let resolveCapture!: (image: ArrayBuffer) => void;
    const deferredCapture = new Promise<ArrayBuffer>((resolve) => {
      resolveCapture = resolve;
    });
    const rapid = new CapturedPageTurn({
      getHostElement: () => host,
      getContentRect: contentRect,
      capture: () => deferredCapture,
      navigate,
    });

    const beginning = rapid.beginDrag(true, false);
    const ending = rapid.endDrag(true);
    resolveCapture(await makePngBuffer());
    await Promise.all([beginning, ending]);

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(host.querySelector('canvas')).toBeNull();
    rapid.dispose();
  });

  it('settles a pending capture from its latest buffered drag sample', async () => {
    let resolveCapture!: (image: ArrayBuffer) => void;
    const deferredCapture = new Promise<ArrayBuffer>((resolve) => {
      resolveCapture = resolve;
    });
    const rapid = new CapturedPageTurn(
      {
        getHostElement: () => host,
        getContentRect: contentRect,
        capture: () => deferredCapture,
        navigate,
      },
      { duration: 5000 },
    );

    const beginning = rapid.beginDrag(true, false, 'slide');
    rapid.moveDrag(0.75, 0.52);
    const ending = rapid.endDrag(true);
    resolveCapture(await makePngBuffer());

    await beginning;
    expect(new DOMMatrixReadOnly(getComputedStyle(slideSheet()).transform).e).toBeCloseTo(
      -W * 0.75,
      0,
    );

    // Stop the deliberately slow settle and let its promise drain.
    rapid.dispose();
    await ending;
  });

  it('cancels an unreleased drag before starting its replacement', async () => {
    expect(await controller.beginDrag(true, false, 'slide')).toBe(true);
    controller.moveDrag(0.3, 0.5);

    // No endDrag for the first gesture: beginDrag must synthesize its cancel
    // before it captures and navigates the replacement page.
    expect(await controller.beginDrag(true, false, 'slide')).toBe(true);
    expect(navigate).toHaveBeenNthCalledWith(1, true);
    expect(navigate).toHaveBeenNthCalledWith(2, false);
    expect(navigate).toHaveBeenNthCalledWith(3, true);

    await controller.endDrag(false);
    expect(navigate).toHaveBeenNthCalledWith(4, false);
    expect(host.querySelector('canvas')).toBeNull();
  });

  it('cancels an unreleased drag before a programmatic turn', async () => {
    expect(await controller.beginDrag(true, false, 'slide')).toBe(true);
    controller.moveDrag(0.3, 0.5);

    expect(await controller.turn(true, false, 'slide')).toBe(true);
    expect(navigate).toHaveBeenNthCalledWith(1, true);
    expect(navigate).toHaveBeenNthCalledWith(2, false);
    expect(navigate).toHaveBeenNthCalledWith(3, true);
    expect(host.querySelector('canvas')).toBeNull();
  });

  it('ignores drag samples delivered after release', async () => {
    const slow = new CapturedPageTurn(
      { getHostElement: () => host, getContentRect: contentRect, capture, navigate },
      { duration: 5000 },
    );
    expect(await slow.beginDrag(true, false, 'slide')).toBe(true);
    const sheet = slideSheet();
    slow.moveDrag(0.25, 0.5);
    const ending = slow.endDrag(true);

    slow.moveDrag(0.9, 0.5);
    expect(new DOMMatrixReadOnly(getComputedStyle(sheet).transform).e).toBeCloseTo(-W * 0.25, 0);

    slow.dispose();
    await ending;
  });

  it('does not mount or navigate when disposed during capture', async () => {
    let resolveCapture!: (image: ArrayBuffer) => void;
    const deferredCapture = new Promise<ArrayBuffer>((resolve) => {
      resolveCapture = resolve;
    });
    const onCovered = vi.fn<NonNullable<CapturedTurnHost['onCovered']>>();
    const pending = new CapturedPageTurn({
      getHostElement: () => host,
      getContentRect: contentRect,
      capture: () => deferredCapture,
      onCovered,
      navigate,
    });

    const beginning = pending.beginDrag(true, false);
    await Promise.resolve();
    pending.dispose();
    resolveCapture(await makePngBuffer());

    await expect(beginning).resolves.toBe(false);
    expect(onCovered).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(host.querySelector('canvas')).toBeNull();
  });

  it('restores host state without navigating when disposed while covered', async () => {
    let releaseCovered!: () => void;
    const coveredGate = new Promise<void>((resolve) => {
      releaseCovered = resolve;
    });
    const onCovered = vi.fn<NonNullable<CapturedTurnHost['onCovered']>>(() => coveredGate);
    const onCancelled = vi.fn<NonNullable<CapturedTurnHost['onCancelled']>>();
    const pending = new CapturedPageTurn({
      getHostElement: () => host,
      getContentRect: contentRect,
      capture,
      onCovered,
      onCancelled,
      navigate,
    });

    const beginning = pending.beginDrag(true, false);
    await vi.waitFor(() => expect(onCovered).toHaveBeenCalledOnce());
    pending.dispose();
    releaseCovered();

    await expect(beginning).resolves.toBe(false);
    expect(onCancelled).toHaveBeenCalledWith('curl');
    expect(navigate).not.toHaveBeenCalled();
    expect(host.querySelector('canvas')).toBeNull();
  });

  it('still removes the overlay when disposal restoration throws synchronously', async () => {
    const pending = new CapturedPageTurn({
      getHostElement: () => host,
      getContentRect: contentRect,
      capture,
      onCancelled: () => {
        throw new Error('restore failed');
      },
      navigate,
    });

    expect(await pending.beginDrag(true, false)).toBe(true);
    expect(() => pending.dispose()).not.toThrow();
    expect(pending.active).toBe(false);
    expect(host.querySelector('canvas')).toBeNull();
  });
});
