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
    expect(invoke).toHaveBeenCalledWith(
      'clip_url',
      expect.objectContaining({
        options: expect.objectContaining({ backgroundCapture: true }),
      }),
    );
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

it('cancels promptly while keeping native captures serialized until cleanup', async () => {
  let finish!: (html: string) => void;
  invoke.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  invoke.mockResolvedValueOnce('<html>next chapter</html>');
  const controller = new AbortController();
  const first = renderNovelPage('https://example.org/1', controller.signal);
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  const cancelled = expect(first).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await cancelled;
  const next = renderNovelPage('https://example.org/2');
  await Promise.resolve();
  expect(invoke).toHaveBeenCalledTimes(1);
  finish('<html>cancelled chapter</html>');
  await next;
  expect(invoke).toHaveBeenCalledTimes(2);
});

it.each([
  'http://127.0.0.1/chapter',
  'http://localhost./chapter',
  'http://[::ffff:7f00:1]/chapter',
  'http://[::127.0.0.1]/chapter',
  'http://[fec0::1]/chapter',
  'http://[ff02::1]/chapter',
])('rejects private capture targets without opening a native view: %s', async (url) => {
  await expect(renderNovelPage(url)).rejects.toThrow('private');
  expect(invoke).not.toHaveBeenCalled();
});
