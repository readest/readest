/**
 * @vitest-environment node
 *
 * Desktop/folder import opens TXT via NativeFile/RemoteFile: File subclasses
 * constructed with an empty blob whose bytes come from overridden
 * arrayBuffer()/stream()/slice(). Worker.postMessage uses the structured
 * clone algorithm (MDN), which copies the underlying Blob/File bytes — not
 * subclass methods. So posting such a handle to the TXT worker yields an
 * empty File in the worker.
 *
 * That is why importBook must not route path-opened ClosableFiles through
 * convertTxtToEpubWithFallback without first materializing a real Blob
 * (and why #3320's worker helper was never wired into bookService).
 *
 * Uses the Node environment because jsdom's structuredClone does not
 * round-trip File/Blob the way browsers and WKWebView workers do; the
 * empty-backing-store property is what matters for NativeFile/RemoteFile.
 */
import { describe, it, expect } from 'vitest';
describe('TXT worker transport vs ClosableFile-shaped Files', () => {
  it('structuredClone of an empty-backed File subclass drops the readable bytes', async () => {
    class EmptyBackedFile extends File {
      #bytes: ArrayBuffer;
      constructor(bytes: ArrayBuffer, name: string) {
        super([], name, { type: 'text/plain' });
        this.#bytes = bytes;
      }
      override async arrayBuffer() {
        return this.#bytes.slice(0);
      }
      override get size() {
        return this.#bytes.byteLength;
      }
    }

    const payload = new TextEncoder().encode('第一章\n正文');
    const source = new EmptyBackedFile(payload.buffer, 'novel.txt');
    expect(source.size).toBe(payload.byteLength);
    expect((await source.arrayBuffer()).byteLength).toBe(payload.byteLength);

    const cloned = structuredClone(source);
    expect(cloned).toBeInstanceOf(File);
    expect(cloned.size).toBe(0);
    expect((await cloned.arrayBuffer()).byteLength).toBe(0);
  });

  it('structuredClone preserves bytes for a normal Blob-backed File', async () => {
    const payload = new TextEncoder().encode('第一章\n正文');
    const source = new File([payload], 'novel.txt', { type: 'text/plain' });
    const cloned = structuredClone(source);
    expect(cloned.size).toBe(payload.byteLength);
    expect(new TextDecoder().decode(await cloned.arrayBuffer())).toBe('第一章\n正文');
  });
});
