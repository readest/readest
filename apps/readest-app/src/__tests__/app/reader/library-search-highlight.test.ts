import { afterEach, describe, expect, it, vi } from 'vitest';

import { showTransientSearchHighlight } from '@/app/reader/utils/searchHighlight';

afterEach(() => {
  vi.useRealTimers();
});

describe('showTransientSearchHighlight', () => {
  it('highlights one CFI and clears it after four seconds', async () => {
    vi.useFakeTimers();
    const search = vi.fn(async function* () {
      yield 'done' as const;
    });
    const clearSearch = vi.fn();

    await showTransientSearchHighlight({ search, clearSearch }, 'epubcfi(/6/2!/4/2:1)');

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        results: [expect.objectContaining({ cfi: 'epubcfi(/6/2!/4/2:1)' })],
      }),
    );
    expect(clearSearch).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(4000);
    expect(clearSearch).toHaveBeenCalledOnce();
  });
});
