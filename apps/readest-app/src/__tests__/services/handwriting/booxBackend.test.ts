import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { BooxHandwritingBackend } from '@/services/handwriting/booxBackend';
import { HandwritingEditor } from '@/services/handwriting/editor';
import { HandwritingService } from '@/services/handwriting/handwritingService';

// The BOOX backend reaches native code through the Tauri bridge; stub the
// whole module so no test needs a device or the Tauri runtime.
const startRawDrawing = vi.fn(async (_request?: unknown) => {});
const stopRawDrawing = vi.fn(async () => {});
const setRawDrawingEnabled = vi.fn(async (_enabled?: unknown) => {});

vi.mock('@/utils/bridge', () => ({
  queryPenCapabilities: vi.fn(async () => ({ isBoox: true, rawDrawing: true })),
  startRawDrawing: (request: unknown) => startRawDrawing(request),
  stopRawDrawing: () => stopRawDrawing(),
  setRawDrawingEnabled: (enabled: unknown) => setRawDrawingEnabled(enabled),
}));

vi.mock('@tauri-apps/api/core', () => ({
  addPluginListener: vi.fn(async () => ({ unregister: vi.fn() })),
}));

const rect = { left: 0, top: 0, width: 400, height: 800 };
const region = { left: 0, top: 0, width: 400, height: 800 };

// HandwritingService only offers the native probe when the Tauri IPC bridge
// is present on window; jsdom has none, so the BOOX branch is unreachable
// without this. Removed in afterEach so the pointer-path tests still see it
// absent.
const withIpc = () => {
  Object.defineProperty(window, 'ipc', { value: {}, configurable: true });
};
const withoutIpc = () => {
  Reflect.deleteProperty(window, 'ipc' as unknown as keyof Window);
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  withoutIpc();
});

describe('BooxHandwritingBackend.updatePen', () => {
  it('re-issues startRawDrawing with the new width and color', async () => {
    const backend = new BooxHandwritingBackend();
    const toPage = (x: number, y: number): [number, number] => [x, y];

    await backend.start(region, toPage, 1.6, '#1a1a1a');
    expect(startRawDrawing).toHaveBeenCalledTimes(1);

    await backend.updatePen(6.4, '#1f6feb');
    expect(startRawDrawing).toHaveBeenCalledTimes(2);
    expect(startRawDrawing).toHaveBeenLastCalledWith({
      ...region,
      strokeWidth: 6.4,
      strokeColor: '#1f6feb',
    });
  });

  it('keeps the original region across a pen update', async () => {
    const backend = new BooxHandwritingBackend();
    await backend.start(region, (x, y) => [x, y], 1.6, '#1a1a1a');
    await backend.updatePen(3.2, '#15803d');
    expect(startRawDrawing).toHaveBeenLastCalledWith({
      left: 0,
      top: 0,
      width: 400,
      height: 800,
      strokeWidth: 3.2,
      strokeColor: '#15803d',
    });
  });

  it('does nothing before start, so a pen change cannot start native drawing', async () => {
    const backend = new BooxHandwritingBackend();
    await backend.updatePen(3.2, '#15803d');
    expect(startRawDrawing).not.toHaveBeenCalled();
  });

  it('drops the stored region on stop so a later update is inert', async () => {
    const backend = new BooxHandwritingBackend();
    await backend.start(region, (x, y) => [x, y], 1.6, '#1a1a1a');
    await backend.stop();
    startRawDrawing.mockClear();

    await backend.updatePen(3.2, '#15803d');
    expect(startRawDrawing).not.toHaveBeenCalled();
  });

  it('re-registers no listener on update', async () => {
    const { addPluginListener } = await import('@tauri-apps/api/core');
    const backend = new BooxHandwritingBackend();
    await backend.start(region, (x, y) => [x, y], 1.6, '#1a1a1a');
    await backend.updatePen(3.2, '#15803d');
    await backend.updatePen(6.4, '#9333ea');
    // One subscription for the session; each color tap must not add another.
    expect(addPluginListener).toHaveBeenCalledTimes(1);
  });
});

describe('HandwritingService pen changes on the BOOX path', () => {
  it('pushes a pen change to the native pen while drawing', async () => {
    withIpc();
    const service = new HandwritingService(new HandwritingEditor(), 'pdf:1', rect, {
      color: '#1a1a1a',
      widthFraction: 0.004,
    });
    await service.attach(document.createElement('div'));
    startRawDrawing.mockClear();

    service.setOptions({ color: '#c2410c', widthFraction: 0.008 });

    // widthFraction is normalized, so it reaches native in pixels.
    expect(startRawDrawing).toHaveBeenCalledWith({
      ...region,
      strokeWidth: 0.008 * rect.width,
      strokeColor: '#c2410c',
    });
  });

  it('swallows a native failure rather than breaking the pen session', async () => {
    withIpc();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const service = new HandwritingService(new HandwritingEditor(), 'pdf:1', rect);
    await service.attach(document.createElement('div'));

    startRawDrawing.mockRejectedValueOnce(new Error('bridge down'));
    service.setOptions({ color: '#1f6feb' });

    // The rejection is handled asynchronously; give the microtask a turn.
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('leaves the pointer path alone, since it reads options per stroke', async () => {
    const service = new HandwritingService(new HandwritingEditor(), 'pdf:1', rect);
    await service.attach(document.createElement('div'));
    startRawDrawing.mockClear();

    service.setOptions({ color: '#15803d' });
    expect(startRawDrawing).not.toHaveBeenCalled();
  });
});
