import { afterEach, describe, expect, it, vi } from 'vitest';

import { showTransientSearchHighlight } from '@/app/reader/utils/searchHighlight';

afterEach(() => {
  vi.useRealTimers();
});

describe('showTransientSearchHighlight', () => {
  it('highlights the clicked sentence and clears it after four seconds', async () => {
    vi.useFakeTimers();
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML = '<p>Before. Professor Quirrell! After.</p>';
    const text = doc.querySelector('p')!.firstChild!;
    const range = doc.createRange();
    range.setStart(text, 18);
    range.setEnd(text, 26);
    const search = vi.fn(async function* () {
      yield 'done' as const;
    });
    const clearSearch = vi.fn();
    const getCFI = vi.fn((_index: number, _sentence: Range) => 'sentence-cfi');

    await showTransientSearchHighlight(
      {
        search,
        clearSearch,
        getCFI,
        resolveNavigation: vi.fn(() => ({ index: 0, anchor: () => range })),
        renderer: { getContents: () => [{ index: 0, doc }] },
      } as never,
      'epubcfi(/6/2!/4/2:1)',
    );

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        results: [expect.objectContaining({ cfi: 'sentence-cfi' })],
      }),
    );
    expect(getCFI.mock.calls[0]?.[1].toString()).toBe('Professor Quirrell!');
    expect(clearSearch).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(4000);
    expect(clearSearch).toHaveBeenCalledOnce();
  });
});
