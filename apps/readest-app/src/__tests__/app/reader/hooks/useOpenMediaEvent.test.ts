import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

import { useOpenMediaEvent } from '@/app/reader/hooks/useIframeEvents';

const BOOK_KEY = 'book-1';
const data = {
  type: 'iframe-open-media',
  bookKey: BOOK_KEY,
  elementType: 'table',
  html: '<table>',
};

afterEach(() => {
  cleanup();
});

describe('useOpenMediaEvent', () => {
  // The reader's iframe handlers post from the app window itself; a message
  // from any other window must not open the viewer with markup it supplies.
  test('opens the table viewer for a message from the app window', () => {
    const onTable = vi.fn();
    renderHook(() => useOpenMediaEvent(BOOK_KEY, vi.fn(), onTable));
    window.dispatchEvent(new MessageEvent('message', { data, source: window }));
    expect(onTable).toHaveBeenCalledWith('<table>');
  });

  test('ignores the same message from another window', () => {
    const onTable = vi.fn();
    renderHook(() => useOpenMediaEvent(BOOK_KEY, vi.fn(), onTable));
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    window.dispatchEvent(new MessageEvent('message', { data, source: frame.contentWindow }));
    frame.remove();
    expect(onTable).not.toHaveBeenCalled();
  });
});
