import { describe, it, expect } from 'vitest';
import { detectPenCapabilities } from '@/services/handwriting/capabilities';

describe('detectPenCapabilities', () => {
  it('reports BOOX raw drawing when the native SDK is available', async () => {
    const caps = await detectPenCapabilities({
      queryNative: async () => ({ isBoox: true, rawDrawing: true }),
      hasPointerEvents: true,
    });
    expect(caps).toEqual({ isBoox: true, backend: 'boox', pressure: true, eraser: true });
  });

  it('falls back to pointer events on a non-BOOX device', async () => {
    const caps = await detectPenCapabilities({
      queryNative: async () => ({ isBoox: false, rawDrawing: false }),
      hasPointerEvents: true,
    });
    expect(caps.backend).toBe('pointer');
    expect(caps.isBoox).toBe(false);
  });

  it('falls back to pointer events when the SDK is unavailable on a BOOX device', async () => {
    const caps = await detectPenCapabilities({
      queryNative: async () => ({ isBoox: true, rawDrawing: false }),
      hasPointerEvents: true,
    });
    expect(caps.backend).toBe('pointer');
    expect(caps.isBoox).toBe(true);
  });

  it('falls back to pointer events when the native query throws', async () => {
    const caps = await detectPenCapabilities({
      queryNative: async () => {
        throw new Error('plugin missing');
      },
      hasPointerEvents: true,
    });
    expect(caps.backend).toBe('pointer');
  });

  it('reports no backend without pointer events or native support', async () => {
    const caps = await detectPenCapabilities({ queryNative: null, hasPointerEvents: false });
    expect(caps.backend).toBe('none');
  });
});
