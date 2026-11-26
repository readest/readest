// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CachedImage, clearImageCache } from '@/components/CachedImage';
import { isWebAppPlatform } from '@/services/environment';

vi.mock('@/services/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/environment')>()),
  isWebAppPlatform: vi.fn(() => false),
}));

vi.mock('next/image', () => ({
  __esModule: true,
  default: ({ fill: _fill, ...props }: Record<string, unknown> & { fill?: boolean }) => {
    // biome-ignore lint/a11y/useAltText: test mock; alt comes from spread props
    return <img {...props} />;
  },
}));

const renderImage = (
  onGenerateCachedImageUrl: (url: string, cacheVersion?: string) => Promise<string>,
  cacheVersion?: string,
) =>
  render(
    <CachedImage
      src='https://catalog.example.com/cover/1'
      alt='Book cover'
      width={28}
      height={41}
      cacheVersion={cacheVersion}
      onGenerateCachedImageUrl={onGenerateCachedImageUrl}
    />,
  );

describe('CachedImage cache versioning (issue #5492)', () => {
  beforeEach(() => {
    cleanup();
    clearImageCache();
  });

  it('serves an unchanged URL and version from the cache', async () => {
    const generate = vi.fn(async (url: string) => `blob:${url}`);

    const { rerender } = renderImage(generate, '2024-01-01T00:00:00Z');
    await waitFor(() => {
      expect(screen.getByRole('img').getAttribute('src')).toBe(
        'blob:https://catalog.example.com/cover/1',
      );
    });

    rerender(
      <CachedImage
        src='https://catalog.example.com/cover/1'
        alt='Book cover'
        width={28}
        height={41}
        cacheVersion='2024-01-01T00:00:00Z'
        onGenerateCachedImageUrl={generate}
      />,
    );
    await waitFor(() => {
      expect(screen.getByRole('img').getAttribute('src')).toBe(
        'blob:https://catalog.example.com/cover/1',
      );
    });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('regenerates the image when the cache version changes at the same URL', async () => {
    // Simulates a server-side cover replacement: same URL, new Atom <updated>.
    const generate = vi.fn(
      async (url: string, cacheVersion?: string) => `blob:${url}#${cacheVersion ?? 'none'}`,
    );

    const { rerender } = renderImage(generate, '2024-01-01T00:00:00Z');
    await waitFor(() => {
      expect(screen.getByRole('img').getAttribute('src')).toBe(
        'blob:https://catalog.example.com/cover/1#2024-01-01T00:00:00Z',
      );
    });

    rerender(
      <CachedImage
        src='https://catalog.example.com/cover/1'
        alt='Book cover'
        width={28}
        height={41}
        cacheVersion='2025-06-01T00:00:00Z'
        onGenerateCachedImageUrl={generate}
      />,
    );
    await waitFor(() => {
      expect(screen.getByRole('img').getAttribute('src')).toBe(
        'blob:https://catalog.example.com/cover/1#2025-06-01T00:00:00Z',
      );
    });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate).toHaveBeenLastCalledWith(
      'https://catalog.example.com/cover/1',
      '2025-06-01T00:00:00Z',
    );
  });

  it('keeps caching by URL alone when no version is provided', async () => {
    const generate = vi.fn(async (url: string) => `blob:${url}`);

    const { rerender } = renderImage(generate);
    await waitFor(() => {
      expect(screen.getByRole('img').getAttribute('src')).toBe(
        'blob:https://catalog.example.com/cover/1',
      );
    });

    rerender(
      <CachedImage
        src='https://catalog.example.com/cover/1'
        alt='Book cover'
        width={28}
        height={41}
        onGenerateCachedImageUrl={generate}
      />,
    );
    await waitFor(() => {
      expect(screen.getByRole('img').getAttribute('src')).toBe(
        'blob:https://catalog.example.com/cover/1',
      );
    });
    expect(generate).toHaveBeenCalledTimes(1);
  });
});

describe('CachedImage on the web', () => {
  beforeEach(() => {
    cleanup();
    clearImageCache();
  });

  it.each([
    [true, 'https://standardebooks.org/ebooks/a/b/downloads/cover.jpg', 'anonymous'],
    [true, 'https://node.readest.com/api/opds/proxy?url=x&stream=true', 'anonymous'],
    [true, 'blob:https://web.readest.com/1', null],
    [false, 'https://standardebooks.org/ebooks/a/b/downloads/cover.jpg', null],
  ])('requests a cover in CORS mode only where the page is cross-origin isolated (web=%s, %s)', async (web, url, expected) => {
    // web.readest.com sends COEP: require-corp, which blocks a no-cors image
    // from another origin unless it carries CORP; a CORS request passes.
    vi.mocked(isWebAppPlatform).mockReturnValue(web);
    renderImage(async () => url);
    await waitFor(() => expect(screen.getByRole('img').getAttribute('src')).toBe(url));
    expect(screen.getByRole('img').getAttribute('crossorigin')).toBe(expected);
  });
});
