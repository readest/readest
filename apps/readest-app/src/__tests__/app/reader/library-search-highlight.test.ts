import { afterEach, describe, expect, it, vi } from 'vitest';
import { Overlayer } from 'foliate-js/overlayer.js';

import { showTransientSearchHighlight } from '@/app/reader/utils/searchHighlight';

afterEach(() => {
  vi.useRealTimers();
});

describe('showTransientSearchHighlight', () => {
  it('highlights the clicked sentence and clears it after four seconds', async () => {
    vi.useFakeTimers();
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML = '<p>Before. Professor\nQuirrell! After.</p>';
    const text = doc.querySelector('p')!.firstChild!;
    const range = doc.createRange();
    range.setStart(text, 18);
    range.setEnd(text, 26);
    const overlayer = { add: vi.fn(), remove: vi.fn() };

    await showTransientSearchHighlight(
      {
        resolveNavigation: vi.fn(() => ({ index: 0, anchor: () => range })),
        renderer: { getContents: () => [{ index: 0, doc, overlayer }] },
      } as never,
      'epubcfi(/6/2!/4/2:1)',
    );

    expect(overlayer.add).toHaveBeenCalledWith(
      'library-search-highlight',
      expect.any(Range),
      Overlayer.highlight,
      { color: '#808080' },
    );
    expect(overlayer.add.mock.calls[0]?.[1].toString()).toBe('Professor\nQuirrell!');

    await vi.advanceTimersByTimeAsync(4000);
    expect(overlayer.remove).toHaveBeenCalledWith('library-search-highlight');
  });
});
