/**
 * #6160 - a highlight imported from ReadEra did nothing when tapped.
 *
 * The show-annotation listener is registered once per view, so the book
 * progress it closes over is whatever it was when the view mounted: null until
 * the first relocate. It fell back to that progress for the popup's page
 * whenever the tapped note carried none, and imported notes never do, so the
 * listener threw before it raised the popup and the tap fell through to the
 * page-turn / toolbar handling instead.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
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
    enableAnnotationQuickActions: false,
    annotationQuickAction: '' as string,
    keepSelectionAfterLookup: false,
  },
  saveConfig: vi.fn(),
  updateBooknotes: vi.fn(),
  deselect: vi.fn(),
  restoreSelectionRange: vi.fn(() => true),
  isTextSelected: { current: true },
  progress: null as null | { page: number },
  handleUpToPopup: vi.fn(),
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
    getView: () => ({ deselect: h.deselect, getCFI: () => 'epubcfi(/6/2!/4/2)' }),
    getViewsById: () => [],
    getViewSettings: () => h.viewSettings,
  };
  return {
    useReaderStore: (selector?: (value: typeof state) => unknown) =>
      selector ? selector(state) : state,
  };
});

vi.mock('@/store/readerProgressStore', () => ({
  getBookProgress: () => h.progress,
  useBookProgress: () => h.progress,
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
vi.mock('@/app/reader/hooks/usePageboundSync', () => ({ usePageboundSync: () => {} }));
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
      handleUpToPopup: h.handleUpToPopup,
      handleContextmenu: vi.fn(),
      dragSelectionTo: vi.fn(),
      // The real hook republishes the selection with the flag set; the test
      // drives that step itself so it can assert what the effect does with it.
      suppressNativeSelectionHandles: vi.fn(),
      restoreSelectionRange: h.restoreSelectionRange,
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
import Annotator from '@/app/reader/components/annotator/Annotator';

const IMPORTED_CFI = 'epubcfi(/6/8!/4/2/2[chapter_458]/4/10,/1:4,/1:28)';

beforeEach(() => {
  h.foliateHandlers = null;
  h.progress = null;
  h.config.booknotes = [];
  vi.clearAllMocks();
});

afterEach(cleanup);

const tapAnnotation = (value: string) => {
  const range = document.createRange();
  act(() => {
    h.foliateHandlers?.['onShowAnnotation']?.(
      new CustomEvent('show-annotation', { detail: { value, index: 3, range } }),
    );
  });
};

describe('tapping a highlight that carries no page', () => {
  test('opens the highlight before the book has reported any progress', () => {
    h.config.booknotes = [
      {
        id: 'readera-54c686c7-2caa-40d6-bfe0-fb5f9f5ce48a',
        type: 'annotation',
        cfi: IMPORTED_CFI,
        text: 'rabbit-hole went straigh',
        note: '',
        style: 'highlight',
        color: 'yellow',
        page: null,
        createdAt: 1790778428873,
        updatedAt: 1790783309323,
      },
    ];
    render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);

    tapAnnotation(IMPORTED_CFI);

    expect(h.handleUpToPopup).toHaveBeenCalledTimes(1);
  });
});
