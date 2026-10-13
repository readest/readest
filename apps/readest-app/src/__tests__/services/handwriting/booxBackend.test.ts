import { describe, it, expect, vi, beforeEach } from 'vitest';

import { BooxHandwritingBackend } from '@/services/handwriting/booxBackend';
import { HandwritingEditor } from '@/services/handwriting/editor';
import { HandwritingService } from '@/services/handwriting/handwritingService';
import type { PenStrokeBatch } from '@/utils/bridge';

// The BOOX backend reaches native code through the Tauri bridge; stub the
// whole module so no test needs a device or the Tauri runtime.
const h = vi.hoisted(() => ({
  startRawDrawing: vi.fn(async (_request?: unknown) => {}),
  stopRawDrawing: vi.fn(async () => {}),
  addPluginListener: vi.fn(),
  onPenBatch: null as ((batch: PenStrokeBatch) => void) | null,
  android: true,
}));

vi.mock('@/utils/bridge', () => ({
  queryPenCapabilities: vi.fn(async () => ({ isBoox: true, rawDrawing: true })),
  startRawDrawing: (request: unknown) => h.startRawDrawing(request),
  stopRawDrawing: () => h.stopRawDrawing(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  addPluginListener: (_plugin: string, _event: string, cb: (batch: PenStrokeBatch) => void) => {
    h.addPluginListener();
    h.onPenBatch = cb;
    return Promise.resolve({ unregister: vi.fn() });
  },
}));

// The native probe is only offered inside the Android app.
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => h.android }));
vi.mock('@/utils/misc', () => ({ getOSPlatform: () => (h.android ? 'android' : 'unknown') }));

const rect = { left: 0, top: 0, width: 400, height: 800 };

beforeEach(() => {
  vi.clearAllMocks();
  h.onPenBatch = null;
  h.android = true;
});

describe('BooxHandwritingBackend', () => {
  it('re-issues startRawDrawing with the new region and pen', async () => {
    const backend = new BooxHandwritingBackend();
    await backend.start(rect, (x, y) => [x, y], 1.6, '#1a1a1a');
    const moved = { left: 10, top: 20, width: 300, height: 600 };
    await backend.update(moved, 6.4, '#1f6feb');
    expect(h.startRawDrawing).toHaveBeenCalledTimes(2);
    expect(h.startRawDrawing).toHaveBeenLastCalledWith({
      ...moved,
      strokeWidth: 6.4,
      strokeColor: '#1f6feb',
    });
  });

  it('does nothing before start or after stop', async () => {
    const backend = new BooxHandwritingBackend();
    await backend.update(rect, 3.2, '#15803d');
    await backend.start(rect, (x, y) => [x, y], 1.6, '#1a1a1a');
    await backend.stop();
    h.startRawDrawing.mockClear();
    await backend.update(rect, 3.2, '#15803d');
    expect(h.startRawDrawing).not.toHaveBeenCalled();
  });

  it('subscribes to pen batches once per session', async () => {
    const backend = new BooxHandwritingBackend();
    await backend.start(rect, (x, y) => [x, y], 1.6, '#1a1a1a');
    await backend.update(rect, 3.2, '#15803d');
    await backend.update(rect, 6.4, '#9333ea');
    expect(h.addPluginListener).toHaveBeenCalledTimes(1);
  });
});

describe('HandwritingService on the BOOX path', () => {
  const attach = async (editor = new HandwritingEditor()) => {
    const service = new HandwritingService(editor, 'page:1', rect, {
      color: '#1a1a1a',
      widthFraction: 0.004,
    });
    await service.attach(document.createElement('div'));
    return service;
  };

  it('commits a whole native stroke, normalized to the page', async () => {
    const editor = new HandwritingEditor();
    await attach(editor);
    h.onPenBatch!({
      kind: 'DRAW_END',
      points: [
        { x: 0, y: 0, pressure: 0.5 },
        { x: 200, y: 400, pressure: 0 },
      ],
    });
    expect(editor.strokes('page:1')[0]!.points).toEqual([
      [0, 0, 0.5],
      [0.5, 0.5],
    ]);
  });

  it('pushes a pen change to the native pen, in CSS px', async () => {
    const service = await attach();
    h.startRawDrawing.mockClear();
    service.setOptions({ color: '#c2410c', widthFraction: 0.008 });
    expect(h.startRawDrawing).toHaveBeenCalledWith({
      ...rect,
      strokeWidth: 0.008 * rect.width,
      strokeColor: '#c2410c',
    });
  });

  it('follows the page when its bounds change', async () => {
    const service = await attach();
    const zoomed = { left: -100, top: -50, width: 800, height: 1600 };
    service.updateRect(zoomed);
    expect(h.startRawDrawing).toHaveBeenLastCalledWith(expect.objectContaining(zoomed));
  });

  it('swallows a native failure rather than breaking the pen session', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const service = await attach();
    h.startRawDrawing.mockRejectedValueOnce(new Error('bridge down'));
    service.setOptions({ color: '#1f6feb' });
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('uses pointer events outside the Android app', async () => {
    h.android = false;
    const service = await attach();
    service.setOptions({ color: '#15803d' });
    expect(h.startRawDrawing).not.toHaveBeenCalled();
  });
});
