import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useNotebookDocumentStore } from '@/store/notebookDocumentStore';
import { eventDispatcher } from '@/utils/event';

const h = vi.hoisted(() => ({
  actions: null as null | Record<string, () => boolean>,
  config: { booknotes: [] as unknown[], viewSettings: {} },
  viewSettings: {
    annotationToolbarItems: [] as string[],
    noteExportConfig: {},
    copyToNotebook: false,
    rtl: false,
    vertical: false,
  },
  saveConfig: vi.fn(),
  updateBooknotes: vi.fn(),
  view: null as unknown,
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
      book: { format: 'EPUB', primaryLanguage: 'en' },
      bookDoc: { metadata: { language: 'en' } },
      isFixedLayout: false,
    }),
    updateBooknotes: h.updateBooknotes,
  };
  // Annotator reads this store with selectors; useSaveBooknoteNoteText
  // destructures it. Serve both call styles.
  return {
    useBookDataStore: (selector?: (value: typeof state) => unknown) =>
      selector ? selector(state) : state,
  };
});

vi.mock('@/store/readerStore', () => {
  const state = {
    getView: () => h.view,
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
  useSidebarStore: () => ({ clearBooknotesNav: vi.fn(), isSideBarVisible: false }),
}));

vi.mock('@/store/customDictionaryStore', () => ({
  useCustomDictionaryStore: () => ({
    loadCustomDictionaries: vi.fn().mockResolvedValue(undefined),
  }),
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
vi.mock('@/app/reader/hooks/useFoliateEvents', () => ({ useFoliateEvents: () => {} }));
vi.mock('@/app/reader/hooks/useRendererInputListeners', () => ({
  useRendererInputListeners: () => {},
}));

vi.mock('@/app/reader/hooks/useTextSelector', () => ({
  useTextSelector: () => ({
    isTextSelected: { current: false },
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
    suppressNativeSelectionHandles: vi.fn(),
    noteAutoTurnPoint: { current: null },
    cancelAutoTurn: vi.fn(),
    onAutoTurn: vi.fn(),
  }),
}));

vi.mock('@/services/transformService', () => ({
  transformContent: ({ content }: { content: string }) => Promise.resolve(content),
}));

vi.mock('@/app/reader/components/annotator/AnnotationRangeEditor', () => ({ default: () => null }));
vi.mock('@/app/reader/components/annotator/SelectionRangeEditor', () => ({ default: () => null }));
vi.mock('@/app/reader/components/annotator/AnnotationPopup', () => ({ default: () => null }));
vi.mock('@/app/reader/components/annotator/DictionaryPopup', () => ({ default: () => null }));
vi.mock('@/app/reader/components/annotator/DictionarySheet', () => ({ default: () => null }));
vi.mock('@/app/reader/components/annotator/TranslatorPopup', () => ({ default: () => null }));
vi.mock('@/app/reader/components/annotator/ProofreadPopup', () => ({ default: () => null }));
vi.mock('@/app/reader/components/annotator/ExportMarkdownDialog', () => ({ default: () => null }));
vi.mock('@/app/reader/components/annotator/ImportAnnotationsDialog', () => ({
  default: () => null,
}));

import Annotator from '@/app/reader/components/annotator/Annotator';

const selectPopupText = async (cfi?: string) => {
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
      cfi,
    });
  });
};

// A main-view (non-popup) selection, the state Ctrl/Cmd+R acts on. The
// `wordlens-dictionary` route is the one selection source that survives this
// harness's mocks -- `footnote-selection` always stamps `popup: true`, and
// `onReadAloudSelection` deliberately bails on popup ranges.
const selectMainViewText = async (text = 'the river rounded a steep shoulder of land') => {
  const paragraph = document.createElement('p');
  paragraph.textContent = text;
  document.body.append(paragraph);
  h.view = {
    renderer: {
      getContents: () => [{ doc: document, index: 0 }],
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getCFI: () => 'epubcfi(/6/2!/4/2)',
    deselect: vi.fn(),
  };
  await act(async () => {
    await eventDispatcher.dispatch('wordlens-dictionary', {
      bookKey: 'book-1',
      element: paragraph,
      word: text,
    });
  });
  return paragraph;
};

describe('Annotator popup shortcuts', () => {
  beforeEach(() => {
    h.actions = null;
    h.view = null;
    h.config.booknotes = [];
    h.viewSettings.copyToNotebook = false;
    h.updateBooknotes.mockImplementation(() => h.config);
    useNotebookDocumentStore.getState().reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  test.each([
    'onHighlightSelection',
    'onUnderlineSelection',
  ])('%s does not claim popup text without a CFI', async (action) => {
    render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
    await selectPopupText();

    let handled: boolean | undefined;
    act(() => {
      handled = h.actions?.[action]?.();
    });

    expect(handled).toBe(false);
    expect(h.updateBooknotes).not.toHaveBeenCalled();
  });

  test.each([
    'onHighlightSelection',
    'onUnderlineSelection',
  ])('%s still handles popup text with a CFI', async (action) => {
    render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
    await selectPopupText('epubcfi(/6/2!/4/2)');

    let handled: boolean | undefined;
    act(() => {
      handled = h.actions?.[action]?.();
    });

    expect(handled).toBe(true);
    expect(h.updateBooknotes).toHaveBeenCalledOnce();
  });

  // #5011: Ctrl/Cmd+R is documented as "Readest reads the selection and stops",
  // but the handler called handleSpeakText() without an argument, so `oneTime`
  // fell back to false. useTTSControl then took the startFromRange branch,
  // which begins at the top of the containing block and carries on through the
  // book -- reading from the start of the paragraph and past the selection.
  test('onReadAloudSelection speaks only the selection', async () => {
    render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
    await selectMainViewText();

    const speaks: { oneTime?: boolean; range?: Range }[] = [];
    const capture = (event: CustomEvent) => {
      speaks.push(event.detail);
    };
    eventDispatcher.on('tts-speak', capture);

    let handled: boolean | undefined;
    await act(async () => {
      handled = h.actions?.['onReadAloudSelection']?.();
    });
    eventDispatcher.off('tts-speak', capture);

    expect(handled).toBe(true);
    expect(speaks).toHaveLength(1);
    expect(speaks[0]!.oneTime).toBe(true);
  });

  test('stores copied excerpts without inserting them into the Notebook editor', async () => {
    h.viewSettings.copyToNotebook = true;
    useNotebookDocumentStore.getState().hydrate('book', '# Existing notes', null);
    render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
    await selectPopupText('epubcfi(/6/2!/4/2)');

    act(() => {
      h.actions?.['onCopySelection']?.();
    });

    expect(h.config.booknotes).toEqual([
      expect.objectContaining({ type: 'excerpt', text: 'selected text' }),
    ]);
    expect(useNotebookDocumentStore.getState().sessions['book']?.content).toBe('# Existing notes');
  });
});
