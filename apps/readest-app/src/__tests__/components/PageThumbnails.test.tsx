import { render, fireEvent, act, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BookDoc } from '@/libs/document';
import { PageThumbnailsRow } from '@/app/reader/components/sidebar/PageThumbnails';
import * as pageThumbnails from '@/app/reader/utils/pageThumbnails';

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: {} }) }));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, opts?: { number: number }) =>
    key.replace('{{number}}', String(opts?.number)),
}));
vi.mock('@/app/reader/utils/pageThumbnails', () => ({
  getCachedPageThumbnail: vi.fn(() => 'blob:evicted'),
  loadPageThumbnail: vi.fn(async () => 'blob:reloaded'),
}));

const bookDoc = { rendition: {} } as unknown as BookDoc;

const renderRow = () =>
  render(
    <PageThumbnailsRow
      bookKey='hash-1'
      bookDoc={bookDoc}
      depth={0}
      pages={[4]}
      columns={3}
      onPageClick={() => {}}
    />,
  );

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('PageThumbnail', () => {
  // The memory cache revokes object URLs it evicts, so a mounted image whose
  // URL was revoked must fetch the thumbnail again rather than stay broken.
  it('reloads the thumbnail once when its image fails to load', async () => {
    vi.useFakeTimers();
    const { container } = renderRow();
    const img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('blob:evicted');

    fireEvent.error(img);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(pageThumbnails.loadPageThumbnail).toHaveBeenCalledTimes(1);
    expect(container.querySelector('img')!.getAttribute('src')).toBe('blob:reloaded');

    // A thumbnail that is broken for good doesn't retry forever.
    fireEvent.error(container.querySelector('img')!);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(pageThumbnails.loadPageThumbnail).toHaveBeenCalledTimes(1);
  });
});
