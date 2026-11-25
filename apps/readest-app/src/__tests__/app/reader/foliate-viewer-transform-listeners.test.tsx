import { render, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { EPUB } from 'foliate-js/epub.js';
import FoliateViewer from '@/app/reader/components/FoliateViewer';

type CustomFontStub = {
  id: string;
  path: string;
  loaded?: boolean;
  unavailable?: boolean;
  blobUrl?: string;
};

const { readerState, openGate, bookDataState, fontState } = vi.hoisted(() => {
  return {
    bookDataState: { bookData: null as unknown },
    fontState: {
      availableFonts: [] as CustomFontStub[],
      loadFont: async (_env: unknown, _id: string) => ({}) as { blobUrl?: string },
    },
    openGate: { pending: null as Promise<void> | null, started: false },
    readerState: {
      setProgress: vi.fn(),
      getViewState: () => ({}),
      getViewSettings: () => ({ writingMode: 'auto' }),
      setView: () => {},
      setViewInited: () => {},
    },
  };
});

vi.mock('@/store/readerStore', () => ({
  useReaderStore: (select: (s: typeof readerState) => unknown) => select(readerState),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: (select: (s: { getBookData: () => unknown }) => unknown) =>
    select({ getBookData: () => bookDataState.bookData }),
}));
vi.mock('@/store/parallelViewStore', () => ({ useParallelViewStore: () => () => [] }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: Object.assign(() => ({ settings: {} }), { getState: () => ({ settings: {} }) }),
}));
vi.mock('@/store/themeStore', () => {
  const state = { isIPhoneDuo: false, duoFold: null, safeAreaInsets: null };
  const useThemeStore = (selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state;
  return { useThemeStore: Object.assign(useThemeStore, { getState: () => state }) };
});
vi.mock('@/store/customFontStore', () => ({
  useCustomFontStore: () => ({
    getLoadedFonts: () => [],
    getAvailableFonts: () => fontState.availableFonts,
    loadFont: (env: unknown, id: string) => fontState.loadFont(env, id),
  }),
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({}) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => null }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));
vi.mock('@/libs/document', () => ({}));
vi.mock('foliate-js/view.js', () => ({}));
vi.mock('@/types/view', () => ({
  wrappedFoliateView: (view: HTMLElement & { book?: unknown }) => {
    const anyCall: object = new Proxy(() => anyCall, { get: () => anyCall, apply: () => anyCall });
    return Object.assign(view, {
      open: async (book: unknown) => {
        view.book = book;
        openGate.started = true;
        await openGate.pending;
      },
      init: async () => {},
      goToFraction: async () => {},
      renderer: anyCall,
    });
  },
}));
vi.mock('@/utils/style', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getStyles: () => '',
}));
vi.mock('@/services/transformService', () => ({}));
vi.mock('@/app/reader/utils/wordlensSection', () => ({}));
vi.mock('@/app/reader/hooks/useFoliateEvents', () => ({ useFoliateEvents: vi.fn() }));
vi.mock('@/app/reader/hooks/useBrightnessGesture', () => ({ useBrightnessGesture: () => ({}) }));
vi.mock('@/app/reader/hooks/useAutoScroll', () => ({
  useAutoScroll: () => ({ isWipeAhead: () => false }),
}));
vi.mock('@/app/reader/hooks/useAutoScrollSpeedGesture', () => ({
  useAutoScrollSpeedGesture: () => ({}),
}));
vi.mock('@/app/reader/hooks/useMiddleClickAutoscroll', () => ({
  useMiddleClickAutoscroll: () => null,
}));
vi.mock('@/app/reader/hooks/useKOSync', () => ({ useKOSync: () => ({}) }));
vi.mock('@/app/reader/hooks/useIframeEvents', () => ({
  useMouseEvent: () => ({}),
  useTouchEvent: () => ({}),
  useOpenMediaEvent: () => {},
}));
vi.mock('@/app/reader/hooks/useCapturedTurn', () => ({
  useCapturedTurn: () => {},
  applyPageTurnAttributes: () => {},
}));
vi.mock('@/app/reader/hooks/usePagination', () => ({ usePagination: () => ({}) }));
vi.mock('@/app/reader/hooks/useProgressSync', () => ({ useProgressSync: () => {} }));
vi.mock('@/app/reader/hooks/useABSProgressSync', () => ({ useABSProgressSync: () => {} }));
vi.mock('@/app/reader/hooks/useProgressAutoSave', () => ({ useProgressAutoSave: () => {} }));
vi.mock('@/app/reader/hooks/useAutoSaveBookCover', () => ({ useBookCoverAutoSave: () => {} }));
vi.mock('@/app/reader/hooks/useFileSync', () => ({ useFileSync: () => {} }));
vi.mock('@/app/reader/hooks/useTextTranslation', () => ({ useTextTranslation: () => {} }));
vi.mock('@/hooks/useBackgroundTexture', () => ({
  useBackgroundTexture: () => ({ applyBackgroundTexture: vi.fn() }),
}));
vi.mock('@/hooks/useAutoFocus', () => ({ useAutoFocus: () => {} }));
vi.mock('@/hooks/useEinkMode', () => ({ useEinkMode: () => ({ applyEinkMode: () => {} }) }));
vi.mock('@/hooks/useUICSS', () => ({ useUICSS: () => {} }));
vi.mock('@/hooks/useDiscordPresence', () => ({ useDiscordPresence: () => {} }));
vi.mock('@/app/reader/hooks/bookOrbitProgressProvider', () => ({ bookOrbitProgressProvider: {} }));
vi.mock('@/app/reader/hooks/grimmoryProgressProvider', () => ({ grimmoryProgressProvider: {} }));
vi.mock('@/app/reader/components/paragraph', () => ({ ParagraphControl: () => null }));
vi.mock('@/app/reader/components/BrightnessOverlay', () => ({ default: () => null }));
vi.mock('@/app/reader/components/ImageViewer', () => ({ default: () => null }));
vi.mock('@/app/reader/components/TableViewer', () => ({ default: () => null }));

// #6710: the book document outlives the reader (bookDataStore caches it for
// the next open), so a listener the view adds to its transformTarget keeps
// that closed view, its iframes and their listeners alive, one more per open.
function setup() {
  bookDataState.bookData = null;
  const transformTarget = new EventTarget();
  const live = new Set<EventListenerOrEventListenerObject>();
  const add = transformTarget.addEventListener.bind(transformTarget);
  const remove = transformTarget.removeEventListener.bind(transformTarget);
  transformTarget.addEventListener = (type, listener, options) => {
    if (listener) live.add(listener);
    add(type, listener, options);
  };
  transformTarget.removeEventListener = (type, listener, options) => {
    if (listener) live.delete(listener);
    remove(type, listener, options);
  };
  const props = {
    bookKey: 'test-book',
    bookDoc: { metadata: {}, transformTarget },
    config: {},
    gridInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    contentInsets: { top: 0, right: 0, bottom: 0, left: 0 },
  } as unknown as ComponentProps<typeof FoliateViewer>;
  return { live, props, transformTarget };
}

it('removes its transformTarget listeners when the reader closes', async () => {
  openGate.pending = null;
  const { live, props } = setup();
  const { unmount } = render(<FoliateViewer {...props} />);
  await waitFor(() => expect(live.size).toBeGreaterThan(0));
  unmount();
  expect(live.size).toBe(0);
});

it('leaves no transformTarget listeners when the reader closes while the book is opening', async () => {
  let finishOpen = () => {};
  openGate.pending = new Promise<void>((resolve) => {
    finishOpen = resolve;
  });
  openGate.started = false;
  const { live, props } = setup();
  const { unmount } = render(<FoliateViewer {...props} />);
  await waitFor(() => expect(openGate.started).toBe(true));
  unmount();
  finishOpen();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(live.size).toBe(0);
});

// Manifest media types are hand-written; a section must not dodge the
// sanitizers through casing, parameters, or an XML type that still renders
// as an active document.
async function transform(type: string, name: string, data: unknown) {
  openGate.pending = null;
  const { live, props, transformTarget } = setup();
  bookDataState.bookData = {
    bookDoc: { sections: [{ id: 'OPS/chapter.xml' }, { id: 'OPS/cover.svg' }] },
  };
  render(<FoliateViewer {...props} />);
  await waitFor(() => expect(live.size).toBeGreaterThan(0));
  const detail = { data, type, name };
  transformTarget.dispatchEvent(new CustomEvent('data', { detail }));
  const result = await detail.data;
  return { result, type: detail.type };
}

it('sanitizes an SVG section whose media type has odd casing and parameters', async () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>';
  const { result, type } = await transform('Image/SVG+xml; charset=utf-8', 'OPS/cover.svg', svg);
  expect(type).toBe('image/svg+xml');
  expect(result).not.toMatch(/script|onload/);
});

it('serves an XML section as plain text', async () => {
  const blob = new Blob(['<html xmlns="http://www.w3.org/1999/xhtml"><script/></html>']);
  const { result, type } = await transform('text/xml', 'OPS/chapter.xml', blob);
  expect(type).toBe('text/plain');
  expect(result).toBe(blob);
});

it('leaves the type of a non-section resource alone apart from normalizing it', async () => {
  const blob = new Blob(['font']);
  const { type } = await transform('application/vnd.ms-opentype', 'OPS/font.otf', blob);
  expect(type).toBe('application/vnd.ms-opentype');
});

// #7899: a stylesheet names `fonts/Bookerly.ttf` but the EPUB doesn't ship it.
// The user imported a custom font with that file name, so it stands in. When
// the custom font isn't loaded yet, foliate must wait for it rather than fall
// back to the missing file on the first load.
const FONT_BOOK: Record<string, string> = {
  'META-INF/container.xml': `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
  'OPS/book.opf': `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="id" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Fonts</dc:title><dc:identifier id="id">urn:uuid:7899</dc:identifier>
  </metadata>
  <manifest>
    <item id="c1" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
  </manifest>
  <spine><itemref idref="c1"/></spine>
</package>`,
  'OPS/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head><body><p>Text</p></body></html>`,
  'OPS/style.css': `@font-face { font-family: B; src: url(fonts/Bookerly.ttf); } p { color: red; }`,
};

// Opens FONT_BOOK in the viewer and returns the text of its first section's
// stylesheet, as foliate built it on the first load.
async function loadFontBookStylesheet(
  loadFont: (id: string) => Promise<{ blobUrl?: string }>,
  fonts: CustomFontStub[] = [{ id: 'bookerly', path: 'custom/Bookerly.ttf', loaded: false }],
) {
  const files = FONT_BOOK;
  const book = new EPUB({
    entries: Object.keys(files).map((filename) => ({ filename })),
    loadText: async (name: string) => files[name] ?? null,
    loadBlob: async (name: string) => (files[name] == null ? null : new Blob([files[name]!])),
    getSize: (name: string) => files[name]?.length ?? 0,
    sha1: undefined,
  });
  await book.init();

  fontState.availableFonts = fonts;
  fontState.loadFont = (_env, id) => loadFont(id);
  // jsdom has no object URLs; keep each blob so the stylesheet can be read back.
  const blobs = new Map<string, Blob>();
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = (blob: Blob) => {
    const url = `blob:test/${blobs.size}`;
    blobs.set(url, blob);
    return url;
  };
  URL.revokeObjectURL = () => {};
  try {
    openGate.pending = null;
    const { props } = setup();
    const addListener = vi.spyOn(book.transformTarget!, 'addEventListener');
    render(<FoliateViewer {...props} bookDoc={book as unknown as typeof props.bookDoc} />);
    await waitFor(() => expect(addListener).toHaveBeenCalledWith('load', expect.any(Function)));

    const section = book.sections![0] as unknown as { loadContent: () => Promise<string> };
    const html = await section.loadContent();
    const cssUrl = new DOMParser()
      .parseFromString(html, 'application/xhtml+xml')
      .querySelector('link')!
      .getAttribute('href')!;
    return await blobs.get(cssUrl)!.text();
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    fontState.availableFonts = [];
  }
}

it('uses a same-named custom font that is not loaded yet on the first load', async () => {
  const css = await loadFontBookStylesheet(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { blobUrl: 'blob:custom-bookerly' };
  });
  expect(css).toContain('url("blob:custom-bookerly")');
});

it('still loads the chapter when the custom font file cannot be read', async () => {
  const css = await loadFontBookStylesheet(async () => {
    throw new Error('Font file not found');
  });
  expect(css).toContain('p { color: red; }');
});

// A cloud-only font has no file on disk yet, so it can't stand in; a loaded
// font with the same file name can.
it('prefers a loaded same-named custom font over a cloud-only one', async () => {
  const fonts = [
    { id: 'remote', path: 'remote/Bookerly.ttf', unavailable: true },
    { id: 'local', path: 'local/bookerly.ttf', loaded: true, blobUrl: 'blob:local-bookerly' },
  ];
  const css = await loadFontBookStylesheet(async (id) => {
    const font = fonts.find((font) => font.id === id)!;
    if (!font.blobUrl) throw new Error('File not found');
    return font;
  }, fonts);
  expect(css).toContain('url("blob:local-bookerly")');
});
