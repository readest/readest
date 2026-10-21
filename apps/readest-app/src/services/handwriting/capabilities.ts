export type PenBackend = 'boox' | 'pointer' | 'none';

export interface CapabilityProbes {
  /** Null outside the Android app, where there is no native pen bridge. */
  queryNative: (() => Promise<{ rawDrawing: boolean }>) | null;
  hasPointerEvents: boolean;
}

/**
 * The single place that picks a pen backend. BOOX detection lives in the
 * native layer; any probe failure degrades to pointer events.
 */
export const detectPenBackend = async (probes: CapabilityProbes): Promise<PenBackend> => {
  try {
    if ((await probes.queryNative?.())?.rawDrawing) return 'boox';
  } catch {
    // fall through to pointer events
  }
  return probes.hasPointerEvents ? 'pointer' : 'none';
};
