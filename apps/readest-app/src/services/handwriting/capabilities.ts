export type PenBackend = 'boox' | 'pointer' | 'none';

export interface PenCapabilities {
  isBoox: boolean;
  backend: PenBackend;
  pressure: boolean;
  eraser: boolean;
}

export interface NativePenInfo {
  isBoox: boolean;
  /** True only when the BOOX Pen SDK is present and raw drawing can start. */
  rawDrawing: boolean;
}

export interface CapabilityProbes {
  /** Null on platforms without the native bridge (web, desktop, iOS). */
  queryNative: (() => Promise<NativePenInfo>) | null;
  hasPointerEvents: boolean;
}

/**
 * The single place that decides which pen backend is usable. BOOX detection
 * lives in the native layer; nothing else in the app inspects device models.
 * Any probe failure degrades to the generic pointer backend.
 */
export const detectPenCapabilities = async (probes: CapabilityProbes): Promise<PenCapabilities> => {
  let native: NativePenInfo | null = null;
  if (probes.queryNative) {
    try {
      native = await probes.queryNative();
    } catch {
      native = null;
    }
  }
  const isBoox = native?.isBoox ?? false;
  if (native?.rawDrawing) return { isBoox, backend: 'boox', pressure: true, eraser: true };
  if (probes.hasPointerEvents) return { isBoox, backend: 'pointer', pressure: true, eraser: true };
  return { isBoox, backend: 'none', pressure: false, eraser: false };
};
