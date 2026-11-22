// @vitest-environment happy-dom
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

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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
    enableAnnotationQuickActions: false,
    annotationQuickAction: '' as string,
    keepSelectionAfterLookup: false,
  },
  saveConfig: vi.fn(),
  setConfig: vi.fn(),
  saveSysSettings: vi.fn(),
  sidebar: {
    isSideBarPinned: false,
    setSideBarBookKey: vi.fn(),
    setSideBarPin: vi.fn(),
    setSideBarVisible: vi.fn(),
  },
  notebook: {
    setNotebookVisible: vi.fn(),
    setNotebookActiveTab: vi.fn(),
    setNotebookPin: vi.fn(),
  },
  updateBooknotes: vi.fn(),
  deselect: vi.fn(),
  restoreSelectionRange: vi.fn(() => true),
  lookupSettings: {
    providerEnabled: {} as Record<string, boolean>,
    saveLookupsToVocabulary: true,
  },
  invokeSystemDictionary: vi.fn(),
  recordLookup: vi.fn(),
  // Whether the looked-up word is marked Learning or Mastered.
  wordMarked: false,
  contextTranslator: { id: 'llm' } as { id: string } | undefined,
  // An unsigned JWT on the pro plan; null is a signed-out, free reader.
  token: 'eyJhbGciOiJub25lIn0.eyJwbGFuIjoicHJvIn0.sig' as string | null,
  isTextSelected: { current: true },
  appService: {} as { isIOSApp?: boolean },
  onNativeTouch: null as null | ((ev: { type: string; x: number; y: number }) => void),
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
  // On for a test that lays the book cell and the selection out itself.
  realPopupGeometry: false,
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
    setConfig: h.setConfig,
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
  getBookProgress: () => ({ page: 1 }),
  useBookProgress: () => ({ page: 1, sectionHref: 'chapter.xhtml' }),
}));

vi.mock('@/store/notebookStore', () => ({
  useNotebookStore: Object.assign(
    () => ({
      setNotebookVisible: vi.fn(),
      setNotebookActiveTab: vi.fn(),
      setNotebookNewAnnotation: vi.fn(),
      setNotebookNewHighlightIds: vi.fn(),
    }),
    { getState: () => h.notebook },
  ),
}));

vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: Object.assign(
    () => ({
      clearBooknotesNav: vi.fn(),
      isSideBarVisible: false,
      setSideBarVisible: vi.fn(),
      setSearchBarVisible: vi.fn(),
    }),
    { getState: () => h.sidebar },
  ),
}));

vi.mock('@/helpers/settings', () => ({ saveSysSettings: h.saveSysSettings }));

vi.mock('@/store/customDictionaryStore', () => ({
  useCustomDictionaryStore: Object.assign(
    () => ({ loadCustomDictionaries: vi.fn().mockResolvedValue(undefined) }),
    { getState: () => ({ settings: h.lookupSettings }) },
  ),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ token: h.token, user: null }),
}));

vi.mock('@/services/dictionaries/providers/contextProvider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/dictionaries/providers/contextProvider')>()),
  getContextTranslator: () => h.contextTranslator,
}));

vi.mock('@/services/dictionaries/systemDictionary', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/dictionaries/systemDictionary')>()),
  isSystemDictionarySupported: () => true,
  invokeSystemDictionary: h.invokeSystemDictionary,
}));

vi.mock('@/store/vocabularyStore', () => ({
  useVocabularyStore: {
    getState: () => ({ recordLookup: h.recordLookup, isMarked: () => h.wordMarked }),
  },
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
  useFoliateEvents: (_view: unknown, handlers: Record<string, (event: Event) => void>) => {
    h.foliateHandlers = handlers;
  },
}));
vi.mock('@/app/reader/hooks/useRendererInputListeners', () => ({
  useRendererInputListeners: (
    _view: unknown,
    opts: { onNativeTouch?: (ev: { type: string; x: number; y: number }) => void },
  ) => {
    h.onNativeTouch = opts.onNativeTouch ?? null;
  },
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
      restoreSelectionRange: h.restoreSelectionRange,
      noteAutoTurnPoint: { current: null },
      cancelAutoTurn: vi.fn(),
      onAutoTurn: vi.fn(),
    };
  },
}));

// jsdom lays nothing out, so the real popup positioning bails on a zero rect
// and no popup ever renders. Feed it fixed anchor points instead, unless the
// test lays things out itself.
vi.mock('@/utils/sel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/sel')>();
  return {
    ...actual,
    getPosition: (...args: Parameters<typeof actual.getPosition>) =>
      h.realPopupGeometry
        ? actual.getPosition(...args)
        : { point: { x: 120, y: 200 }, dir: 'up' as const },
    getPopupPosition: (...args: Parameters<typeof actual.getPopupPosition>) =>
      h.realPopupGeometry
        ? actual.getPopupPosition(...args)
        : { point: { x: 120, y: 140 }, dir: 'up' as const },
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
  default: ({
    buttons,
  }: {
    buttons: { tooltipText: string; onClick: () => void; disabled?: boolean }[];
  }) => (
    <div data-testid='annotation-toolbar'>
      {buttons.map((b) => (
        <button key={b.tooltipText} type='button' disabled={b.disabled} onClick={b.onClick}>
          {b.tooltipText}
        </button>
      ))}
    </div>
  ),
}));
// The dismiss button stands in for the popup's close / backdrop tap, so a test
// can drive the route back out of the lookup. Each surface reads its text the
// way the real one does on every render, so rendering one without a word fails
// the same way (#6419).
vi.mock('@/app/reader/components/annotator/DictionaryPopup', () => ({
  default: ({
    word,
    onDismiss,
    position,
    trianglePosition,
    popupHeight,
    contextOnly,
    onPin,
  }: {
    word: string;
    onDismiss: () => void;
    position: { point: { y: number } };
    trianglePosition: { point: { y: number } };
    popupHeight: number;
    contextOnly?: boolean;
    onPin?: (lookup: { word: string; lang?: string }) => void;
  }) => (
    <div
      data-testid='dictionary-surface'
      data-kind='popup'
      data-context-only={String(!!contextOnly)}
      data-word={word.trim()}
      data-top={position.point.y}
      data-height={popupHeight}
      data-triangle-y={trianglePosition.point.y}
    >
      <button type='button' data-testid='dictionary-dismiss' onClick={onDismiss} />
      {/* Pin to Notebook after following a link from the selected word to "luck". */}
      <button
        type='button'
        data-testid='dictionary-pin'
        onClick={() => onPin?.({ word: 'luck', lang: 'en' })}
      />
    </div>
  ),
}));
vi.mock('@/app/reader/components/annotator/DictionarySheet', () => ({
  default: ({
    word,
    onDismiss,
    contextOnly,
    onPin,
  }: {
    word: string;
    onDismiss: () => void;
    contextOnly?: boolean;
    onPin?: (lookup: { word: string; lang?: string }) => void;
  }) => (
    <div
      data-testid='dictionary-surface'
      data-kind='sheet'
      data-context-only={String(!!contextOnly)}
      data-word={word.trim()}
    >
      <button type='button' data-testid='dictionary-dismiss' onClick={onDismiss} />
      {onPin && (
        <button
          type='button'
          data-testid='dictionary-pin'
          onClick={() => onPin({ word: word.trim(), lang: 'en' })}
        />
      )}
    </div>
  ),
}));
vi.mock('@/app/reader/components/annotator/TranslatorPopup', () => ({
  default: ({ text }: { text: string }) => (
    <div data-testid='translator-surface' data-text={text.trim()} />
  ),
}));
vi.mock('@/app/reader/components/annotator/ProofreadPopup', () => ({
  default: () => <div data-testid='proofread-surface' />,
}));

import Annotator from '@/app/reader/components/annotator/Annotator';
import { useDictionaryDockStore } from '@/store/dictionaryDockStore';

const selectText = async (text = 'selected text') => {
  // The selection effect needs the book's grid cell to measure against.
  if (!document.querySelector('#gridcell-book-1')) {
    const gridCell = document.createElement('div');
    gridCell.id = 'gridcell-book-1';
    document.body.append(gridCell);
  }
  const paragraph = document.createElement('p');
  paragraph.textContent = text;
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
  h.appService = {};
  h.onNativeTouch = null;
  h.book = { format: 'EPUB', isFixedLayout: false };
  h.foliateHandlers = null;
  h.config.booknotes = [];
  h.isTextSelected.current = true;
  h.lookupSettings.providerEnabled = {};
  h.lookupSettings.saveLookupsToVocabulary = true;
  h.wordMarked = false;
  h.viewSettings.annotationToolbarItems = ['copy'];
  h.contextTranslator = { id: 'llm' };
  h.token = 'eyJhbGciOiJub25lIn0.eyJwbGFuIjoicHJvIn0.sig';
  h.setSelection = null;
  h.viewSettings.enableAnnotationQuickActions = false;
  h.viewSettings.annotationQuickAction = '';
  h.restoreSelectionRange.mockReturnValue(true);
  h.updateBooknotes.mockImplementation(() => h.config);
  h.sidebar.isSideBarPinned = false;
  h.viewSettings.keepSelectionAfterLookup = false;
  useDictionaryDockStore.setState({ lookup: null, isDocked: false });
  vi.clearAllMocks();
});

afterEach(cleanup);

// A marked word keeps its sentences with saving off (#7691).
test.each([
  [true, true, false, true],
  [true, false, false, false],
  [false, true, false, false],
  [false, true, true, true],
])('system dictionary saves lookups when enabled (%s), launched (%s) and marked (%s)', async (saveLookups, launched, marked, saved) => {
  h.lookupSettings.providerEnabled = { 'builtin:system': true };
  h.lookupSettings.saveLookupsToVocabulary = saveLookups;
  h.wordMarked = marked;
  h.invokeSystemDictionary.mockResolvedValue(launched);
  render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
  await selectText('serendipity');

  await act(async () => {
    h.actions?.['onDictionarySelection']?.();
  });

  expect(h.invokeSystemDictionary.mock.calls[0]?.[0]).toBe('serendipity');
  expect(screen.queryByTestId('dictionary-surface')).toBeNull();
  if (saved) {
    expect(h.recordLookup).toHaveBeenCalledWith({
      word: 'serendipity',
      lang: 'en',
      occurrence: expect.objectContaining({
        cfi: 'epubcfi(/6/2!/4/2)',
        sentence: 'serendipity',
      }),
    });
  } else {
    expect(h.recordLookup).not.toHaveBeenCalled();
  }
});

// With saving off, a word unmarked or removed (e.g. by a sync) while the OS
// lookup launches must not be saved back.
test('system dictionary rechecks the mark once the lookup launches', async () => {
  h.lookupSettings.providerEnabled = { 'builtin:system': true };
  h.lookupSettings.saveLookupsToVocabulary = false;
  h.wordMarked = true;
  let launch: (launched: boolean) => void = () => {};
  h.invokeSystemDictionary.mockReturnValue(new Promise<boolean>((r) => (launch = r)));
  render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
  await selectText('serendipity');

  await act(async () => {
    h.actions?.['onDictionarySelection']?.();
  });
  h.wordMarked = false;
  await act(async () => launch(true));

  expect(h.recordLookup).not.toHaveBeenCalled();
});

// #7691: the footnote popup reports a Word Lens hint tap as a popup selection
// over the hinted word; it opens the dictionary like a hint tap in the book.
test('a Word Lens hint tapped in the footnote popup opens the dictionary', async () => {
  h.isTextSelected.current = false;
  render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
  const gridCell = document.createElement('div');
  gridCell.id = 'gridcell-book-1';
  document.body.append(gridCell);
  const paragraph = document.createElement('p');
  paragraph.textContent = 'spice';
  document.body.append(paragraph);
  const range = document.createRange();
  range.selectNodeContents(paragraph);

  await act(async () => {
    await eventDispatcher.dispatch('footnote-selection', {
      key: 'book-1',
      range,
      index: 3,
      wordLens: true,
    });
  });

  expect(screen.getByTestId('dictionary-surface').dataset['word']).toBe('spice');
  expect(screen.queryByTestId('annotation-toolbar')).toBeNull();
});

describe('the Context Dictionary tool (#7497)', () => {
  test('opens the lookup with the context dictionary alone; Dictionary opens every one', async () => {
    h.viewSettings.annotationToolbarItems = ['dictionary', 'contextdictionary'];
    render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
    await selectText('Welten');

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Context Dictionary' }));
    });
    expect(screen.getByTestId('dictionary-surface').dataset['contextOnly']).toBe('true');

    act(() => {
      fireEvent.click(screen.getByTestId('dictionary-dismiss'));
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Dictionary' }));
    });
    expect(screen.getByTestId('dictionary-surface').dataset['contextOnly']).toBe('false');
  });

  test.each([
    ['an OpenAI-compatible translator', () => (h.contextTranslator = undefined)],
    ['premium', () => (h.token = null)],
  ])('is unavailable without %s', async (_name, withhold) => {
    withhold();
    h.viewSettings.annotationToolbarItems = ['contextdictionary'];
    render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
    await selectText('Welten');

    const button = screen.getByRole('button', { name: 'Context Dictionary' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});

describe('the System Dictionary tool (#6728)', () => {
  test('hands the word to the OS while the Dictionary tool keeps the in-app dictionaries', async () => {
    h.invokeSystemDictionary.mockResolvedValue(true);
    h.viewSettings.annotationToolbarItems = ['dictionary', 'systemdictionary'];
    render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
    await selectText('serendipity');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'System Dictionary' }));
    });
    expect(h.invokeSystemDictionary.mock.calls[0]?.[0]).toBe('serendipity');
    expect(screen.queryByTestId('dictionary-surface')).toBeNull();
    expect(h.recordLookup).toHaveBeenCalledWith(
      expect.objectContaining({ word: 'serendipity', lang: 'en' }),
    );

    await selectText('serendipity');
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Dictionary' }));
    });
    expect(h.invokeSystemDictionary).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('dictionary-surface').dataset['word']).toBe('serendipity');
  });
});

describe('the Add to Vocabulary tool', () => {
  test('saves the word with its sentence, opens no lookup and dismisses the toolbar', async () => {
    // An explicit add saves even with lookup saving off.
    h.lookupSettings.saveLookupsToVocabulary = false;
    h.viewSettings.annotationToolbarItems = ['dictionary', 'vocabulary'];
    render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
    await selectText('serendipity');

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Add to Vocabulary' }));
    });

    expect(h.recordLookup).toHaveBeenCalledWith({
      word: 'serendipity',
      lang: 'en',
      occurrence: expect.objectContaining({
        cfi: 'epubcfi(/6/2!/4/2)',
        sentence: 'serendipity',
      }),
    });
    expect(screen.queryByTestId('dictionary-surface')).toBeNull();
    expect(screen.queryByTestId('annotation-toolbar')).toBeNull();
  });
});

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
 * #6419 — clicking outside the dictionary crashed the reader on Windows.
 *
 * The lookup surfaces are fed `selection.text`, but the selection can be
 * cleared without going through the dismiss that closes them: with the instant
 * highlight quick action armed, a tap on the page clears it from
 * `useInstantAnnotation`. The surface then rendered once with no text and
 * threw on `word.trim()`, taking the whole reader down to the error page.
 */
describe('a lookup surface closes when its selection is cleared', () => {
  test.each([
    ['onDictionarySelection', 'dictionary-surface'],
    ['onTranslateSelection', 'translator-surface'],
    ['onProofreadSelection', 'proofread-surface'],
  ])('%s closes instead of rendering without text', async (action, testId) => {
    render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
    await selectText();

    act(() => {
      h.actions?.[action]?.();
    });
    expect(screen.getByTestId(testId)).toBeTruthy();

    // What `clearInstantAnnotationState` does on a tap.
    await act(async () => {
      h.setSelection?.(() => null);
    });
    expect(screen.queryByTestId(testId)).toBeNull();

    // And the next selection gets the toolbar, not the stale lookup.
    await selectText();
    expect(screen.queryByTestId(testId)).toBeNull();
    expect(screen.getByTestId('annotation-toolbar')).toBeTruthy();
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

/**
 * #6213 — the instant dictionary quick action left nothing behind.
 *
 * #5730 made the instant lookup consume its selection so the platform's own
 * selection UI (iOS draws grabbers and the blue highlight above web content)
 * couldn't paint over the popup, and so the dismiss had no toolbar to return
 * to (#5585). But that also took away the only route to highlighting or
 * copying the word afterwards: with a quick action armed, re-selecting it just
 * opens the dictionary again. The selection is now handed back when the lookup
 * closes — programmatically, so the native handles stay away.
 */
describe('the instant dictionary hands the selection back when it closes', () => {
  const selectWord = async () => {
    if (!document.querySelector('#gridcell-book-1')) {
      const gridCell = document.createElement('div');
      gridCell.id = 'gridcell-book-1';
      document.body.append(gridCell);
    }
    const paragraph = document.createElement('p');
    paragraph.textContent = 'fortune';
    document.body.append(paragraph);
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    await act(async () => {
      h.setSelection?.(() => ({
        key: 'book-1',
        text: 'fortune',
        cfi: 'epubcfi(/6/2!/4/2)',
        range,
        index: 0,
        page: 1,
      }));
    });
    return range;
  };

  beforeEach(() => {
    h.viewSettings.enableAnnotationQuickActions = true;
    h.viewSettings.annotationQuickAction = 'dictionary';
    h.viewSettings.keepSelectionAfterLookup = true;
  });

  test('drops the selection while the lookup is open', async () => {
    render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
    await selectWord();

    expect(screen.getByTestId('dictionary-surface')).toBeTruthy();
    expect(screen.queryByTestId('annotation-toolbar')).toBeNull();
    expect(h.deselect).toHaveBeenCalled();
    expect(h.isTextSelected.current).toBe(false);
  });

  test('stays a popup when the keyboard for its hint field shortens the window (#7570)', async () => {
    const setViewport = (width: number, height: number) => {
      Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
    };
    const { innerWidth, innerHeight } = window;
    try {
      // An iPad in landscape; typing a Learning word's hint raises the keyboard.
      setViewport(1180, 820);
      const insets = { top: 0, right: 0, bottom: 0, left: 0 };
      const { rerender } = render(<Annotator bookKey='book-1' contentInsets={insets} />);
      await selectWord();
      expect(screen.getByTestId('dictionary-surface').dataset['kind']).toBe('popup');

      setViewport(1180, 420);
      rerender(<Annotator bookKey='book-1' contentInsets={{ ...insets }} />);

      expect(screen.getByTestId('dictionary-surface').dataset['kind']).toBe('popup');
    } finally {
      setViewport(innerWidth, innerHeight);
    }
  });

  test('places the popup again inside the window the keyboard shortened (#7570)', async () => {
    const setViewport = (width: number, height: number) => {
      Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
    };
    const { innerWidth, innerHeight } = window;
    // The book cell fills the window, and the word sits on the page's last line
    // wherever the page now ends: the keyboard shortens the page with the window.
    let gridCell = document.querySelector<HTMLElement>('#gridcell-book-1');
    if (!gridCell) {
      gridCell = document.createElement('div');
      gridCell.id = 'gridcell-book-1';
      document.body.append(gridCell);
    }
    gridCell.getBoundingClientRect = () => new DOMRect(0, 0, window.innerWidth, window.innerHeight);
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: () => [new DOMRect(500, window.innerHeight - 60, 100, 20)],
    });
    h.realPopupGeometry = true;
    try {
      setViewport(1180, 820);
      render(
        <Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />,
      );
      await selectWord();
      const popup = screen.getByTestId('dictionary-surface');
      expect(popup.dataset['kind']).toBe('popup');

      setViewport(1180, 420);
      act(() => {
        window.dispatchEvent(new Event('resize'));
      });

      // The same popup, not a remount, so its hint field keeps the focus.
      expect(screen.getByTestId('dictionary-surface')).toBe(popup);
      const top = Number(popup.dataset['top']);
      const bottom = top + Number(popup.dataset['height']);
      expect(top, 'popup top edge').toBeGreaterThanOrEqual(0);
      expect(bottom, 'popup bottom edge').toBeLessThanOrEqual(420);
      expect(Number(popup.dataset['triangleY']), 'popup anchor').toBeLessThanOrEqual(420);
    } finally {
      h.realPopupGeometry = false;
      delete (Range.prototype as { getClientRects?: unknown }).getClientRects;
      gridCell.remove();
      setViewport(innerWidth, innerHeight);
    }
  });

  test('restores the selection and returns the toolbar on dismiss', async () => {
    render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
    const range = await selectWord();

    await act(async () => {
      screen.getByTestId('dictionary-dismiss').click();
    });

    expect(h.restoreSelectionRange).toHaveBeenCalledWith(range);
    expect(screen.queryByTestId('dictionary-surface')).toBeNull();
    expect(screen.getByTestId('annotation-toolbar')).toBeTruthy();
  });

  // Xiaomi 13: highlighting the handed-back word re-opened the dictionary.
  // `handleHighlight` republishes the selection to stamp `annotated`, and with
  // the selection live again the effect read that as a fresh selection and ran
  // the quick action a second time — the tap on the colour swatch having
  // re-armed the once-per-gesture latch that would otherwise have swallowed it.
  // The restored selection carries `quickActionHandled` so a republish of it can
  // never fire the lookup again.
  test('a republish of the handed-back selection does not re-open the lookup', async () => {
    render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
    // The section load is what registers the pointerdown listener that re-arms
    // the quick action for each new gesture.
    await act(async () => {
      h.foliateHandlers?.['onLoad']?.(
        new CustomEvent('load', { detail: { doc: document, index: 0 } }) as Event,
      );
    });
    await selectWord();

    await act(async () => {
      screen.getByTestId('dictionary-dismiss').click();
    });
    expect(screen.getByTestId('annotation-toolbar')).toBeTruthy();

    // The tap on the toolbar's highlight swatch: a new gesture (Android bridges
    // every touch on the window, not just those over the page), then the
    // republish handleHighlight does once the highlight is created.
    await act(async () => {
      const pointerDown = new Event('pointerdown', { bubbles: true });
      Object.defineProperty(pointerDown, 'pointerType', { value: 'mouse' });
      document.dispatchEvent(pointerDown);
      h.setSelection?.((prev) => (prev ? { ...prev, annotated: true } : prev));
    });

    expect(screen.queryByTestId('dictionary-surface')).toBeNull();
    expect(screen.getByTestId('annotation-toolbar')).toBeTruthy();
  });

  test('a restore that cannot be applied dismisses clean', async () => {
    h.restoreSelectionRange.mockReturnValue(false);
    render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
    await selectWord();

    await act(async () => {
      screen.getByTestId('dictionary-dismiss').click();
    });

    expect(screen.queryByTestId('dictionary-surface')).toBeNull();
    expect(screen.queryByTestId('annotation-toolbar')).toBeNull();
  });
});

/**
 * #6454 — handing the selection back (#6213) raised the toolbar after every
 * instant lookup, an extra dismiss for readers who look up word after word.
 * It is now opt-in: by default closing the lookup goes straight back to reading.
 */
describe('the instant dictionary dismisses clean unless told to keep the selection', () => {
  beforeEach(() => {
    h.viewSettings.enableAnnotationQuickActions = true;
    h.viewSettings.annotationQuickAction = 'dictionary';
    h.viewSettings.keepSelectionAfterLookup = false;
  });

  test('closing the lookup restores nothing and shows no toolbar', async () => {
    if (!document.querySelector('#gridcell-book-1')) {
      const gridCell = document.createElement('div');
      gridCell.id = 'gridcell-book-1';
      document.body.append(gridCell);
    }
    render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
    const paragraph = document.createElement('p');
    paragraph.textContent = 'fortune';
    document.body.append(paragraph);
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    await act(async () => {
      h.setSelection?.(() => ({
        key: 'book-1',
        text: 'fortune',
        cfi: 'epubcfi(/6/2!/4/2)',
        range,
        index: 0,
        page: 1,
      }));
    });
    expect(screen.getByTestId('dictionary-surface')).toBeTruthy();

    await act(async () => {
      screen.getByTestId('dictionary-dismiss').click();
    });

    expect(h.restoreSelectionRange).not.toHaveBeenCalled();
    expect(screen.queryByTestId('dictionary-surface')).toBeNull();
    expect(screen.queryByTestId('annotation-toolbar')).toBeNull();
  });
});

// #6804: a selection made in the footnote popup reaches the Annotator through
// `footnote-selection`, not the section listeners that latch isTextSelected, so
// the quick action never ran there and only the toolbar opened.
describe('quick actions run on a selection made in the footnote popup', () => {
  const selectInPopup = async (detail: Record<string, unknown> = {}, word = 'fortune') => {
    if (!document.querySelector('#gridcell-book-1')) {
      const gridCell = document.createElement('div');
      gridCell.id = 'gridcell-book-1';
      document.body.append(gridCell);
    }
    const paragraph = document.createElement('p');
    paragraph.textContent = word;
    document.body.append(paragraph);
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    await act(async () => {
      await eventDispatcher.dispatch('footnote-selection', {
        key: 'book-1',
        range,
        index: 3,
        cfi: 'epubcfi(/6/2!/4/2)',
        ...detail,
      });
    });
  };

  beforeEach(() => {
    // Nothing is selected in the book's own sections.
    h.isTextSelected.current = false;
    h.viewSettings.enableAnnotationQuickActions = true;
    h.viewSettings.annotationQuickAction = 'dictionary';
  });

  test('a settled popup selection runs the quick action', async () => {
    render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
    await selectInPopup({ quickAction: true });

    expect(screen.getByTestId('dictionary-surface').dataset['word']).toBe('fortune');
    expect(screen.queryByTestId('annotation-toolbar')).toBeNull();
  });

  // The system selection handles are drawn above the lookup, so the instant
  // dictionary drops the popup selection; the cleared report it echoes back
  // must not close the lookup.
  test('the instant dictionary drops the popup selection and stays open', async () => {
    render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
    await selectInPopup({ quickAction: true });
    expect(document.getSelection()?.rangeCount).toBe(0);

    await act(async () => {
      await eventDispatcher.dispatch('footnote-selection', { key: 'book-1' });
      await new Promise((resolve) => setTimeout(resolve, 600));
    });

    expect(screen.getByTestId('dictionary-surface').dataset['word']).toBe('fortune');
  });

  // The quick action runs once per gesture; a press in the popup must re-arm
  // it, or only the first popup selection ran it (iOS).
  test('a new gesture in the popup runs the quick action again', async () => {
    render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
    await selectInPopup({ quickAction: true });
    await act(async () => {
      screen.getByTestId('dictionary-dismiss').click();
    });
    expect(screen.queryByTestId('dictionary-surface')).toBeNull();

    await act(async () => {
      await eventDispatcher.dispatch('footnote-pointerdown', {
        key: 'book-1',
        pointerType: 'mouse',
      });
    });
    await selectInPopup({ quickAction: true });

    expect(screen.getByTestId('dictionary-surface')).toBeTruthy();
  });

  // iOS settles a popup selection with the finger still down and re-confirms
  // it, handles and all, on release: the lookup must wait for the release.
  test('on iOS the quick action waits for the finger to lift', async () => {
    h.appService = { isIOSApp: true };
    render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
    act(() => h.onNativeTouch?.({ type: 'touchstart', x: 0, y: 0 }));
    await selectInPopup({ quickAction: true });
    expect(screen.queryByTestId('dictionary-surface')).toBeNull();

    await act(async () => h.onNativeTouch?.({ type: 'touchend', x: 0, y: 0 }));

    expect(screen.getByTestId('dictionary-surface').dataset['word']).toBe('fortune');
    expect(document.getSelection()?.rangeCount).toBe(0);
  });

  test('a popup selection re-confirmed under the lookup is dropped again', async () => {
    render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
    await selectInPopup({ quickAction: true });
    expect(document.getSelection()?.rangeCount).toBe(0);

    await selectInPopup({ quickAction: true });

    expect(document.getSelection()?.rangeCount).toBe(0);
    expect(screen.getByTestId('dictionary-surface').dataset['word']).toBe('fortune');
  });

  // On desktop the lookup leaves the rest of the popup clickable: a new press
  // there is the reader's next gesture, not iOS re-confirming the dropped
  // selection, so it looks up the next word or closes the lookup (#6869).
  const pressInPopup = async () => {
    await act(async () => {
      await eventDispatcher.dispatch('footnote-pointerdown', {
        key: 'book-1',
        pointerType: 'mouse',
      });
    });
  };

  test('a word selected in the popup under the lookup is looked up', async () => {
    render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
    await selectInPopup({ quickAction: true });
    expect(screen.getByTestId('dictionary-surface').dataset['word']).toBe('fortune');

    await pressInPopup();
    await selectInPopup({ quickAction: true }, 'lanterns');

    expect(screen.getByTestId('dictionary-surface').dataset['word']).toBe('lanterns');
  });

  test('a click on empty space in the popup closes the lookup', async () => {
    render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
    await selectInPopup({ quickAction: true });
    expect(screen.getByTestId('dictionary-surface')).toBeTruthy();

    await pressInPopup();
    await act(async () => {
      await eventDispatcher.dispatch('footnote-selection', { key: 'book-1' });
      await new Promise((resolve) => setTimeout(resolve, 600));
    });

    expect(screen.queryByTestId('dictionary-surface')).toBeNull();
  });

  // A tap outside the footnote popup closes it; the lookup opened on its text
  // goes with it, as it does when opened from the toolbar (#7727).
  test('closing the popup closes the instant dictionary opened in it', async () => {
    render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
    await selectInPopup({ quickAction: true });
    expect(screen.getByTestId('dictionary-surface')).toBeTruthy();

    await act(async () => {
      await eventDispatcher.dispatch('footnote-selection', { key: 'book-1', closed: true });
      await new Promise((resolve) => setTimeout(resolve, 600));
    });

    expect(screen.queryByTestId('dictionary-surface')).toBeNull();
  });

  test('a report taken mid-drag still opens the toolbar', async () => {
    render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
    await selectInPopup();

    expect(screen.queryByTestId('dictionary-surface')).toBeNull();
    expect(screen.getByTestId('annotation-toolbar')).toBeTruthy();
  });

  // The popup document has no instant annotating, so the highlight quick
  // action highlights the settled selection itself.
  test('the highlight quick action highlights the popup selection', async () => {
    h.viewSettings.annotationQuickAction = 'highlight';
    render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
    await selectInPopup({ quickAction: true });

    expect(h.updateBooknotes).toHaveBeenCalled();
    const booknotes = h.updateBooknotes.mock.calls.at(-1)![1] as {
      cfi: string;
      style?: string;
    }[];
    expect(booknotes).toContainEqual(
      expect.objectContaining({ cfi: 'epubcfi(/6/2!/4/2)', style: 'highlight' }),
    );
    expect(screen.queryByTestId('annotation-toolbar')).toBeNull();
  });

  test('a highlight quick action mid-drag still opens the toolbar', async () => {
    h.viewSettings.annotationQuickAction = 'highlight';
    render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
    await selectInPopup();

    expect(h.updateBooknotes).not.toHaveBeenCalled();
    expect(screen.getByTestId('annotation-toolbar')).toBeTruthy();
  });

  // Read-aloud is disabled for popup selections, so it keeps the toolbar.
  test('the tts quick action keeps the toolbar', async () => {
    h.viewSettings.annotationQuickAction = 'tts';
    render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
    await selectInPopup({ quickAction: true });

    expect(screen.getByTestId('annotation-toolbar')).toBeTruthy();
  });
});

// #7730: with the sidebar's Dictionary tab on screen, lookups go there and
// leave the word on the page free to highlight, annotate or search.
describe('the dictionary docked in the Notebook', () => {
  const selectWord = async (text = 'fortune') => {
    if (!document.querySelector('#gridcell-book-1')) {
      const gridCell = document.createElement('div');
      gridCell.id = 'gridcell-book-1';
      document.body.append(gridCell);
    }
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    document.body.append(paragraph);
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    await act(async () => {
      h.setSelection?.(() => ({
        key: 'book-1',
        text,
        cfi: 'epubcfi(/6/2!/4/2)',
        range,
        index: 0,
        page: 1,
      }));
    });
  };
  const docked = () => useDictionaryDockStore.getState().lookup;

  test('a toolbar lookup shows in the tab and the toolbar stays for the word', async () => {
    useDictionaryDockStore.setState({ isDocked: true });
    h.viewSettings.annotationToolbarItems = ['dictionary', 'contextdictionary'];
    render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
    await selectText('serendipity');

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Dictionary' }));
    });

    expect(screen.queryByTestId('dictionary-surface')).toBeNull();
    expect(screen.getByTestId('annotation-toolbar')).toBeTruthy();
    expect(docked()).toMatchObject({
      word: 'serendipity',
      lang: 'en',
      contextOnly: false,
      // The passage the AI context dictionary is asked about.
      selection: { before: expect.any(String), after: expect.any(String) },
      capture: { lang: 'en', occurrence: expect.objectContaining({ sentence: 'serendipity' }) },
    });

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Context Dictionary' }));
    });
    expect(screen.queryByTestId('dictionary-surface')).toBeNull();
    expect(docked()).toMatchObject({ word: 'serendipity', contextOnly: true });
  });

  test('a popup lookup is kept for the tab too', async () => {
    h.viewSettings.annotationToolbarItems = ['dictionary'];
    render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
    await selectText('serendipity');

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Dictionary' }));
    });

    expect(screen.getByTestId('dictionary-surface').dataset['kind']).toBe('popup');
    expect(docked()).toMatchObject({ word: 'serendipity', contextOnly: false });
  });

  test('Pin to Notebook opens its Dictionary tab, pinned, and returns the toolbar', async () => {
    h.viewSettings.annotationToolbarItems = ['dictionary'];
    render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
    await selectText('serendipity');
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Dictionary' }));
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('dictionary-pin'));
    });

    expect(docked()).toMatchObject({ word: 'luck', lang: 'en' });
    // The Notebook shows the book the sidebar is on.
    expect(h.sidebar.setSideBarBookKey).toHaveBeenCalledWith('book-1');
    expect(h.notebook.setNotebookActiveTab).toHaveBeenCalledWith('dictionary');
    expect(h.notebook.setNotebookPin).toHaveBeenCalledWith(true);
    expect(h.notebook.setNotebookVisible).toHaveBeenCalledWith(true);
    expect(h.saveSysSettings).toHaveBeenCalledWith(
      {},
      'globalReadSettings',
      expect.objectContaining({ isNotebookPinned: true, notebookActiveTab: 'dictionary' }),
    );
    // The left sidebar keeps its own tab and stays as it was.
    expect(h.setConfig).not.toHaveBeenCalled();
    expect(h.sidebar.setSideBarVisible).not.toHaveBeenCalled();
    expect(h.sidebar.setSideBarPin).not.toHaveBeenCalled();
    expect(screen.queryByTestId('dictionary-surface')).toBeNull();
    expect(screen.getByTestId('annotation-toolbar')).toBeTruthy();
  });

  // The Notebook pins beside the page from 640 px wide; a phone in landscape
  // is that wide but too short for the popup, so it gets the sheet (#7789).
  test.each([
    ['a phone in landscape', 890, 411, true],
    ['a phone in portrait', 390, 844, false],
  ])('the dictionary sheet on %s (%i×%i) offers Pin to Notebook: %s', async (_name, width, height, pins) => {
    const setViewport = (w: number, hgt: number) => {
      Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: hgt, configurable: true });
    };
    const { innerWidth, innerHeight } = window;
    try {
      setViewport(width, height);
      h.viewSettings.annotationToolbarItems = ['dictionary'];
      render(
        <Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />,
      );
      await selectText('serendipity');
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Dictionary' }));
      });

      expect(screen.getByTestId('dictionary-surface').dataset['kind']).toBe('sheet');
      expect(!!screen.queryByTestId('dictionary-pin')).toBe(pins);
      if (!pins) return;
      await act(async () => {
        fireEvent.click(screen.getByTestId('dictionary-pin'));
      });
      expect(docked()).toMatchObject({ word: 'serendipity', lang: 'en' });
      expect(h.notebook.setNotebookPin).toHaveBeenCalledWith(true);
      expect(screen.queryByTestId('dictionary-surface')).toBeNull();
    } finally {
      setViewport(innerWidth, innerHeight);
    }
  });

  // Pin hands the word back as closing the popup does. From the instant
  // dictionary that means reading again unless told to keep the selection
  // (#6454), as its later lookups into the tab do.
  test.each([
    [false, 'goes back to reading'],
    [true, 'returns the toolbar when told to keep the selection'],
  ])('Pin from the instant dictionary (keep selection: %s) %s', async (keep) => {
    h.viewSettings.enableAnnotationQuickActions = true;
    h.viewSettings.annotationQuickAction = 'dictionary';
    h.viewSettings.keepSelectionAfterLookup = keep;
    render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
    await selectWord();
    expect(screen.getByTestId('dictionary-surface')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByTestId('dictionary-pin'));
    });

    expect(h.notebook.setNotebookActiveTab).toHaveBeenCalledWith('dictionary');
    expect(screen.queryByTestId('dictionary-surface')).toBeNull();
    expect(!!screen.queryByTestId('annotation-toolbar')).toBe(keep);
  });

  describe('with the instant dictionary', () => {
    beforeEach(() => {
      useDictionaryDockStore.setState({ isDocked: true });
      h.viewSettings.enableAnnotationQuickActions = true;
      h.viewSettings.annotationQuickAction = 'dictionary';
    });

    test('looks the word up in the tab and goes back to reading', async () => {
      render(
        <Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />,
      );
      await selectWord();

      expect(docked()).toMatchObject({ word: 'fortune', contextOnly: false });
      expect(screen.queryByTestId('dictionary-surface')).toBeNull();
      expect(screen.queryByTestId('annotation-toolbar')).toBeNull();
      expect(h.deselect).toHaveBeenCalled();
    });

    test('keeps the word selected with its toolbar when told to keep the selection', async () => {
      h.viewSettings.keepSelectionAfterLookup = true;
      render(
        <Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />,
      );
      await selectWord();

      expect(docked()).toMatchObject({ word: 'fortune' });
      expect(screen.queryByTestId('dictionary-surface')).toBeNull();
      expect(screen.getByTestId('annotation-toolbar')).toBeTruthy();
      expect(h.deselect).not.toHaveBeenCalled();

      // Highlighting it republishes the selection: that must not look it up again.
      const lookup = docked();
      await act(async () => {
        h.setSelection?.((prev) => (prev ? { ...prev, annotated: true } : prev));
      });
      expect(docked()).toBe(lookup);
      expect(screen.getByTestId('annotation-toolbar')).toBeTruthy();
    });
  });

  test('a Word Lens hint tap looks the word up in the tab', async () => {
    useDictionaryDockStore.setState({ isDocked: true });
    h.isTextSelected.current = false;
    render(<Annotator bookKey='book-1' contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
    if (!document.querySelector('#gridcell-book-1')) {
      const gridCell = document.createElement('div');
      gridCell.id = 'gridcell-book-1';
      document.body.append(gridCell);
    }
    const paragraph = document.createElement('p');
    paragraph.textContent = 'spice';
    document.body.append(paragraph);
    const range = document.createRange();
    range.selectNodeContents(paragraph);

    await act(async () => {
      await eventDispatcher.dispatch('footnote-selection', {
        key: 'book-1',
        range,
        index: 3,
        wordLens: true,
      });
    });

    expect(docked()).toMatchObject({ word: 'spice' });
    expect(screen.queryByTestId('dictionary-surface')).toBeNull();
    expect(screen.queryByTestId('annotation-toolbar')).toBeNull();
  });
});
