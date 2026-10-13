import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

// The bridge probe is faked with a small state machine so we can drive the four
// outcomes the hook must distinguish: already-settled (seed), a definitive
// resolve, an inconclusive rejection that later recovers, and one that never
// recovers (bounded give-up).
const s = vi.hoisted(() => ({
  settled: null as boolean | null,
  probeCount: 0,
  inconclusiveProbes: 0,
  finalValue: false,
}));

vi.mock('@/utils/bridge', () => ({
  checkEinkRefreshSupported: vi.fn(() => {
    s.probeCount++;
    if (s.probeCount <= s.inconclusiveProbes) {
      // Inconclusive: resolves (never rejects at this seam) but leaves the
      // settled cache null, so the hook must schedule a retry.
      return Promise.resolve(false);
    }
    s.settled = s.finalValue;
    return Promise.resolve(s.finalValue);
  }),
  getCachedEinkRefreshSupported: vi.fn(() => s.settled),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { isMobileApp: true, isAndroidApp: true } }),
}));

import { useEinkRefreshSupported } from '@/hooks/useEinkRefreshSupported';

// Flush the pending `.then(...)` microtask(s) after a render or a timer tick.
const flush = () => act(async () => {});
const tick = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });

beforeEach(() => {
  s.settled = null;
  s.probeCount = 0;
  s.inconclusiveProbes = 0;
  s.finalValue = false;
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useEinkRefreshSupported', () => {
  test('seeds from an already-settled probe without re-querying the bridge', async () => {
    s.settled = true;
    const { result } = renderHook(() => useEinkRefreshSupported());
    await flush();
    expect(result.current).toBe(true);
    expect(s.probeCount).toBe(0);
  });

  test('probes when unset and reports support when the device has a hook', async () => {
    s.finalValue = true;
    const { result } = renderHook(() => useEinkRefreshSupported());
    expect(result.current).toBe(false); // hidden until the probe settles
    await flush();
    expect(result.current).toBe(true);
    expect(s.probeCount).toBe(1);
  });

  test('reports unsupported on a definitive negative without retrying', async () => {
    s.finalValue = false;
    const { result } = renderHook(() => useEinkRefreshSupported());
    await flush();
    expect(result.current).toBe(false);
    expect(s.probeCount).toBe(1); // settled false is final — no timer scheduled
  });

  test('retries an inconclusive first probe and recovers when it later resolves', async () => {
    s.inconclusiveProbes = 1; // only the first probe is inconclusive
    s.finalValue = true;
    const { result } = renderHook(() => useEinkRefreshSupported());
    await flush();
    expect(result.current).toBe(false); // still unknown after the rejected probe
    expect(s.probeCount).toBe(1);
    await tick();
    expect(result.current).toBe(true); // recovered on the retry
    expect(s.probeCount).toBe(2);
  });

  test('gives up and stays hidden when the probe never settles', async () => {
    s.inconclusiveProbes = 999; // always inconclusive
    const { result } = renderHook(() => useEinkRefreshSupported());
    await flush();
    await tick();
    await tick();
    await tick();
    await flush();
    expect(result.current).toBe(false);
    // One initial probe plus the bounded retries, then it stops.
    expect(s.probeCount).toBe(4);
  });
});
