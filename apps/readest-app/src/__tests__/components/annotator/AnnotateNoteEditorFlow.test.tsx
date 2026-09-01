/**
 * #5987 / #5957 — "Annotate" used to highlight the selection and then hand the
 * note off to the annotations sidebar, which lists notes in reading order and
 * virtualizes them. The new note's editor mounted off screen, so the user got a
 * higher annotation count and nothing else: no visible note, no caret.
 *
 * Annotate now opens the editor where the selection already is — inside the
 * annotation toolbar popup on desktop, in a bottom sheet on phone-sized
 * screens — and leaves the sidebar alone.
 */

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { eventDispatcher } from '@/utils/event';
import { BookNote } from '@/types/book';

// Stand in for the two presentation surfaces so the test can assert *where*
// the editor was handed to, and drive its save/cancel without laying a popup
// or a sheet out in jsdom. Hoisted, because vi.mock factories run before any
// top-level const in this file is initialised.
const stub = vi.hoisted(() => {
  const render = (
    surface: string,
    noteEditor?: { value: string; onSave: (note: string) => void; onCancel: () => void } | null,
    onEditNote?: (note: { id: string }) => void,
  ) => {
    if (!noteEditor) {
      // The bubble's pencil lives on the popup even with no editor open.
      return onEditNote ? (
        <button onClick={() => onEditNote({ id: 'existing-note' })}>stub-edit-note</button>
      ) : null;
    }
    return (
      <div data-testid={`note-editor-${surface}`}>
        <span data-testid={`note-editor-${surface}-value`}>{noteEditor.value}</span>
        <button onClick={() => noteEditor.onSave('a thought worth keeping')}>stub-save</button>
        <button onClick={() => noteEditor.onCancel()}>stub-cancel</button>
      </div>
    );
  };
  return { render };
});

type NoteEditorStub = {
  value: string;
  onSave: (note: string) => void;
  onCancel: () => void;
};

const h = vi.hoisted(() => ({
  actions: null as null | Record<string, () => boolean>,
  config: { booknotes: [] as BookNote[], viewSettings: {} },
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
  setConfig: vi.fn(),
  setSideBarVisible: vi.fn(),
  setSearchBarVisible: vi.fn(),
  deselect: vi.fn(),
  suppressNativeSelectionHandles: vi.fn(),
  isSideBarVisible: false,
  isTextSelected: { current: true },
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
    setConfig: h.setConfig,
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
    getView: () => ({ deselect: h.deselect }),
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
    get isSideBarVisible() {
      return h.isSideBarVisible;
    },
    setSideBarVisible: h.setSideBarVisible,
    setSearchBarVisible: h.setSearchBarVisible,
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
vi.mock('@/app/reader/hooks/useFoliateEvents', () => ({ useFoliateEvents: () => {} }));
vi.mock('@/app/reader/hooks/useRendererInputListeners', () => ({
  useRendererInputListeners: () => {},
}));

vi.mock('@/app/reader/hooks/useTextSelector', () => ({
  useTextSelector: () => ({
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
    suppressNativeSelectionHandles: h.suppressNativeSelectionHandles,
    noteAutoTurnPoint: { current: null },
    cancelAutoTurn: vi.fn(),
    onAutoTurn: vi.fn(),
  }),
}));

// jsdom lays nothing out, so the real popup positioning bails on a zero rect
// and the toolbar popup never renders. Feed it fixed anchor points instead.
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
vi.mock('@/app/reader/components/annotator/DictionaryPopup', () => ({ default: () => null }));
vi.mock('@/app/reader/components/annotator/DictionarySheet', () => ({ default: () => null }));
vi.mock('@/app/reader/components/annotator/TranslatorPopup', () => ({ default: () => null }));
vi.mock('@/app/reader/components/annotator/ProofreadPopup', () => ({ default: () => null }));
vi.mock('@/app/reader/components/annotator/ExportMarkdownDialog', () => ({ default: () => null }));
vi.mock('@/app/reader/components/annotator/ImportAnnotationsDialog', () => ({
  default: () => null,
}));

vi.mock('@/app/reader/components/annotator/AnnotationPopup', () => ({
  default: (props: {
    noteEditor?: NoteEditorStub | null;
    onEditNote?: (note: { id: string }) => void;
  }) => stub.render('popup', props.noteEditor, props.onEditNote),
}));
vi.mock('@/app/reader/components/annotator/NoteEditorSheet', () => ({
  default: (props: NoteEditorStub) => stub.render('sheet', props),
}));

import Annotator from '@/app/reader/components/annotator/Annotator';

const setViewport = (width: number, height: number) => {
  Object.defineProperty(window, 'innerWidth', { value: width, writable: true, configurable: true });
  Object.defineProperty(window, 'innerHeight', {
    value: height,
    writable: true,
    configurable: true,
  });
};

const selectText = async () => {
  // repositionPopups needs the book's grid cell to measure against.
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

const annotate = async () => {
  render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
  await selectText();
  act(() => {
    h.actions?.['onAnnotateSelection']?.();
  });
};

const liveAnnotations = () => h.config.booknotes.filter((note) => !note.deletedAt);

beforeEach(() => {
  h.actions = null;
  h.config.booknotes = [];
  h.viewSettings.copyToNotebook = false;
  // Mirror the real store: write back whatever array it is handed, since the
  // note-text save builds a new array rather than mutating in place.
  h.updateBooknotes.mockImplementation((_bookKey: string, booknotes: BookNote[]) => {
    h.config.booknotes = booknotes;
    return h.config;
  });
  setViewport(1280, 800);
  h.isSideBarVisible = false;
  h.isTextSelected.current = true;
  vi.clearAllMocks();
});

afterEach(cleanup);

describe('Annotate opens the note editor at the selection', () => {
  test('hands the editor to the toolbar popup on a desktop-sized window', async () => {
    await annotate();

    expect(screen.getByTestId('note-editor-popup')).toBeTruthy();
    expect(screen.queryByTestId('note-editor-sheet')).toBeNull();
    expect(liveAnnotations()).toHaveLength(1);
  });

  test('hands the editor to the bottom sheet on a phone-sized window', async () => {
    setViewport(390, 844);
    await annotate();

    expect(screen.getByTestId('note-editor-sheet')).toBeTruthy();
    expect(screen.queryByTestId('note-editor-popup')).toBeNull();
  });

  test('leaves the sidebar alone', async () => {
    await annotate();

    expect(h.setSideBarVisible).not.toHaveBeenCalled();
    expect(h.setSearchBarVisible).not.toHaveBeenCalled();
    expect(h.setConfig).not.toHaveBeenCalledWith(
      'book-1',
      expect.objectContaining({
        viewSettings: expect.objectContaining({ sideBarTab: 'annotations' }),
      }),
    );
  });

  test('saving writes the typed note onto the new annotation and closes the editor', async () => {
    await annotate();

    act(() => {
      screen.getByText('stub-save').click();
    });

    expect(liveAnnotations()).toEqual([
      expect.objectContaining({ note: 'a thought worth keeping', text: 'selected text' }),
    ]);
    expect(screen.queryByTestId('note-editor-popup')).toBeNull();
  });

  test('cancelling drops the placeholder highlight it just created (#4791)', async () => {
    await annotate();
    expect(liveAnnotations()).toHaveLength(1);

    act(() => {
      screen.getByText('stub-cancel').click();
    });

    expect(liveAnnotations()).toHaveLength(0);
    expect(screen.queryByTestId('note-editor-popup')).toBeNull();
  });

  const existingNote: BookNote = {
    id: 'existing-note',
    type: 'annotation',
    cfi: 'epubcfi(/6/2!/4/2)',
    text: 'selected text',
    note: 'an older thought',
    style: 'highlight',
    color: 'yellow',
    createdAt: 1,
    updatedAt: 1,
  };

  const editExistingNote = async () => {
    h.config.booknotes = [{ ...existingNote }];
    render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
    await selectText();
    act(() => {
      screen.getByText('stub-edit-note').click();
    });
  };

  test('drops the selection so the range handles cannot cover the editor (#5815)', async () => {
    await annotate();

    expect(h.deselect).toHaveBeenCalled();
    expect(h.isTextSelected.current).toBe(false);
  });

  // The other side of the boundary: a toolbar lookup keeps its selection so
  // dismissing it lands back on the selection toolbar (#5213). Only the note
  // editor consumes the selection; a lookup's handles are hidden for its
  // duration by the same gate instead.
  test.each([
    'onDictionarySelection',
    'onTranslateSelection',
    'onProofreadSelection',
  ])('%s keeps the selection so its dismiss returns to the toolbar (#5213)', async (action) => {
    render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
    await selectText();

    act(() => {
      h.actions?.[action]?.();
    });

    expect(h.deselect).not.toHaveBeenCalled();
    expect(h.isTextSelected.current).toBe(true);
    // ...but the platform's own grabbers go, since no z-index can get a popup
    // above them on iOS.
    expect(h.suppressNativeSelectionHandles).toHaveBeenCalled();
  });

  test('the note bubble pencil opens the same editor, seeded with the existing note', async () => {
    await editExistingNote();
    expect(screen.getByTestId('note-editor-popup-value').textContent).toBe('an older thought');

    act(() => {
      screen.getByText('stub-save').click();
    });
    expect(liveAnnotations()).toEqual([
      expect.objectContaining({ id: 'existing-note', note: 'a thought worth keeping' }),
    ]);
  });

  test('cancelling an existing note never deletes it', async () => {
    await editExistingNote();

    act(() => {
      screen.getByText('stub-cancel').click();
    });

    expect(liveAnnotations()).toEqual([
      expect.objectContaining({ id: 'existing-note', note: 'an older thought' }),
    ]);
  });

  // #4791: the placeholder only lives as long as its editor is presented, and
  // Cancel is not the only way it stops being presented. Opening the sidebar
  // dismisses the popup from an effect, which used to clear the target and
  // leave the empty highlight behind.
  test('drops the placeholder when the editor is dismissed, not just cancelled', async () => {
    const view = render(
      <Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />,
    );
    await selectText();
    act(() => {
      h.actions?.['onAnnotateSelection']?.();
    });
    expect(liveAnnotations()).toHaveLength(1);

    h.isSideBarVisible = true;
    act(() => {
      view.rerender(
        <Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />,
      );
    });

    expect(screen.queryByTestId('note-editor-popup')).toBeNull();
    expect(liveAnnotations()).toHaveLength(0);
  });

  test('cancelling keeps a highlight that already existed before Annotate', async () => {
    render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
    await selectText();
    // Highlight first, so Annotate attaches a note to an existing record
    // instead of creating a placeholder of its own.
    act(() => {
      h.actions?.['onHighlightSelection']?.();
    });
    act(() => {
      h.actions?.['onAnnotateSelection']?.();
    });
    expect(liveAnnotations()).toHaveLength(1);

    act(() => {
      screen.getByText('stub-cancel').click();
    });

    expect(liveAnnotations()).toHaveLength(1);
  });
});
