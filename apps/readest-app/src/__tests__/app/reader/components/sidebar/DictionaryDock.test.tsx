// @vitest-environment happy-dom
/**
 * The dictionary docked in the sidebar (#7730): the popup's Pin to Sidebar
 * button hands its lookup over, and the sidebar's Dictionary tab shows the
 * latest lookup and tells the reader it is on screen.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import type { DictionaryProvider } from '@/services/dictionaries/types';
import { useDictionaryDockStore } from '@/store/dictionaryDockStore';
import { useSettingsStore } from '@/store/settingsStore';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (value: number) => value }));
vi.mock('@/hooks/useKeyDownActions', () => ({ useKeyDownActions: vi.fn() }));
vi.mock('@/services/tts/wordPronouncer', () => ({
  pronounceWord: vi.fn().mockResolvedValue(undefined),
  warmWordAudio: vi.fn(),
  cancelWordPronounce: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: null }),
}));

// One dictionary whose entry links to another word, to follow a link in the popup.
const linking: DictionaryProvider = {
  id: 'test:linking',
  kind: 'builtin',
  label: 'Linking',
  lookup: async (word, ctx) => {
    const link = document.createElement('a');
    link.textContent = `see also: luck (from ${word})`;
    link.addEventListener('click', () => ctx.onNavigate?.('luck'));
    ctx.container.append(link);
    return { ok: true, headword: word };
  },
};
vi.mock('@/services/dictionaries/registry', () => ({
  getEnabledProviders: () => [linking],
  __resetRegistryForTests: vi.fn(),
  evictProvider: vi.fn(),
}));

import DictionaryPopup from '@/app/reader/components/annotator/DictionaryPopup';
import DictionaryView from '@/app/reader/components/sidebar/DictionaryView';

const passage = { before: 'It was pure ', after: '.', bookTitle: 'Luck' };
const capture = {
  lang: 'en',
  occurrence: { sentence: 'It was pure serendipity.', at: 100, bookHash: 'b1', cfi: 'c1' },
};

const title = () => screen.getByTestId('dict-title').textContent;

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => useDictionaryDockStore.setState({ lookup: null, isDocked: false }));
afterEach(cleanup);

describe('Pin to Sidebar in the dictionary popup', () => {
  const renderPopup = (onPin: (lookup: unknown) => void) =>
    render(
      <DictionaryPopup
        word='serendipity'
        lang='en'
        selection={passage}
        capture={capture}
        position={{ point: { x: 100, y: 100 }, dir: 'up' }}
        trianglePosition={{ point: { x: 200, y: 460 }, dir: 'up' }}
        popupWidth={480}
        popupHeight={360}
        onPin={onPin}
      />,
    );

  it('hands the lookup to the sidebar with its passage and sentence', () => {
    const onPin = vi.fn();
    renderPopup(onPin);

    fireEvent.click(screen.getByRole('button', { name: 'Pin to Sidebar' }));

    expect(onPin).toHaveBeenCalledWith({
      word: 'serendipity',
      lang: 'en',
      selection: passage,
      capture,
      contextOnly: undefined,
    });
  });

  it('hands over the word a link led to, without the passage it was not selected in', async () => {
    const onPin = vi.fn();
    renderPopup(onPin);
    const link = await screen.findByText('see also: luck (from serendipity)');

    act(() => {
      fireEvent.click(link);
    });
    expect(title()).toBe('luck');
    fireEvent.click(screen.getByRole('button', { name: 'Pin to Sidebar' }));

    expect(onPin).toHaveBeenCalledWith({
      word: 'luck',
      lang: 'en',
      capture: { lang: 'en' },
      contextOnly: undefined,
    });
  });
});

describe('the sidebar Dictionary tab', () => {
  it('says how to fill it before the first lookup', () => {
    render(<DictionaryView bookKey='book-1' />);
    expect(screen.queryByTestId('dict-title')).toBeNull();
    expect(screen.getByText('Look up a word to see its definitions here.')).toBeTruthy();
  });

  it('shows the latest lookup, starting each one fresh', async () => {
    useDictionaryDockStore.getState().setLookup({ word: 'serendipity', lang: 'en' });
    render(<DictionaryView bookKey='book-1' />);
    expect(title()).toBe('serendipity');

    act(() => {
      fireEvent.click(screen.getByText('see also: luck (from serendipity)'));
    });
    expect(title()).toBe('luck');

    // The same word looked up again in the book opens on that word, not on
    // the link followed from it.
    act(() => {
      useDictionaryDockStore.getState().setLookup({ word: 'serendipity', lang: 'en' });
    });
    expect(title()).toBe('serendipity');
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('has no Pin to Sidebar button of its own', () => {
    useDictionaryDockStore.getState().setLookup({ word: 'serendipity', lang: 'en' });
    render(<DictionaryView bookKey='book-1' />);
    expect(screen.queryByRole('button', { name: 'Pin to Sidebar' })).toBeNull();
  });

  it('takes the lookups while it is on screen', () => {
    const { unmount } = render(<DictionaryView bookKey='book-1' />);
    expect(useDictionaryDockStore.getState().isDocked).toBe(true);
    unmount();
    expect(useDictionaryDockStore.getState().isDocked).toBe(false);
  });

  it('opens Manage Dictionaries from its gear', () => {
    useDictionaryDockStore.getState().setLookup({ word: 'serendipity', lang: 'en' });
    render(<DictionaryView bookKey='book-1' />);

    fireEvent.click(screen.getByRole('button', { name: 'Manage Dictionaries' }));

    expect(useSettingsStore.getState()).toMatchObject({
      isSettingsDialogOpen: true,
      settingsDialogBookKey: 'book-1',
      activeSettingsItemId: 'settings.language.dictionaries.manage',
    });
  });
});
