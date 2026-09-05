/**
 * When a lookup surface (dictionary / translator / proofread) may open, and when
 * it must stay shut.
 *
 * #6018 — the dictionary flashed open and vanished on Android.
 *
 * `handleDictionary` (and its translator / proofread siblings) calls
 * `suppressNativeSelectionHandles`, which takes the platform's selection
 * grabbers away by emptying the selection for a frame, re-adding the range,
 * and republishing the selection with `handlesSuppressed` set. That last step
 * hands the selection effect a brand-new object, which it read as a fresh
 * selection and answered with the annotation toolbar — closing the lookup
 * surface on the frame it opened.
 */

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { eventDispatcher } from '@/utils/event';
import type { TextSelection } from '@/utils/sel';

const h = vi.hoisted(() => ({
  actions: null as null | Record<string, () => boolean>,
  config: { booknotes: [] as unknown[], viewSettings: {} },
  viewSettings: {
    // A non-empty toolbar so the popup actually renders (Annotator suppresses
    // it entirely when there is nothing to show).
    annotationToolbarItems: ['copy'] as string[],
    noteExportConfig: {},
    copyToNotebook: false,
    rtl: false,
    vertical: false,
  },
  saveConfig: vi.fn(),
  updateBooknotes: vi.fn(),
  isTextSelected: { current: true },
  // Swapped per test: the fixed-layout branch of `onLoad` used to wire PDF-only
  // listeners, so a regression there is only visible with this on.
  book: { format: 'EPUB', isFixedLayout: false },
  // `onLoad` and friends, captured from the `useFoliateEvents` call so a test can
  // fire a section load and drive the listeners it registers on the section doc.
  foliateHandlers: null as null | Record<string, (event: Event) => void>,
  // Annotator's own `setSelection`, captured from the `useTextSelector` call
  // so a test can republish the selection exactly as the hook does.
  setSelection: null as
    | null
    | ((update: (prev: TextSelection | null) => TextSelection | null) => void),
}));

const settings = {
  globalReadSettings: {
    highlightStyle: 'highlight',
    highlightStyles: { highlight: 'yellow', underline: 'green', squiggly: 'blue' },
  },
};

vi.mock('@/hooks/useShortcuts', () => ({
  default: (actions: Record<string, () => boolean>) => {
    h.actions = actions;
  },
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: {} }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (value: number) => value,
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: Object.assign(
    () => ({
      settings,
      setSettingsDialogBookKey: vi.fn(),
      setSettingsDialogOpen: vi.fn(),
      setActiveSettingsItemId: vi.fn(),
    }),
    { getState: () => ({ settings }) },
  ),
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ isDarkMode: false }),
}));

vi.mock('@/store/bookDataStore', () => {
  const state = {
    getConfig: () => h.config,
    setConfig: vi.fn(),
    saveConfig: h.saveConfig,
    getBookData: () => ({
      book: { format: h.book.format, primaryLanguage: 'en' },
      bookDoc: { metadata: { language: 'en' } },
      isFixedLayout: h.book.isFixedLayout,
    }),
    updateBooknotes: h.updateBooknotes,
  };
  return {
    useBookDataStore: (selector?: (value: typeof state) => unknown) =>
      selector ? selector(state) : state,
  };
});

vi.mock('@/store/readerStore', () => {
  const state = {
    getView: () => ({ deselect: vi.fn(), getCFI: () => 'epubcfi(/6/2!/4/2)' }),
    getViewsById: () => [],
    getViewSettings: () => h.viewSettings,
  };
  return {
    useReaderStore: (selector?: (value: typeof state) => unknown) =>
      selector ? selector(state) : state,
  };
});

vi.mock('@/store/readerProgressStore', () => ({
  getBookProgress: () => ({ page: 1 }),
  useBookProgress: () => ({ page: 1, sectionHref: 'chapter.xhtml' }),
}));

vi.mock('@/store/notebookStore', () => ({
  useNotebookStore: () => ({
    setNotebookVisible: vi.fn(),
    setNotebookActiveTab: vi.fn(),
    setNotebookNewAnnotation: vi.fn(),
    setNotebookNewHighlightIds: vi.fn(),
  }),
}));

vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: () => ({
    clearBooknotesNav: vi.fn(),
    isSideBarVisible: false,
    setSideBarVisible: vi.fn(),
    setSearchBarVisible: vi.fn(),
  }),
}));

vi.mock('@/store/customDictionaryStore', () => ({
  useCustomDictionaryStore: Object.assign(
    () => ({ loadCustomDictionaries: vi.fn().mockResolvedValue(undefined) }),
    { getState: () => ({ settings: { providerEnabled: {} } }) },
  ),
}));

vi.mock('@/store/deviceStore', () => ({
  useDeviceControlStore: () => ({ listenToNativeTouchEvents: vi.fn() }),
}));

vi.mock('@/hooks/useFileSelector', () => ({
  useFileSelector: () => ({ selectFiles: vi.fn() }),
}));

vi.mock('@/app/reader/hooks/useNotesSync', () => ({ useNotesSync: () => {} }));
vi.mock('@/app/reader/hooks/useBookOrbitNotesSync', () => ({ useBookOrbitNotesSync: () => {} }));
vi.mock('@/app/reader/hooks/useReadwiseSync', () => ({ useReadwiseSync: () => {} }));
vi.mock('@/app/reader/hooks/useHardcoverSync', () => ({ useHardcoverSync: () => {} }));
vi.mock('@/app/reader/hooks/useNotionSync', () => ({ useNotionSync: () => {} }));
vi.mock('@/app/reader/hooks/useFoliateEvents', () => ({
  useFoliateEvents: (_view: unknown, handlers: Record<string, (event: Event) => void>) => {
    h.foliateHandlers = handlers;
  },
}));
vi.mock('@/app/reader/hooks/useRendererInputListeners', () => ({
  useRendererInputListeners: () => {},
}));

vi.mock('@/app/reader/hooks/useTextSelector', () => ({
  useTextSelector: (
    _bookKey: string,
    _contentInsets: unknown,
    setSelection: (update: (prev: TextSelection | null) => TextSelection | null) => void,
  ) => {
    h.setSelection = setSelection;
    return {
      isTextSelected: h.isTextSelected,
      isInstantAnnotating: { current: false },
      handleScroll: vi.fn(),
      handleTouchStart: vi.fn(),
      handleTouchMove: vi.fn(),
      handleTouchEnd: vi.fn(),
      handleMouseDown: vi.fn(),
      handlePointerDown: vi.fn(),
      handlePointerMove: vi.fn(),
      handleNativeTouchMove: vi.fn(),
      handlePointerCancel: vi.fn(),
      handlePointerUp: vi.fn(),
      handleDoubleClick: vi.fn(),
      handleSelectionchange: vi.fn(),
      handleShowPopup: vi.fn(),
      handleUpToPopup: vi.fn(),
      handleContextmenu: vi.fn(),
      dragSelectionTo: vi.fn(),
      // The real hook republishes the selection with the flag set; the test
      // drives that step itself so it can assert what the effect does with it.
      suppressNativeSelectionHandles: vi.fn(),
      noteAutoTurnPoint: { current: null },
      cancelAutoTurn: vi.fn(),
      onAutoTurn: vi.fn(),
    };
  },
}));

// jsdom lays nothing out, so the real popup positioning bails on a zero rect
// and no popup ever renders. Feed it fixed anchor points instead.
vi.mock('@/utils/sel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/sel')>();
  return {
    ...actual,
    getPosition: () => ({ point: { x: 120, y: 200 }, dir: 'up' as const }),
    getPopupPosition: () => ({ point: { x: 120, y: 140 }, dir: 'up' as const }),
  };
});

vi.mock('@/services/transformService', () => ({
  transformContent: ({ content }: { content: string }) => Promise.resolve(content),
}));

vi.mock('@/app/reader/components/annotator/AnnotationRangeEditor', () => ({ default: () => null }));
vi.mock('@/app/reader/components/annotator/SelectionRangeEditor', () => ({ default: () => null }));
vi.mock('@/app/reader/components/annotator/ExportMarkdownDialog', () => ({ default: () => null }));
vi.mock('@/app/reader/components/annotator/ImportAnnotationsDialog', () => ({
  default: () => null,
}));
vi.mock('@/app/reader/components/annotator/AnnotationPopup', () => ({
  default: () => <div data-testid='annotation-toolbar' />,
}));
vi.mock('@/app/reader/components/annotator/DictionaryPopup', () => ({
  default: () => <div data-testid='dictionary-surface' />,
}));
vi.mock('@/app/reader/components/annotator/DictionarySheet', () => ({
  default: () => <div data-testid='dictionary-surface' />,
}));
vi.mock('@/app/reader/components/annotator/TranslatorPopup', () => ({
  default: () => <div data-testid='translator-surface' />,
}));
vi.mock('@/app/reader/components/annotator/ProofreadPopup', () => ({
  default: () => <div data-testid='proofread-surface' />,
}));

import Annotator from '@/app/reader/components/annotator/Annotator';

const selectText = async () => {
  // The selection effect needs the book's grid cell to measure against.
  if (!document.querySelector('#gridcell-book-1')) {
    const gridCell = document.createElement('div');
    gridCell.id = 'gridcell-book-1';
    document.body.append(gridCell);
  }
  const paragraph = document.createElement('p');
  paragraph.textContent = 'selected text';
  document.body.append(paragraph);
  const range = document.createRange();
  range.selectNodeContents(paragraph);
  await act(async () => {
    await eventDispatcher.dispatch('footnote-selection', {
      key: 'book-1',
      range,
      index: 0,
      cfi: 'epubcfi(/6/2!/4/2)',
    });
  });
};

/** What `suppressNativeSelectionHandles` does once the range is back. */
const republishSelectionWithSuppressedHandles = async () => {
  await act(async () => {
    h.setSelection?.((prev) => (prev ? { ...prev, handlesSuppressed: true } : prev));
  });
};

beforeEach(() => {
  h.actions = null;
  h.book = { format: 'EPUB', isFixedLayout: false };
  h.foliateHandlers = null;
  h.config.booknotes = [];
  h.isTextSelected.current = true;
  h.setSelection = null;
  h.updateBooknotes.mockImplementation(() => h.config);
  vi.clearAllMocks();
});

afterEach(cleanup);

describe('a lookup surface survives the selection it is anchored to being republished', () => {
  test.each([
    ['onDictionarySelection', 'dictionary-surface'],
    ['onTranslateSelection', 'translator-surface'],
    ['onProofreadSelection', 'proofread-surface'],
  ])('%s stays open when the native handles are suppressed', async (action, testId) => {
    render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
    await selectText();

    act(() => {
      h.actions?.[action]?.();
    });
    expect(screen.getByTestId(testId)).toBeTruthy();

    await republishSelectionWithSuppressedHandles();

    expect(screen.queryByTestId(testId)).toBeTruthy();
    expect(screen.queryByTestId('annotation-toolbar')).toBeNull();
  });
});

/**
 * #5821 — every PDF word selection on Android opened the translator popup.
 *
 * Fixed-layout books used to wire their own `contextmenu` listener in `onLoad`
 * that forced the translator surface open, from back when PDFs had no annotation
 * toolbar of their own. Android dispatches `contextmenu` for the long press that
 * selects a word, so the shortcut fired on every selection and buried the word —
 * and the dictionary the reader had asked for — under an unrequested
 * translation. iOS never reproduced it: WebKit dispatches no `contextmenu` for a
 * long-press selection.
 */
describe('a context menu never opens a lookup surface by itself', () => {
  // The ambient jsdom document, because jsdom implements `getSelection` only on
  // the window's own document — a `createHTMLDocument` section doc has none, and
  // the handler under test bails on it before doing anything at all.
  const loadSection = async () => {
    const doc = document;
    const paragraph = doc.createElement('p');
    paragraph.textContent = 'selected text';
    doc.body.append(paragraph);
    await act(async () => {
      h.foliateHandlers?.['onLoad']?.(
        new CustomEvent('load', { detail: { doc, index: 0 } }) as Event,
      );
    });
    return { doc, paragraph };
  };

  test.each([
    ['a fixed-layout book', true, 'PDF'],
    ['a reflowable book', false, 'EPUB'],
  ])('%s answers a contextmenu with no translator', async (_label, isFixedLayout, format) => {
    h.book = { format, isFixedLayout };
    render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
    const { doc, paragraph } = await loadSection();

    const range = doc.createRange();
    range.selectNodeContents(paragraph);
    doc.getSelection()?.removeAllRanges();
    doc.getSelection()?.addRange(range);

    await act(async () => {
      paragraph.dispatchEvent(new Event('contextmenu', { bubbles: true, cancelable: true }));
    });

    expect(screen.queryByTestId('translator-surface')).toBeNull();
  });
});
