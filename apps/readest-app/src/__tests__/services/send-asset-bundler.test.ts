import { describe, expect, test, beforeEach, vi, afterEach } from 'vitest';
import { bundleAssets } from '@/services/send/conversion/assetBundler';

// A tiny 1×1 transparent PNG so the bundler has real bytes to hash.
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

function pngResponse(): Response {
  return new Response(PNG, {
    status: 200,
    headers: { 'content-type': 'image/png' },
  });
}

describe('bundleAssets', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => pngResponse());
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  test('resolves data-src lazy-loading attrs', async () => {
    // Some sites ship `<img data-src="..." src="">` and lazy-load on
    // scroll. The bundler must pick up `data-src` rather than the empty
    // `src`.
    const html = `<p>hello</p><img data-src="https://cdn.example.com/lazy.png" alt="cover">`;
    const result = await bundleAssets(html, 'https://example.com/article');

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://cdn.example.com/lazy.png',
      expect.objectContaining({ redirect: 'follow' }),
    );
    expect(result.images).toHaveLength(1);
    expect(result.images[0]!.mime).toBe('image/png');
    expect(result.html).toContain('src="images/');
    expect(result.html).not.toContain('data-src');
    expect(result.missing).toBe(0);
  });

  test('prefers srcset over data-* lazy attrs (modern lazy-loading sites)', async () => {
    // Medium / Substack / NYT put the real responsive image in srcset and
    // leave src/data-src as a tiny placeholder. srcset wins.
    const html = `<img data-original="https://cdn.example.com/placeholder.png" srcset="https://cdn.example.com/2x.png 2x">`;
    const result = await bundleAssets(html, 'https://example.com');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://cdn.example.com/2x.png',
      expect.objectContaining({ redirect: 'follow' }),
    );
    expect(result.images).toHaveLength(1);
  });

  test('picks the largest-resolution variant from a srcset (not the first)', async () => {
    const html = `<img srcset="https://cdn.example.com/sm.png 480w, https://cdn.example.com/lg.png 1024w">`;
    const result = await bundleAssets(html, 'https://example.com');
    // 1024w wins over 480w — full quality in the EPUB, not the thumbnail.
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://cdn.example.com/lg.png',
      expect.objectContaining({ redirect: 'follow' }),
    );
    expect(result.images).toHaveLength(1);
  });

  test('prefers srcset over a tiny placeholder in src', async () => {
    // Real-world Medium shape: src is a 60-pixel-wide LQIP for lazy
    // loading; srcset has the real responsive variants.
    const html = `<img src="https://cdn.example.com/lqip-60.jpg" srcset="https://cdn.example.com/v-700.jpg 700w, https://cdn.example.com/v-1400.jpg 1400w">`;
    const result = await bundleAssets(html, 'https://example.com');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://cdn.example.com/v-1400.jpg',
      expect.objectContaining({ redirect: 'follow' }),
    );
    expect(result.images).toHaveLength(1);
  });

  test('dedupes the same URL referenced twice', async () => {
    const html = `
      <img src="https://cdn.example.com/hero.png">
      <p>some text</p>
      <img src="https://cdn.example.com/hero.png">
    `;
    const result = await bundleAssets(html, 'https://example.com');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.images).toHaveLength(1);
  });

  test('drops <iframe> / <video> / <audio> / <embed> / <object>', async () => {
    const html = `
      <p>article</p>
      <iframe src="https://example.com/embed"></iframe>
      <video src="https://example.com/v.mp4"></video>
      <audio src="https://example.com/a.mp3"></audio>
      <embed src="https://example.com/e.swf">
      <object data="https://example.com/o.pdf"></object>
    `;
    const result = await bundleAssets(html, 'https://example.com');
    expect(result.html).not.toMatch(/<iframe|<video|<audio|<embed|<object/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('keeps inline <svg> in place without fetching', async () => {
    const html = `<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="red"/></svg>`;
    const result = await bundleAssets(html, 'https://example.com');
    expect(result.html).toContain('<svg');
    expect(result.html).toContain('<rect');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('flattens <picture> to a single <img> pointing at the chosen source', async () => {
    const html = `
      <picture>
        <source srcset="https://cdn.example.com/x.webp" type="image/webp">
        <img src="https://cdn.example.com/x.jpg" alt="hero">
      </picture>
    `;
    const result = await bundleAssets(html, 'https://example.com');
    // The webp source wins because it's first.
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://cdn.example.com/x.webp',
      expect.objectContaining({ redirect: 'follow' }),
    );
    expect(result.html).not.toContain('<picture');
    expect(result.html).toContain('<img');
    expect(result.html).toContain('alt="hero"');
  });

  test('counts a 404 as missing, leaves the <img> with no src so alt-text shows', async () => {
    fetchSpy.mockImplementationOnce(async () => new Response('not found', { status: 404 }));
    const html = `<img src="https://cdn.example.com/gone.png" alt="missing">`;
    const result = await bundleAssets(html, 'https://example.com');
    expect(result.missing).toBe(1);
    expect(result.images).toHaveLength(0);
    expect(result.html).not.toMatch(/src="https/);
    expect(result.html).toContain('alt="missing"');
  });

  test('resolves relative URLs against the page URL', async () => {
    const html = `<img src="/imgs/local.png">`;
    await bundleAssets(html, 'https://news.example.com/articles/123');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://news.example.com/imgs/local.png',
      expect.objectContaining({ redirect: 'follow' }),
    );
  });

  test('strips loading/decoding/fetchpriority and srcset noise from kept <img>', async () => {
    const html = `<img src="https://cdn.example.com/a.png" loading="lazy" decoding="async" fetchpriority="low" srcset="https://cdn.example.com/2x.png 2x">`;
    const result = await bundleAssets(html, 'https://example.com');
    expect(result.html).not.toMatch(/loading|decoding|fetchpriority|srcset/);
  });

  test('drops 1×1 tracking pixels without fetching', async () => {
    const html = `<img src="https://tracker.example.com/p.gif" width="1" height="1">`;
    const result = await bundleAssets(html, 'https://example.com');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.images).toHaveLength(0);
  });
});
