import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

// #8045: on iOS the system menu (Copy, Look Up, Share) was kept off every
// non-editable selection, so text in the Notebook's Dictionary tab could be
// selected but never copied. It is let through for text the app shows, and
// kept off where Readest shows its own selection toolbar.

const h = vi.hoisted(() => ({
  appService: { isIOSApp: true } as { isIOSApp: boolean },
  setSelectionSuppressed: vi.fn(async (_req: { target: string; suppressed: boolean }) => {}),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: h.appService }),
}));
vi.mock('@/utils/bridge', () => ({
  setSelectionSuppressed: h.setSelectionSuppressed,
}));

import { useSystemSelectionMenu } from '@/hooks/useSystemSelectionMenu';

const select = (selector: string) => {
  document.getSelection()!.selectAllChildren(document.querySelector(selector)!);
  document.dispatchEvent(new Event('selectionchange'));
};

const collapse = () => {
  document.getSelection()!.collapseToEnd();
  document.dispatchEvent(new Event('selectionchange'));
};

const lastMenuRequest = () => h.setSelectionSuppressed.mock.calls.at(-1)?.[0];

beforeEach(() => {
  h.appService = { isIOSApp: true };
  h.setSelectionSuppressed.mockClear();
  document.body.innerHTML = `
    <div class="select-text"><p id="definition">an investigation</p></div>
    <div class="footnote-popup"><p id="footnote">a note</p></div>
    <div class="paragraph-content"><p id="clone">a paragraph</p></div>`;
});

afterEach(() => {
  cleanup();
  document.getSelection()?.removeAllRanges();
  document.body.innerHTML = '';
});

describe('useSystemSelectionMenu', () => {
  test('lets the system menu through while app text is selected, and not after', () => {
    renderHook(() => useSystemSelectionMenu());

    select('#definition');
    expect(lastMenuRequest()).toEqual({ target: 'menu', suppressed: false });

    collapse();
    expect(lastMenuRequest()).toEqual({ target: 'menu', suppressed: true });
  });

  test('keeps it off text that shows Readest’s own selection toolbar', () => {
    renderHook(() => useSystemSelectionMenu());

    select('#definition');
    select('#footnote');
    expect(lastMenuRequest()).toEqual({ target: 'menu', suppressed: true });

    select('#definition');
    select('#clone');
    expect(lastMenuRequest()).toEqual({ target: 'menu', suppressed: true });
  });

  test('does nothing outside the iOS app', () => {
    h.appService = { isIOSApp: false };
    renderHook(() => useSystemSelectionMenu());

    select('#definition');
    expect(h.setSelectionSuppressed).not.toHaveBeenCalled();
  });
});
