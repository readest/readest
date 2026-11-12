// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// The reader mounts the annotator once the book's first page is on screen. The
// pages loaded by then (the one shown and the ones preloaded around it) had
// their `load` and `create-overlay` before its listeners were there, so it sets
// them up itself: selection on those pages and their highlights.

const h = vi.hoisted(() => ({
  appService: { isAndroidApp: true, isMobile: true },
  config: { booknotes: [] as object[], viewSettings: {} },
  viewSettings: {
    annotationToolbarItems: [] as string[],
    noteExportConfig: {},
    copyToNotebook: false,
    rtl: false,
    vertical: false,
  },
  onLoad: null as null | ((event: Event) => void),
  contents: [] as { doc: Document; index: number }[],
  addAnnotation: vi.fn(),
  handleTouchStart: vi.fn(),
  handleMouseDown: vi.fn(),
  handleContextmenu: vi.fn(),
}));

const settings = {
  globalReadSettings: {
    highlightStyle: 'highlight',
    highlightStyles: { highlight: 'yellow', underline: 'green', squiggly: 'blue' },
  },
};

vi.mock('@/hooks/useShortcuts', () => ({ default: () => {} }));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: h.appService }),
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
    saveConfig: vi.fn(),
    getBookData: () => ({
      book: { title: 'My Book', format: 'EPUB', primaryLanguage: 'en' },
      bookDoc: { metadata: { language: 'en' }, toc: [] },
      isFixedLayout: false,
    }),
    updateBooknotes: vi.fn(),
  };
  return {
    useBookDataStore: (selector?: (value: typeof state) => unknown) =>
      selector ? selector(state) : state,
  };
});

vi.mock('@/store/readerStore', () => {
  const state = {
    getView: () => ({
      renderer: {
        getContents: () => h.contents,
        addEventListener: () => {},
        removeEventListener: () => {},
      },
      addEventListener: () => {},
      removeEventListener: () => {},
      addAnnotation: h.addAnnotation,
    }),
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
vi.mock('@/app/reader/hooks/useGrimmoryNotesSync', () => ({ useGrimmoryNotesSync: () => {} }));
vi.mock('@/app/reader/hooks/useReadwiseSync', () => ({ useReadwiseSync: () => {} }));
vi.mock('@/app/reader/hooks/useHardcoverSync', () => ({ useHardcoverSync: () => {} }));
vi.mock('@/app/reader/hooks/usePageboundSync', () => ({ usePageboundSync: () => {} }));
vi.mock('@/app/reader/hooks/useNotionSync', () => ({ useNotionSync: () => {} }));
vi.mock('@/app/reader/hooks/useFoliateEvents', () => ({
  useFoliateEvents: (_view: unknown, handlers: { onLoad: (event: Event) => void }) => {
    h.onLoad = handlers.onLoad;
  },
}));
vi.mock('@/app/reader/hooks/useRendererInputListeners', () => ({
  useRendererInputListeners: () => {},
}));

vi.mock('@/app/reader/hooks/useTextSelector', () => ({
  useTextSelector: () => ({
    isTextSelected: { current: false },
    isInstantAnnotating: { current: false },
    handleScroll: vi.fn(),
    handleTouchStart: h.handleTouchStart,
    handleTouchMove: vi.fn(),
    handleTouchEnd: vi.fn(),
    handleMouseDown: h.handleMouseDown,
    handlePointerDown: vi.fn(),
    handlePointerMove: vi.fn(),
    handleNativeTouchMove: vi.fn(),
    handlePointerCancel: vi.fn(),
    handlePointerUp: vi.fn(),
    handleDoubleClick: vi.fn(),
    handleSelectionchange: vi.fn(),
    handleShowPopup: vi.fn(),
    handleUpToPopup: vi.fn(),
    handleContextmenu: h.handleContextmenu,
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

vi.mock('@/utils/clipboard', () => ({
  writeTextToClipboard: vi.fn().mockResolvedValue(true),
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

const highlight = (id: string, cfi: string) => ({
  id,
  type: 'annotation',
  cfi,
  style: 'highlight',
  color: 'yellow',
  text: 'text',
  note: '',
  createdAt: 1,
  updatedAt: 1,
});

const renderAnnotator = () =>
  render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);

describe('Annotator mounted after the first page', () => {
  beforeEach(() => {
    h.contents = [];
    h.config.booknotes = [];
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test('handles selection on the pages loaded before it mounted', () => {
    const shown = document.implementation.createHTMLDocument('shown');
    const preloaded = document.implementation.createHTMLDocument('preloaded');
    h.contents = [
      { doc: shown, index: 3 },
      { doc: preloaded, index: 4 },
    ];
    renderAnnotator();

    shown.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    preloaded.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(h.handleContextmenu).toHaveBeenCalledTimes(1);
    expect(h.handleMouseDown).toHaveBeenCalledTimes(1);
  });

  test('draws the highlights on the pages loaded before it mounted', () => {
    const onPage = highlight('a', 'epubcfi(/6/8!/4/2,/1:0,/1:4)');
    const elsewhere = highlight('b', 'epubcfi(/6/20!/4/2,/1:0,/1:4)');
    h.config.booknotes = [onPage, elsewhere];
    h.contents = [{ doc: document.implementation.createHTMLDocument('shown'), index: 3 }];
    renderAnnotator();

    expect(h.addAnnotation).toHaveBeenCalledWith(onPage);
    expect(h.addAnnotation).not.toHaveBeenCalledWith(elsewhere);
  });

  test('sets up a page loaded after it mounted once', () => {
    renderAnnotator();
    const page = document.implementation.createHTMLDocument('later');
    h.contents = [{ doc: page, index: 3 }];
    act(() => h.onLoad!(new CustomEvent('load', { detail: { doc: page, index: 3 } })));

    page.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));

    expect(h.handleContextmenu).toHaveBeenCalledTimes(1);
  });
});
