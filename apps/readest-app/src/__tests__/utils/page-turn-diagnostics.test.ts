import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  document.getElementById('page-turn-diagnostics')?.remove();
});

describe('page turn diagnostic build', () => {
  it('does not add UI or frame callbacks in normal builds', async () => {
    vi.stubEnv('NEXT_PUBLIC_PAGE_CURL_DIAGNOSTICS', undefined);
    vi.resetModules();
    const { measurePageTurn } = await import('@/app/reader/utils/pageTurnDiagnostics');
    expect(measurePageTurn(0, true)).toBeNull();
    expect(document.getElementById('page-turn-diagnostics')).toBeNull();
  });

  it('separates first motion delay from continuous RAF intervals', async () => {
    vi.stubEnv('NEXT_PUBLIC_PAGE_CURL_DIAGNOSTICS', '1');
    vi.resetModules();
    let frame!: FrameRequestCallback;
    let frameId = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frame = callback;
      return ++frameId;
    });
    const cancel = vi.fn();
    vi.stubGlobal('cancelAnimationFrame', cancel);
    vi.spyOn(performance, 'now').mockReturnValue(120);
    const { measurePageTurn } = await import('@/app/reader/utils/pageTurnDiagnostics');
    const measurement = measurePageTurn(20, true)!;
    measurement.draw(0);
    frame(80); // idle wait is not a moving frame
    measurement.draw(0.2);
    frame(128);
    frame(144);
    frame(194);
    measurement.endMotion();
    measurement.finish();
    const text = document.getElementById('page-turn-diagnostics')!.textContent;
    expect(text).toContain('готовые листы');
    expect(text).toContain('До движения: 100 мс');
    expect(text).toContain('p95 50');
    expect(text).toContain('макс 50 мс');
    expect(cancel).toHaveBeenCalledWith(frameId);
  });
});
