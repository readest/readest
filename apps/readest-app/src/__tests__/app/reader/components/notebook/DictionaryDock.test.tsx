// @vitest-environment happy-dom
/**
 * The dictionary docked in the Notebook (#7730): the popup's Pin to Notebook
 * button hands its lookup over, and the Notebook's Dictionary tab shows the
 * latest lookup and tells the reader it is on screen.
 */
import { StrictMode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { DictionaryLookupContext, DictionaryProvider } from '@/services/dictionaries/types';
import { useCustomDictionaryStore } from '@/store/customDictionaryStore';
import { useDictionaryDockStore } from '@/store/dictionaryDockStore';

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
// Over three dictionaries with results start folded.
const plain = (n: number): DictionaryProvider => ({
  id: `test:plain-${n}`,
  kind: 'builtin',
  label: `Plain ${n}`,
  lookup: async (word, ctx) => {
    ctx.container.append(`plain ${n}: ${word}`);
    return { ok: true, headword: word };
  },
});
const providers = vi.hoisted(() => ({ list: [] as DictionaryProvider[] }));
// The AI context dictionary: it streams part of an answer at once and the rest
// when the test says so.
const ai = vi.hoisted(() => ({ asked: [] as string[], finish: () => {} }));
vi.mock('@/services/dictionaries/providers/contextProvider', () => ({
  getContextTranslator: () => ({ id: 'ai-1', name: 'AI 1' }),
  contextProvider: {
    id: 'builtin:context',
    kind: 'builtin',
    label: 'Context Dictionary',
    lookup: (word: string, ctx: DictionaryLookupContext) =>
      new Promise((resolve) => {
        ai.asked.push(word);
        ctx.container.replaceChildren(`${word}: the answer so far`);
        ctx.onUpdate?.();
        ai.finish = () => {
          ctx.container.replaceChildren(`${word}: the whole answer`);
          resolve({ ok: true, headword: word, sourceLabel: 'AI 1' });
        };
      }),
  },
}));
vi.mock('@/store/customTranslatorStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/customTranslatorStore')>()),
  getLLMTranslators: () => [
    { id: 'ai-1', name: 'AI 1' },
    { id: 'ai-2', name: 'AI 2' },
  ],
}));
vi.mock('@/services/dictionaries/registry', () => ({
  getEnabledProviders: () => providers.list,
  __resetRegistryForTests: vi.fn(),
  evictProvider: vi.fn(),
}));

import DictionaryPopup from '@/app/reader/components/annotator/DictionaryPopup';
import DictionarySheet from '@/app/reader/components/annotator/DictionarySheet';
import DictionaryView from '@/app/reader/components/notebook/DictionaryView';

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
beforeEach(() => {
  providers.list = [linking];
  ai.asked = [];
  useDictionaryDockStore.setState({ lookup: null, isDocked: false });
  useCustomDictionaryStore.setState({ saveCustomDictionaries: vi.fn() });
});
afterEach(cleanup);

// The sheet too: a phone in landscape is wide enough to pin the Notebook (#7789).
describe.each([
  [
    'popup',
    (onPin: (lookup: unknown) => void) =>
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
      ),
  ],
  [
    'sheet',
    (onPin: (lookup: unknown) => void) =>
      render(
        <DictionarySheet
          word='serendipity'
          lang='en'
          selection={passage}
          capture={capture}
          onDismiss={vi.fn()}
          onPin={onPin}
        />,
      ),
  ],
])('Pin to Notebook in the dictionary %s', (_kind, renderPopup) => {
  it('hands the lookup to the Notebook with its passage and sentence', () => {
    const onPin = vi.fn();
    renderPopup(onPin);

    fireEvent.click(screen.getByRole('button', { name: 'Pin to Notebook' }));

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
    fireEvent.click(screen.getByRole('button', { name: 'Pin to Notebook' }));

    expect(onPin).toHaveBeenCalledWith({
      word: 'luck',
      lang: 'en',
      capture: { lang: 'en' },
      contextOnly: undefined,
    });
  });
});

describe('the Notebook Dictionary tab', () => {
  it('says how to fill it before the first lookup', () => {
    render(<DictionaryView />);
    expect(screen.queryByTestId('dict-title')).toBeNull();
    expect(screen.getByText('Look up a word to see its definitions here.')).toBeTruthy();
  });

  it('shows the latest lookup, starting each one fresh', async () => {
    useDictionaryDockStore.getState().setLookup({ word: 'serendipity', lang: 'en' });
    render(<DictionaryView />);
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

  it('has no Pin to Notebook button of its own', () => {
    useDictionaryDockStore.getState().setLookup({ word: 'serendipity', lang: 'en' });
    render(<DictionaryView />);
    expect(screen.queryByRole('button', { name: 'Pin to Notebook' })).toBeNull();
  });

  it('takes the lookups while it is on screen', () => {
    const { unmount } = render(<DictionaryView />);
    expect(useDictionaryDockStore.getState().isDocked).toBe(true);
    unmount();
    expect(useDictionaryDockStore.getState().isDocked).toBe(false);
  });

  // A tap that clears a selection in a definition is still a tap on the card;
  // in the Notebook it must not fold the card and lose the place (#7788).
  it('keeps an open card open when it is tapped', async () => {
    useDictionaryDockStore.getState().setLookup({ word: 'serendipity', lang: 'en' });
    render(<DictionaryView />);
    const card = screen.getByTestId('dict-card');
    await waitFor(() => expect(card.getAttribute('aria-expanded')).toBe('true'));

    fireEvent.click(card);

    expect(card.getAttribute('aria-expanded')).toBe('true');
  });

  it('still unfolds a folded card when it is tapped', async () => {
    providers.list = [plain(1), plain(2), plain(3), plain(4)];
    useDictionaryDockStore.getState().setLookup({ word: 'serendipity', lang: 'en' });
    render(<DictionaryView />);
    await screen.findByText('plain 4: serendipity');
    const card = screen.getAllByTestId('dict-card')[0]!;
    await waitFor(() => expect(card.getAttribute('aria-expanded')).toBe('false'));

    fireEvent.click(card);
    expect(card.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(card);
    expect(card.getAttribute('aria-expanded')).toBe('true');
  });

  // Closing the Notebook, or leaving the tab, while the AI is still answering
  // cancels the answer. It isn't asked again when the tab comes back, in this
  // book or another (#7971).
  describe('an AI answer', () => {
    const lookUp = (word: string) =>
      act(() => {
        useDictionaryDockStore.getState().setLookup({ word, lang: 'en', contextOnly: true });
      });
    const empty = 'Look up a word to see its definitions here.';

    it('is dropped when the tab closes before it finishes', async () => {
      lookUp('serendipity');
      const { unmount } = render(
        <StrictMode>
          <DictionaryView />
        </StrictMode>,
      );
      await screen.findByText('serendipity: the answer so far');
      const asked = ai.asked.length;

      unmount();
      render(<DictionaryView />);

      expect(screen.getByText(empty)).toBeTruthy();
      expect(ai.asked).toHaveLength(asked);
    });

    it('is kept once it has finished', async () => {
      lookUp('serendipity');
      const { unmount } = render(<DictionaryView />);
      await screen.findByText('serendipity: the answer so far');
      act(() => ai.finish());
      await screen.findByText('serendipity: the whole answer');

      unmount();
      render(<DictionaryView />);

      expect(title()).toBe('serendipity');
      expect(screen.queryByText(empty)).toBeNull();
    });

    it('is dropped when the tab closes while another AI is answering', async () => {
      lookUp('serendipity');
      const { unmount } = render(<DictionaryView />);
      await screen.findByText('serendipity: the answer so far');
      act(() => ai.finish());

      fireEvent.change(await screen.findByRole('combobox', { name: 'AI Translator' }), {
        target: { value: 'ai-2' },
      });
      await waitFor(() => expect(ai.asked).toHaveLength(2));
      await screen.findByText('serendipity: the answer so far');
      unmount();
      render(<DictionaryView />);

      expect(screen.getByText(empty)).toBeTruthy();
      expect(ai.asked).toHaveLength(2);
    });

    it('cut off by a new lookup leaves the new lookup on screen', async () => {
      lookUp('serendipity');
      render(<DictionaryView />);
      await screen.findByText('serendipity: the answer so far');

      lookUp('luck');

      await screen.findByText('luck: the answer so far');
      expect(title()).toBe('luck');
      expect(useDictionaryDockStore.getState().lookup?.word).toBe('luck');
    });
  });

  // The gear sits in the Notebook header instead (NotebookHeaderSettings.test.tsx).
  it('has no Manage Dictionaries gear of its own', () => {
    useDictionaryDockStore.getState().setLookup({ word: 'serendipity', lang: 'en' });
    render(<DictionaryView />);
    expect(screen.queryByRole('button', { name: 'Manage Dictionaries' })).toBeNull();
  });
});
