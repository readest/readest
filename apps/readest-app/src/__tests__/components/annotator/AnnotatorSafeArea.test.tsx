// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import type { Position, Rect, TextSelection } from '@/utils/sel';

// The selection toolbar, like the footnote popup, is placed inside the cell's
// safe region on every phone, not only on iPhone Duo: off the Duo it opened
// under the Dynamic Island when the selection sat near the top (#7389).

const h = vi.hoisted(() => ({
  viewSettings: {
    annotationToolbarItems: ['copy'] as string[],
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
  setSelection: null as null | ((selection: TextSelection) => void),
  // The rects the toolbar is positioned against, and where it renders.
  rects: [] as Rect[],
  toolbar: null as null | Position,
}));

const settings = {
  globalReadSettings: {
    highlightStyle: 'highlight',
    highlightStyles: { highlight: 'yellow', underline: 'green', squiggly: 'blue' },
  },
};

vi.mock('@/hooks/useShortcuts', () => ({ default: () => {} }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { isMobile: true } }),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (value: string) => value }));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (value: number) => value }));
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
// An ordinary iPhone: not the Duo.
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({
    isDarkMode: false,
    isIPhoneDuo: false,
    themeCode: { bg: '#fff', fg: '#000', primary: '#00f' },
  }),
}));
vi.mock('@/store/bookDataStore', () => {
  const state = {
    getConfig: () => ({ booknotes: [], viewSettings: {} }),
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
vi.mock('@/app/reader/hooks/useBookOrbitNotesSync', () => ({ useBookOrbitNotesSync: () => {} }));
vi.mock('@/app/reader/hooks/useGrimmoryNotesSync', () => ({ useGrimmoryNotesSync: () => {} }));
vi.mock('@/app/reader/hooks/useReadwiseSync', () => ({ useReadwiseSync: () => {} }));
vi.mock('@/app/reader/hooks/useHardcoverSync', () => ({ useHardcoverSync: () => {} }));
vi.mock('@/app/reader/hooks/usePageboundSync', () => ({ usePageboundSync: () => {} }));
vi.mock('@/app/reader/hooks/useNotionSync', () => ({ useNotionSync: () => {} }));
vi.mock('@/app/reader/hooks/useFoliateEvents', () => ({ useFoliateEvents: () => {} }));
vi.mock('@/app/reader/hooks/useRendererInputListeners', () => ({
  useRendererInputListeners: () => {},
}));
vi.mock('@/app/reader/hooks/useTextSelector', () => ({
  useTextSelector: (_key: string, _insets: unknown, setSelection: (s: TextSelection) => void) => {
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

// happy-dom lays nothing out, so feed the positioning fixed points relative to
// the rect it is given, and record that rect.
vi.mock('@/utils/sel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/sel')>();
  return {
    ...actual,
    getPosition: (_target: unknown, rect: Rect) => {
      h.rects.push(rect);
      return { point: { x: 120, y: 200 }, dir: 'up' as const };
    },
    getPopupPosition: () => ({ point: { x: 120, y: 140 }, dir: 'up' as const }),
  };
});

vi.mock('@/services/transformService', () => ({
  transformContent: ({ content }: { content: string }) => Promise.resolve(content),
}));
vi.mock('@/app/reader/components/annotator/AnnotationRangeEditor', () => ({ default: () => null }));
vi.mock('@/app/reader/components/annotator/SelectionRangeEditor', () => ({ default: () => null }));
vi.mock('@/app/reader/components/annotator/AnnotationPopup', () => ({
  default: ({ position }: { position: Position }) => {
    h.toolbar = position;
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

afterEach(() => {
  cleanup();
  document.getElementById('gridcell-book-1')?.remove();
  h.rects = [];
  h.toolbar = null;
});

test('places the selection toolbar inside the safe area off the Duo', () => {
  // A 393x852 phone cell with the Dynamic Island's 59px and the home
  // indicator's 34px insets.
  const gridCell = document.createElement('div');
  gridCell.id = 'gridcell-book-1';
  gridCell.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 393, bottom: 852, width: 393, height: 852 }) as DOMRect;
  document.body.appendChild(gridCell);
  render(
    <Annotator
      bookKey='book-1'
      contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }}
      gridInsets={{ top: 59, right: 0, bottom: 34, left: 0 }}
    />,
  );
  const doc = document.implementation.createHTMLDocument('page');
  doc.body.innerHTML = '<p>a passage</p>';
  const range = doc.createRange();
  range.selectNodeContents(doc.body.firstChild!);
  act(() =>
    h.setSelection!({
      key: 'book-1',
      text: 'a passage',
      page: 1,
      range,
      index: 2,
      cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:9)',
    }),
  );

  expect(h.rects.at(-1)).toEqual({ left: 0, top: 59, right: 393, bottom: 818 });
  // Placed relative to the safe region, then shifted back to cell coordinates.
  expect(h.toolbar?.point).toEqual({ x: 120, y: 140 + 59 });
});
