import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdir, putFile, putFileBinary } from '@/services/sync/providers/webdav/client';
const config = { serverUrl: 'https://dav.example.com', username: 'test', password: 'test' };
const writes = [
  () => mkdir(config, '/Readest/books/h1'),
  () => putFile(config, '/Readest/library.json', '{}'),
  () => putFileBinary(config, '/Readest/books/h1/book.epub', new ArrayBuffer(8)),
];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
test.each(writes)('retries transient write failures with backoff', async (write) => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response('', { status: 503 }))
    .mockRejectedValueOnce(new TypeError('Network failed'))
    .mockResolvedValue(new Response('', { status: 201 }));
  vi.stubGlobal('fetch', fetch);
  const pending = write();
  const result = expect(pending).resolves.toBeUndefined();
  await vi.advanceTimersByTimeAsync(0);
  expect(fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(250);
  expect(fetch).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(500);
  await result;
  expect(fetch).toHaveBeenCalledTimes(3);
});
test('surfaces the final status after exhausting retries', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('', { status: 503 }));
  vi.stubGlobal('fetch', fetch);
  const result = expect(mkdir(config, '/Readest')).rejects.toMatchObject({ status: 503 });
  await vi.runAllTimersAsync();
  await result;
  expect(fetch).toHaveBeenCalledTimes(3);
});
test.each([401, 403, 409, 507])('does not retry permanent HTTP %s errors', async (status) => {
  const fetch = vi.fn().mockResolvedValue(new Response('', { status }));
  vi.stubGlobal('fetch', fetch);
  await expect(putFile(config, '/Readest/library.json', '{}')).rejects.toMatchObject({ status });
  expect(fetch).toHaveBeenCalledTimes(1);
});
