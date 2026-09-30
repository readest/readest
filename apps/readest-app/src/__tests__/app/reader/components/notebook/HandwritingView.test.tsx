import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import HandwritingView from '@/app/reader/components/notebook/HandwritingView';
import type { BookConfig } from '@/types/book';

// `stored` mirrors the real store: setConfig merges a partial into the
// existing config ({ ...config, ...partial }) and saveConfig calls setConfig
// again for updatedAt. Modelling that here is what lets these tests catch a
// key-absent write that would silently keep the ink.
const h = vi.hoisted(() => ({
  config: undefined as BookConfig | undefined,
  stored: undefined as BookConfig | undefined,
  goTo: vi.fn(),
  setConfig: vi.fn(),
  saveConfig: vi.fn(async () => {}),
}));

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));

// Matches the app's real `stubTranslation`: it takes the key only and does no
// interpolation, so labels render as the raw key string.
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { globalReadSettings: {} } }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getConfig: () => h.config,
    setConfig: (_key: string, partial: Partial<BookConfig>) => {
      h.setConfig(_key, partial);
      // Real merge semantics: a key absent from `partial` survives.
      if (h.stored) h.stored = { ...h.stored, ...partial };
    },
    saveConfig: async (_env: unknown, _key: string, config: BookConfig) => {
      h.saveConfig();
      // saveConfig re-asserts the full config, then stamps updatedAt.
      h.stored = { ...config };
    },
  }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ getView: () => ({ goTo: h.goTo }) }),
}));

vi.mock('@/utils/event', () => ({ eventDispatcher: { dispatch: vi.fn() } }));

const page = (strokes: number) => ({
  strokes: Array.from({ length: strokes }, (_, i) => ({
    id: `s${i}`,
    color: '#000',
    width: 0.004,
    points: [[0.1, 0.1]] as [number, number][],
  })),
  updatedAt: 1,
});

beforeEach(() => {
  // Reset the spies, not the factories: clearAllMocks would strip the mocked
  // modules' implementations (getConfig/saveConfig), leaving the component
  // with an empty config and an empty cached row list.
  h.goTo.mockClear();
  h.setConfig.mockClear();
  h.saveConfig.mockClear();
  h.config = undefined;
  h.stored = undefined;
});

afterEach(cleanup);

const renderView = () => render(<HandwritingView bookKey='book-1' />);

describe('HandwritingView navigation', () => {
  it('shows an empty state when the book has no ink', () => {
    renderView();
    expect(screen.getByText('No Handwriting')).toBeTruthy();
  });

  it('lists a row per page with its stroke count', () => {
    h.stored = h.config = {
      handwriting: {
        version: 1,
        pages: { 'pdf:0': page(2), 'pdf:2': page(5) },
      },
    } as unknown as BookConfig;
    renderView();

    expect(screen.getAllByText('Page {{page}}')).toHaveLength(2);
    expect(screen.getAllByText('{{count}} strokes')).toHaveLength(2);
  });

  it('jumps to the page when a row is clicked', () => {
    h.stored = h.config = {
      handwriting: { version: 1, pages: { 'pdf:4': page(1) } },
    } as unknown as BookConfig;
    renderView();

    fireEvent.click(screen.getAllByRole('button', { name: /Go to handwriting on/ })[0]!);

    // A PDF page is its own spine item, so the stored page index is the target.
    expect(h.goTo).toHaveBeenCalledWith(4);
  });

  it('navigates to an EPUB section href, fragment included', () => {
    h.stored = h.config = {
      handwriting: {
        version: 1,
        pages: { 'epub:OEBPS/ch03.html#idm45692648148096': page(1) },
      },
    } as unknown as BookConfig;
    renderView();

    fireEvent.click(screen.getByRole('button', { name: /Go to handwriting on/ }));

    // The fragment is kept so the jump lands where the ink actually is, even
    // though the row's label shows only the file part.
    expect(h.goTo).toHaveBeenCalledWith('OEBPS/ch03.html#idm45692648148096');
  });

  it('labels an EPUB row by its file, not the raw fragment id', () => {
    h.stored = h.config = {
      handwriting: {
        version: 1,
        pages: { 'epub:OEBPS/ch03.html#idm45692648148096': page(1) },
      },
    } as unknown as BookConfig;
    renderView();

    expect(screen.getByText('OEBPS/ch03.html')).toBeTruthy();
    expect(screen.queryByText(/idm45692648148096/)).toBeNull();
  });

  it('orders PDF rows by page number', () => {
    h.stored = h.config = {
      handwriting: {
        version: 1,
        pages: { 'pdf:10': page(1), 'pdf:2': page(1), 'pdf:7': page(1) },
      },
    } as unknown as BookConfig;
    renderView();

    // Ordering is asserted through the navigation targets, which are not
    // translated: pdf:2 -> 2, pdf:7 -> 7, pdf:10 -> 10.
    const labels = screen.getAllByRole('button', { name: /Go to handwriting on/ });
    expect(labels).toHaveLength(3);
    fireEvent.click(labels[0]!);
    expect(h.goTo).toHaveBeenCalledWith(2);
    fireEvent.click(labels[2]!);
    expect(h.goTo).toHaveBeenCalledWith(10);
  });

  it('does nothing when the view is not open', () => {
    h.stored = h.config = {
      handwriting: { version: 1, pages: { 'pdf:0': page(1) } },
    } as unknown as BookConfig;
    vi.doMock('@/store/readerStore', () => ({ useReaderStore: () => ({ getView: () => null }) }));
    renderView();
    // No view means the click is a no-op rather than a throw.
    expect(() =>
      fireEvent.click(screen.getByRole('button', { name: /Go to handwriting on/ })),
    ).not.toThrow();
  });

  it('clears one page without touching the others', () => {
    h.stored = h.config = {
      handwriting: { version: 1, pages: { 'pdf:0': page(1), 'pdf:1': page(2) } },
    } as unknown as BookConfig;
    renderView();

    fireEvent.click(screen.getAllByRole('button', { name: /Clear handwriting on/ })[0]!);

    expect(Object.keys(h.stored?.handwriting?.pages ?? {})).toEqual(['pdf:1']);
  });

  it('clears every page at once', () => {
    h.stored = h.config = {
      handwriting: { version: 1, pages: { 'pdf:0': page(3), 'epub:a.xhtml': page(4) } },
    } as unknown as BookConfig;
    renderView();

    fireEvent.click(screen.getByRole('button', { name: /Clear All Handwriting/ }));

    // The stored config must read back as "no ink" after the save.
    expect(h.stored?.handwriting?.pages).toEqual({});
  });
});
