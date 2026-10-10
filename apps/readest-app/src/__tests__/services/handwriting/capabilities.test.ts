import { describe, it, expect } from 'vitest';
import { detectPenBackend } from '@/services/handwriting/capabilities';

describe('detectPenBackend', () => {
  it('uses BOOX raw drawing when the native SDK can drive it', async () => {
    const backend = await detectPenBackend({
      queryNative: async () => ({ rawDrawing: true }),
      hasPointerEvents: true,
    });
    expect(backend).toBe('boox');
  });

  it('falls back to pointer events when raw drawing is unavailable', async () => {
    // e.g. a pen-less BOOX reader, or a build without the BOOX flavor
    const backend = await detectPenBackend({
      queryNative: async () => ({ rawDrawing: false }),
      hasPointerEvents: true,
    });
    expect(backend).toBe('pointer');
  });

  it('falls back to pointer events when the native query throws', async () => {
    const backend = await detectPenBackend({
      queryNative: async () => {
        throw new Error('plugin missing');
      },
      hasPointerEvents: true,
    });
    expect(backend).toBe('pointer');
  });

  it('reports no backend without pointer events or native support', async () => {
    expect(await detectPenBackend({ queryNative: null, hasPointerEvents: false })).toBe('none');
  });
});
