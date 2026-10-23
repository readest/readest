import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

const h = vi.hoisted(() => ({
  view: {
    getCFI: vi.fn(() => 'cfi'),
    renderer: { containerPosition: 0, scrollLocked: false },
  },
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { isAndroidApp: false, isMobile: false } }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => h.view,
    getViewSettings: () => ({ scrolled: true }),
    getProgress: () => null,
  }),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getBookData: () => ({ isFixedLayout: false }) }),
}));
vi.mock('@/utils/event', () => ({
  eventDispatcher: { onSync: vi.fn(), offSync: vi.fn(), on: vi.fn(), off: vi.fn() },
}));
vi.mock('@/app/reader/hooks/useInstantAnnotation', () => ({
  useInstantAnnotation: () => ({
    isInstantAnnotationEnabled: () => false,
    handleInstantAnnotationPointerDown: vi.fn(),
    handleInstantAnnotationPointerMove: vi.fn(),
    handleInstantAnnotationPointerCancel: vi.fn(),
    handleInstantAnnotationPointerUp: vi.fn(),
    reapplyInstantAnnotation: vi.fn(),
    cancelInstantAnnotation: vi.fn(),
  }),
}));
vi.mock('@/utils/misc', async (importActual) => {
  const actual = await importActual<typeof import('@/utils/misc')>();
  return { ...actual, getOSPlatform: () => 'macos' };
});

import { useTextSelector } from '@/app/reader/hooks/useTextSelector';
import type { TextSelection } from '@/utils/sel';

const setup = () => {
  const setSelection = vi.fn();
  const noop = vi.fn();
  const { result } = renderHook(() =>
    useTextSelector(
      'book-1',
      { top: 0, right: 0, bottom: 0, left: 0 },
      setSelection,
      noop,
      noop,
      vi.fn(async (range: Range) => range.toString()),
      noop,
    ),
  );
  return { result, setSelection };
};

const mouse = (type: string) =>
  ({ type, pointerType: 'mouse', button: 0, clientX: 500, clientY: 500 }) as PointerEvent;

const select = (node: Text, start: number, end: number) => {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  Object.assign(range, { getClientRects: () => [] });
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
};

beforeEach(() => {
  document.body.innerHTML = '<p>First sentence. Second sentence.</p>';
  document.getSelection()?.removeAllRanges();
});

afterEach(() => {
  cleanup();
  document.getSelection()?.removeAllRanges();
  document.body.innerHTML = '';
});

describe('mouse selection released away from the text (#6958)', () => {
  test('opens the toolbar for a new selection after scrolling during the drag', async () => {
    const { result, setSelection } = setup();
    const node = document.querySelector('p')!.firstChild as Text;
    result.current.handlePointerDown(document, 0, mouse('pointerdown'));
    select(node, 0, 14);

    await result.current.handlePointerUp(document, 0, mouse('pointerup'));

    expect(setSelection).toHaveBeenCalledOnce();
    expect((setSelection.mock.calls[0]![0] as TextSelection).text).toBe('First sentence');
  });

  test('does not reopen an unchanged selection when the release is elsewhere', async () => {
    const { result, setSelection } = setup();
    const node = document.querySelector('p')!.firstChild as Text;
    select(node, 0, 14);
    result.current.handlePointerDown(document, 0, mouse('pointerdown'));

    await result.current.handlePointerUp(document, 0, mouse('pointerup'));

    expect(setSelection).not.toHaveBeenCalled();
  });

  test('opens the toolbar when an existing selection is extended', async () => {
    const { result, setSelection } = setup();
    const node = document.querySelector('p')!.firstChild as Text;
    select(node, 0, 5);
    result.current.handlePointerDown(document, 0, mouse('pointerdown'));
    select(node, 0, 14);

    await result.current.handlePointerUp(document, 0, mouse('pointerup'));

    expect(setSelection).toHaveBeenCalledOnce();
    expect((setSelection.mock.calls[0]![0] as TextSelection).text).toBe('First sentence');
  });
});
