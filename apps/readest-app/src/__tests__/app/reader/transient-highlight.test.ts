import { afterEach, describe, expect, it, vi } from 'vitest';
import { Overlayer } from 'foliate-js/overlayer.js';

import { showTransientHighlight } from '@/app/reader/utils/transientHighlight';

afterEach(() => {
  vi.useRealTimers();
});

describe('showTransientHighlight', () => {
  it('highlights the clicked sentence and clears it after four seconds', async () => {
    vi.useFakeTimers();
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML = '<p>Before. Professor\nQuirrell! After.</p>';
    const text = doc.querySelector('p')!.firstChild!;
    const range = doc.createRange();
    range.setStart(text, 18);
    range.setEnd(text, 26);
    const overlayer = { add: vi.fn(), remove: vi.fn() };

    await showTransientHighlight(
      {
        resolveNavigation: vi.fn(() => ({ index: 0, anchor: () => range })),
        renderer: { getContents: () => [{ index: 0, doc, overlayer }] },
      } as never,
      'epubcfi(/6/2!/4/2:1)',
    );

    expect(overlayer.add).toHaveBeenCalledWith(
      'transient-highlight',
      expect.any(Range),
      Overlayer.highlight,
      { color: '#808080' },
    );
    expect(overlayer.add.mock.calls[0]?.[1].toString()).toBe('Professor\nQuirrell!');

    await vi.advanceTimersByTimeAsync(4000);
    expect(overlayer.remove).toHaveBeenCalledWith('transient-highlight');
  });

  it('highlights the footnote block when the href anchor resolves to an element', async () => {
    vi.useFakeTimers();
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML = '<p id="fn1">1. The footnote text.</p>';
    const overlayer = { add: vi.fn(), remove: vi.fn() };

    await showTransientHighlight(
      {
        resolveNavigation: vi.fn(() => ({ index: 0, anchor: () => doc.getElementById('fn1') })),
        renderer: { getContents: () => [{ index: 0, doc, overlayer }] },
      } as never,
      'chapter.xhtml#fn1',
    );

    expect(overlayer.add).toHaveBeenCalledWith(
      'transient-highlight',
      expect.any(Range),
      Overlayer.highlight,
      { color: '#808080' },
    );
    expect(overlayer.add.mock.calls[0]?.[1].toString()).toBe('1. The footnote text.');

    await vi.advanceTimersByTimeAsync(4000);
    expect(overlayer.remove).toHaveBeenCalledWith('transient-highlight');
  });

  it('highlights the enclosing block when the anchor is an inline marker', async () => {
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML = '<p><a id="fn2"></a>Second footnote.</p>';
    const overlayer = { add: vi.fn(), remove: vi.fn() };

    await showTransientHighlight(
      {
        resolveNavigation: vi.fn(() => ({ index: 0, anchor: () => doc.getElementById('fn2') })),
        renderer: { getContents: () => [{ index: 0, doc, overlayer }] },
      } as never,
      'chapter.xhtml#fn2',
    );

    expect(overlayer.add.mock.calls[0]?.[1].toString()).toBe('Second footnote.');
  });

  it('falls back to the parent when the anchor element has no text', async () => {
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML =
      '<table><tbody><tr><td><a id="fn3"></a>Note in a cell.</td></tr></tbody></table>';
    const overlayer = { add: vi.fn(), remove: vi.fn() };

    await showTransientHighlight(
      {
        resolveNavigation: vi.fn(() => ({ index: 0, anchor: () => doc.getElementById('fn3') })),
        renderer: { getContents: () => [{ index: 0, doc, overlayer }] },
      } as never,
      'chapter.xhtml#fn3',
    );

    expect(overlayer.add.mock.calls[0]?.[1].toString()).toBe('Note in a cell.');
  });

  it('does nothing for section-only hrefs with no anchor element', async () => {
    const doc = document.implementation.createHTMLDocument();
    const overlayer = { add: vi.fn(), remove: vi.fn() };

    await showTransientHighlight(
      {
        resolveNavigation: vi.fn(() => ({ index: 0, anchor: () => 0 })),
        renderer: { getContents: () => [{ index: 0, doc, overlayer }] },
      } as never,
      'chapter.xhtml',
    );

    expect(overlayer.add).not.toHaveBeenCalled();
  });
});
