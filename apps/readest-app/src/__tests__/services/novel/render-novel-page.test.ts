import { beforeEach, describe, expect, it, vi } from 'vitest';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@/services/send/clipOptions', () => ({ getClipOptions: () => ({}) }));
import { renderNovelPage } from '@/services/novel/renderNovelPage';
beforeEach(() => {
  invoke.mockReset();
});

describe('rendered chapters', () => {
  it('serializes native capture and preserves navigation', async () => {
    let finish!: (html: string) => void;
    invoke.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    invoke.mockResolvedValueOnce('<html><body>second</body></html>');
    const first = renderNovelPage('https://example.org/1');
    const second = renderNovelPage('https://example.org/2');
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    finish('<html data-readest-url="https://example.org/private/1"><body>signed in</body></html>');
    expect((await first).finalUrl).toBe('https://example.org/private/1');
    expect((await second).finalUrl).toBe('https://example.org/2');
  });

  it('maps native cancellation and skips queued cancelled captures', async () => {
    invoke.mockRejectedValueOnce('Capture cancelled');
    await expect(renderNovelPage('https://example.org/1')).rejects.toMatchObject({
      name: 'AbortError',
    });
    await expect(
      renderNovelPage('https://example.org/2', AbortSignal.abort()),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
