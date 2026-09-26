import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { NoteExportFormat } from '@/types/book';
import { eventDispatcher } from '@/utils/event';

type OnExport = (
  content: string,
  format: NoteExportFormat,
  options: { share: boolean; sharePosition?: { x: number; y: number } },
) => Promise<void> | void;

const h = vi.hoisted(() => ({
  appService: {
    isMacOSApp: true,
    saveFile: vi.fn().mockResolvedValue(true),
  },
  config: {
    booknotes: [
      {
        id: 'note-1',
        type: 'annotation',
        cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:5)',
        text: 'hello',
        note: '',
        style: 'highlight',
        color: 'yellow',
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    viewSettings: {},
  },
  viewSettings: {
    annotationToolbarItems: [] as string[],
    noteExportConfig: {},
    copyToNotebook: false,
    rtl: false,
    vertical: false,
  },
  onExport: null as null | OnExport,
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
vi.mock('@/app/reader/components/annotator/ExportMarkdownDialog', () => ({
  // Stand-in for the dialog: hand its onExport back to the test so it can
  // confirm an export the way the real Save / Share buttons would.
  default: ({ onExport }: { onExport: OnExport }) => {
    h.onExport = onExport;
    return null;
  },
}));
vi.mock('@/app/reader/components/annotator/ImportAnnotationsDialog', () => ({
  default: () => null,
}));

import Annotator from '@/app/reader/components/annotator/Annotator';

const openExportDialog = async () => {
  render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
  await act(async () => {
    await eventDispatcher.dispatch('export-annotations', { bookKey: 'book-1' });
  });
  expect(h.onExport).not.toBeNull();
};

describe('Annotator export confirmation on macOS', () => {
  const toasts: { message: string }[] = [];
  const onToast = (event: CustomEvent) => {
    toasts.push(event.detail as { message: string });
  };

  beforeEach(() => {
    h.onExport = null;
    toasts.length = 0;
    h.appService.saveFile.mockClear();
    h.appService.saveFile.mockResolvedValue(true);
    eventDispatcher.on('toast', onToast);
  });

  afterEach(() => {
    eventDispatcher.off('toast', onToast);
    cleanup();
  });

  test('Save writes the file through the save dialog and confirms with a toast', async () => {
    await openExportDialog();

    await act(async () => {
      await h.onExport!('# notes', 'markdown', { share: false, sharePosition: { x: 1, y: 2 } });
    });

    expect(h.appService.saveFile).toHaveBeenCalledWith(
      'My Book.md',
      '# notes',
      expect.objectContaining({ share: false, mimeType: 'text/markdown' }),
    );
    expect(toasts.map((toast) => toast.message)).toEqual(['Exported successfully']);
  });

  test('Share hands the file to the share sheet, which gives its own feedback', async () => {
    await openExportDialog();

    await act(async () => {
      await h.onExport!('# notes', 'markdown', { share: true, sharePosition: { x: 1, y: 2 } });
    });

    expect(h.appService.saveFile).toHaveBeenCalledWith(
      'My Book.md',
      '# notes',
      expect.objectContaining({ share: true }),
    );
    expect(toasts).toEqual([]);
  });
});
