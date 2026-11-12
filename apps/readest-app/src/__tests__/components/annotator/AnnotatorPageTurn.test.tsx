// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { clearBookProgress, setBookProgress, useBookProgress } from '@/store/readerProgressStore';
import type { BookProgress } from '@/types/book';
import type { TextSelection } from '@/utils/sel';

// A page turn writes the book's progress. Annotator draws the new page's highlights and the sync
// hooks that push the reading position follow it, but Annotator itself, with its popups and
// toolbars, must not re-render on each turn.

const h = vi.hoisted(() => ({
  appService: {
    isAndroidApp: true,
    isMobile: true,
    getCoverImageBlobUrl: () => new Promise<string>((resolve) => (h.cover = resolve)),
  },
  config: {
    booknotes: [
      {
        id: 'a1',
        type: 'annotation',
        cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:5)',
        style: 'highlight',
        color: 'yellow',
        text: 'hello',
        note: '',
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    viewSettings: {},
  },
  viewSettings: {
    annotationToolbarItems: ['quotecard'] as string[],
    noteExportConfig: {},
    copyToNotebook: false,
    rtl: false,
    vertical: false,
  },
  view: {
    addAnnotation: vi.fn(),
    deselect: () => {},
    getCFI: () => 'epubcfi(/6/4!/4/2,/1:0,/1:9)',
    addEventListener: () => {},
    removeEventListener: () => {},
    renderer: { getContents: () => [], addEventListener: () => {}, removeEventListener: () => {} },
  },
  renders: 0,
  followers: 0,
  setSelection: null as null | ((selection: TextSelection) => void),
  buttons: [] as { tooltipText: string; onClick: () => void }[],
  quoteCard: null as null | { chapter?: string },
  cover: null as null | ((url: string) => void),
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
  useThemeStore: () => ({
    isDarkMode: false,
    themeCode: { bg: '#fff', fg: '#000', primary: '#00f' },
  }),
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
    getView: () => h.view,
    getViewsById: () => [],
    getViewSettings: () => h.viewSettings,
  };
  return {
    useReaderStore: (selector?: (value: typeof state) => unknown) =>
      selector ? selector(state) : state,
  };
});

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
vi.mock('@/app/reader/hooks/useBookOrbitNotesSync', () => ({
  useBookOrbitNotesSync: (key: string) => {
    h.followers++;
    useBookProgress(key);
  },
}));
vi.mock('@/app/reader/hooks/useGrimmoryNotesSync', () => ({
  useGrimmoryNotesSync: (key: string) => {
    h.followers++;
    useBookProgress(key);
  },
}));
vi.mock('@/app/reader/hooks/useReadwiseSync', () => ({ useReadwiseSync: () => {} }));
vi.mock('@/app/reader/hooks/useHardcoverSync', () => ({
  useHardcoverSync: (key: string) => {
    h.followers++;
    useBookProgress(key);
  },
}));
vi.mock('@/app/reader/hooks/usePageboundSync', () => ({
  usePageboundSync: (key: string) => {
    h.followers++;
    useBookProgress(key);
  },
}));
vi.mock('@/app/reader/hooks/useNotionSync', () => ({ useNotionSync: () => {} }));
vi.mock('@/app/reader/hooks/useFoliateEvents', () => ({ useFoliateEvents: () => {} }));
vi.mock('@/app/reader/hooks/useRendererInputListeners', () => ({
  useRendererInputListeners: () => {},
}));

vi.mock('@/app/reader/hooks/useTextSelector', () => ({
  useTextSelector: (_key: string, _insets: unknown, setSelection: (s: TextSelection) => void) => {
    h.renders++;
    h.setSelection = setSelection;
    return {
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
    };
  },
}));

// happy-dom lays nothing out, so the real popup positioning bails on a zero rect
// and the toolbar never renders. Feed it fixed anchor points instead.
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

vi.mock('@/utils/clipboard', () => ({
  writeTextToClipboard: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/app/reader/components/annotator/AnnotationRangeEditor', () => ({ default: () => null }));
vi.mock('@/app/reader/components/annotator/SelectionRangeEditor', () => ({ default: () => null }));
vi.mock('@/app/reader/components/annotator/AnnotationPopup', () => ({
  default: ({ buttons }: { buttons: typeof h.buttons }) => {
    h.buttons = buttons;
    return null;
  },
}));
vi.mock('@/app/reader/components/annotator/QuoteCardDialog', () => ({
  default: ({ content }: { content: { chapter?: string } }) => {
    h.quoteCard = content;
    return null;
  },
}));
vi.mock('@/app/reader/components/annotator/DictionaryPopup', () => ({ default: () => null }));
vi.mock('@/app/reader/components/annotator/DictionarySheet', () => ({ default: () => null }));
vi.mock('@/app/reader/components/annotator/TranslatorPopup', () => ({ default: () => null }));
vi.mock('@/app/reader/components/annotator/ProofreadPopup', () => ({ default: () => null }));
vi.mock('@/app/reader/components/annotator/ExportMarkdownDialog', () => ({ default: () => null }));
vi.mock('@/app/reader/components/annotator/ImportAnnotationsDialog', () => ({
  default: () => null,
}));

import Annotator from '@/app/reader/components/annotator/Annotator';

const turnTo = (location: string, page: number, sectionLabel = 'Chapter 2') =>
  act(() =>
    setBookProgress('book-1', {
      location,
      page,
      sectionHref: 'ch2.xhtml',
      sectionLabel,
    } as BookProgress),
  );

describe('Annotator on a page turn', () => {
  afterEach(() => {
    cleanup();
    clearBookProgress('book-1');
    vi.clearAllMocks();
  });

  test("draws the page's highlights without re-rendering itself", () => {
    turnTo('epubcfi(/6/2!/4,/2/1:0,/8/1:9)', 1);
    render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
    const { renders, followers } = h;
    h.view.addAnnotation.mockClear();

    turnTo('epubcfi(/6/4!/4,/2/1:0,/8/1:9)', 2);

    expect(h.view.addAnnotation).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }));
    expect(h.followers).toBeGreaterThan(followers);
    expect(h.renders).toBe(renders);
  });

  test('makes a quote card with the chapter of its passage, though the page turns meanwhile', async () => {
    turnTo('epubcfi(/6/4!/4,/2/1:0,/8/1:9)', 2, 'Chapter 2');
    const gridCell = document.createElement('div');
    gridCell.id = 'gridcell-book-1';
    document.body.appendChild(gridCell);
    render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
    const doc = document.implementation.createHTMLDocument('page');
    doc.body.innerHTML = '<p>a passage</p>';
    const range = doc.createRange();
    range.selectNodeContents(doc.body.firstChild!);
    act(() =>
      h.setSelection!({
        key: 'book-1',
        text: 'a passage',
        page: 2,
        range,
        index: 2,
        cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:9)',
      }),
    );
    const quote = h.buttons.find((b) => b.tooltipText === 'Quote Card');
    expect(quote).toBeDefined();

    act(() => quote!.onClick());
    // the page turns into the next chapter while the card loads the cover
    turnTo('epubcfi(/6/6!/4,/2/1:0,/8/1:9)', 3, 'Chapter 3');
    await act(async () => h.cover!('blob:cover'));

    expect(h.quoteCard?.chapter).toBe('Chapter 2');
    gridCell.remove();
  });
});
