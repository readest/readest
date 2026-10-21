import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

// On Android, wry injects Tauri's init scripts into every frame, so each book
// page iframe runs its own @sentry/browser. It wraps listeners passed to that
// page's addEventListener and caches the wrapper on the function itself, so a
// function attached to two pages runs through the first page's wrapper on
// both. Once that page unloads, the browser stops calling its wrapper, and the
// listener on every later page goes silent (the image long-press menu on PDF
// pages never opened). Each page must get its own listener.

const h = vi.hoisted(() => ({
  appService: { isAndroidApp: true, isMobile: true },
  config: { booknotes: [], viewSettings: {} },
  viewSettings: {
    annotationToolbarItems: [] as string[],
    noteExportConfig: {},
    copyToNotebook: false,
    rtl: false,
    vertical: false,
  },
  onLoad: null as null | ((event: Event) => void),
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
    getView: () => null,
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

type Page = { doc: Document; unload: () => void };

// A page document whose addEventListener behaves like Sentry's in that page:
// the wrapper is cached on the listener, and it only runs while its page lives.
const createPage = (): Page => {
  const doc = document.implementation.createHTMLDocument('page');
  let alive = true;
  const native = doc.addEventListener.bind(doc);
  type Wrapped = EventListener & { __wrapped__?: EventListener };
  doc.addEventListener = (type: string, listener: unknown, options?: unknown) => {
    const fn = listener as Wrapped;
    fn.__wrapped__ ??= (event: Event) => {
      if (alive) fn(event);
    };
    native(type, fn.__wrapped__, options as AddEventListenerOptions);
  };
  return { doc, unload: () => (alive = false) };
};

const loadPage = (page: Page, index: number) =>
  act(() => {
    h.onLoad!(new CustomEvent('load', { detail: { doc: page.doc, index } }));
  });

describe('Annotator page listeners', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test('keep firing on a page after the first loaded page unloads', () => {
    render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
    const first = createPage();
    const second = createPage();
    loadPage(first, 0);
    loadPage(second, 1);
    first.unload();

    second.doc.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    second.doc.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    second.doc.dispatchEvent(new Event('touchstart', { bubbles: true }));

    expect(h.handleContextmenu).toHaveBeenCalledTimes(1);
    expect(h.handleMouseDown).toHaveBeenCalledTimes(1);
    expect(h.handleTouchStart).toHaveBeenCalledTimes(1);
  });
});
