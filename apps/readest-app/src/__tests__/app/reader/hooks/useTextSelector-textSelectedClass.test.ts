import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

// Links get an enlarged tap target: an empty a::before box spreading 10px
// around them. It also swallowed the text next to a link, so dragging a
// selection onto the character beside a footnote marker made it jump (#6566).
// While the section document holds a text selection, it carries a class that
// takes that box out of hit testing.

const h = vi.hoisted(() => ({
  view: {
    renderer: { containerPosition: 0, scrollLocked: false, getContents: () => [] },
    getCFI: () => 'epubcfi(/6/2!/4/2/1:0)',
  },
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { isIOSApp: true, isMobile: true } }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => h.view,
    getViewSettings: () => ({ scrolled: false }),
    getProgress: () => null,
  }),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getBookData: () => ({ isFixedLayout: false }) }),
}));
vi.mock('@/utils/event', () => ({
  eventDispatcher: { onSync: vi.fn(), offSync: vi.fn(), on: vi.fn(), off: vi.fn() },
}));
vi.mock('@/utils/bridge', () => ({
  setSelectionSuppressed: vi.fn(async () => {}),
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
  return { ...actual, getOSPlatform: () => 'ios' };
});

import { useTextSelector } from '@/app/reader/hooks/useTextSelector';
import { TEXT_SELECTED_CLASS } from '@/utils/style';

const setup = () => {
  const noop = vi.fn();
  return renderHook(() =>
    useTextSelector(
      'book-1',
      { top: 0, right: 0, bottom: 0, left: 0 },
      noop,
      noop,
      noop,
      vi.fn(async (range: Range) => range.toString()),
      noop,
    ),
  );
};

const makeDoc = () => {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.body.innerHTML =
    '<p>This is the book of the <a href="#n1"><sup>1a</sup>generations</a> of Adam.</p>';
  return doc;
};

const hasClass = (doc: Document) => doc.documentElement.classList.contains(TEXT_SELECTED_CLASS);

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('text selected class', () => {
  test('is set while the document holds a selection and lifted when it collapses', () => {
    const { result } = setup();
    const doc = makeDoc();
    const sel = doc.getSelection()!;
    sel.selectAllChildren(doc.querySelector('p')!);
    result.current.handleSelectionchange(doc, 0);
    expect(hasClass(doc)).toBe(true);

    sel.collapseToEnd();
    result.current.handleSelectionchange(doc, 0);
    expect(hasClass(doc)).toBe(false);
  });

  test('tolerates a document that has no selection', () => {
    const { result } = setup();
    const doc = makeDoc();
    vi.spyOn(doc, 'getSelection').mockReturnValue(null);
    expect(() => result.current.handleSelectionchange(doc, 0)).not.toThrow();
    expect(hasClass(doc)).toBe(false);
  });
});
