import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import VocabularyView from '@/components/vocabulary/VocabularyView';
import { DropdownProvider } from '@/context/DropdownContext';
import { useVocabularyStore } from '@/store/vocabularyStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useCustomDictionaryStore } from '@/store/customDictionaryStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { DictionaryProvider } from '@/services/dictionaries/types';
import type { VocabularyEntry } from '@/services/vocabulary/types';
import type { Book } from '@/types/book';
import { eventDispatcher } from '@/utils/event';

const FIELDS = ['Front', 'Back', 'Word', 'Language', 'Entry'];
const saveFile = vi.fn(async () => true);
const push = vi.fn();
const appService = { saveFile, isAndroidApp: false };

const anki = vi.hoisted(() => ({
  ankiStatus: vi.fn(),
  ankiRequestPermission: vi.fn(),
  ankiListDecks: vi.fn(),
  ankiReadDeck: vi.fn(),
  ankiAddNotes: vi.fn(),
  ankiUpdateTags: vi.fn(),
  ankiNoteType: vi.fn(),
  ankiUpgradeNoteType: vi.fn(),
  ankiSetEntries: vi.fn(),
}));
const dicts = vi.hoisted(() => ({ providers: [] as unknown[] }));
const account = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  plan: 'plus' as string | undefined,
}));

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService }),
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: account.user, token: account.user ? 'token' : null }),
}));
vi.mock('@/hooks/useQuotaStats', () => ({
  useQuotaStats: () => ({ userProfilePlan: account.plan, customizationPurchased: false }),
}));
// Android-only hooks (back-key interception) call the native bridge.
vi.mock('@/utils/bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/bridge')>()),
  interceptKeys: vi.fn(async () => {}),
}));
vi.mock('@/services/vocabulary/ankiDroid', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/vocabulary/ankiDroid')>()),
  ...anki,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/app/reader/components/annotator/DictionarySheet', () => ({
  default: ({ word }: { word: string }) => <div data-testid='dict-sheet' data-word={word} />,
}));
vi.mock('@/services/vocabulary/hintSources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/vocabulary/hintSources')>()),
  canAskAIForHint: async () => false,
  hintFromAI: vi.fn(),
  hintFromDictionary: vi.fn(async () => 'good fortune'),
}));
vi.mock('@/services/dictionaries/registry', () => ({
  getEnabledProviders: () => dicts.providers,
}));

const entry = (key: string, patch: Partial<VocabularyEntry>, bookHash = 'd'): VocabularyEntry => ({
  id: `en:${key}`,
  lang: 'en',
  key,
  word: key,
  state: 'none',
  occurrences: [
    { sentence: `The ${key} was here.`, at: 10, bookHash, bookTitle: 'Dune', cfi: 'epubcfi(/6/4)' },
  ],
  createdAt: 1,
  modifiedAt: 1,
  deletedAt: null,
  ...patch,
});

const seed = (entries: VocabularyEntry[]) =>
  useVocabularyStore.setState({
    entries: Object.fromEntries(entries.map((e) => [e.id, e])),
    loaded: true,
    version: 1,
  });

const listWords = () =>
  within(screen.getByRole('list', { name: 'Words' }))
    .getAllByRole('button')
    .map((b) => b.getAttribute('data-word'));

beforeEach(() => {
  seed([
    entry('spice', { state: 'learning', hint: '香料', occurrences: [] }),
    entry('sandworm', {}),
    entry('ball', {}, 'emma'),
  ]);
  useLibraryStore.setState({ library: [{ hash: 'd', title: 'Dune' } as Book] });
  saveFile.mockClear();
  push.mockClear();
  appService.isAndroidApp = false;
  localStorage.clear();
  account.user = { id: 'u1' };
  account.plan = 'plus';
  anki.ankiStatus.mockReset().mockResolvedValue({ installed: true, granted: true });
  anki.ankiRequestPermission.mockReset().mockResolvedValue(true);
  anki.ankiListDecks.mockReset().mockResolvedValue([{ id: 7, name: 'Readest Vocabulary' }]);
  anki.ankiReadDeck.mockReset().mockResolvedValue({ notes: [], cards: [] });
  anki.ankiAddNotes.mockReset().mockImplementation(async (notes: unknown[]) => notes.length);
  anki.ankiUpdateTags.mockReset().mockImplementation(async (notes: unknown[]) => notes.length);
  anki.ankiNoteType.mockReset().mockResolvedValue({ outdated: false, id: 5, fields: FIELDS });
  anki.ankiSetEntries.mockReset().mockImplementation(async (notes: unknown[]) => notes.length);
  dicts.providers = [];
  // Loading reads settings.json; the tests set the store directly.
  useCustomDictionaryStore.setState((state) => ({
    loadCustomDictionaries: async () => true,
    settings: { ...state.settings, ankiEntryProviderId: undefined },
  }));
  anki.ankiUpgradeNoteType.mockReset().mockImplementation(async (notes: unknown[]) => notes.length);
});
afterEach(() => cleanup());

describe('VocabularyView', () => {
  it('sorts the visible vocabulary by saved sentences, date added, or word', () => {
    // Each choice gives a different order, so none can stand in for another.
    const saved = (n: number, at: number) =>
      Array.from({ length: n }, (_, i) => ({ sentence: `Sentence ${i}.`, at: at - i }));
    seed([
      entry('apple', { createdAt: 1, occurrences: saved(2, 20) }),
      entry('zebra', { createdAt: 2, occurrences: saved(1, 30) }),
      entry('mango', { createdAt: 3, occurrences: saved(3, 10) }),
    ]);
    render(
      <DropdownProvider>
        <VocabularyView />
      </DropdownProvider>,
    );
    expect(listWords()).toEqual(['zebra', 'apple', 'mango']);
    const choose = (name: string) => {
      fireEvent.click(screen.getByRole('button', { name: 'Sort by' }));
      fireEvent.click(screen.getByRole('menuitem', { name: `${name} - OFF` }));
      return listWords();
    };
    expect(choose('Most Saved Sentences')).toEqual(['mango', 'apple', 'zebra']);
    expect(choose('Newest Added')).toEqual(['mango', 'zebra', 'apple']);
    expect(choose('Oldest Added')).toEqual(['apple', 'zebra', 'mango']);
    expect(choose('Alphabetical A-Z')).toEqual(['apple', 'mango', 'zebra']);
    expect(choose('Alphabetical Z-A')).toEqual(['zebra', 'mango', 'apple']);
    expect(choose('Last Looked Up')).toEqual(['zebra', 'apple', 'mango']);
  });

  it('filters the list by state', () => {
    render(<VocabularyView />);
    expect(listWords().sort()).toEqual(['ball', 'sandworm', 'spice']);
    fireEvent.click(screen.getByRole('button', { name: /^Learning/ }));
    expect(listWords()).toEqual(['spice']);
  });

  it('shows a word with its sentence and deletes it', () => {
    render(<VocabularyView />);
    fireEvent.click(screen.getByRole('button', { name: 'sandworm' }));
    const detail = screen.getByRole('region', { name: 'sandworm' });
    expect(within(detail).getByText('sandworm', { selector: 'b' })).toBeTruthy();
    fireEvent.click(within(detail).getByRole('button', { name: 'Delete' }));
    expect(listWords().sort()).toEqual(['ball', 'spice']);
    expect(useVocabularyStore.getState().entries['en:sandworm']!.deletedAt).toBeTruthy();
  });

  it('lets book text keep its own direction in a right-to-left interface', () => {
    render(<VocabularyView />);
    fireEvent.click(screen.getByRole('button', { name: 'sandworm' }));
    const detail = screen.getByRole('region', { name: 'sandworm' });
    expect(within(detail).getByRole('heading', { name: 'sandworm' }).getAttribute('dir')).toBe(
      'auto',
    );
    expect(
      within(detail).getByText('sandworm', { selector: 'b' }).closest('p')!.getAttribute('dir'),
    ).toBe('auto');
  });

  it('offers Open in book only for books still in the library', () => {
    render(<VocabularyView />);
    fireEvent.click(screen.getByRole('button', { name: 'sandworm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open in book' }));
    expect(push).toHaveBeenCalledWith(expect.stringContaining('cfi=epubcfi'), undefined);
    fireEvent.click(screen.getByRole('button', { name: 'ball' }));
    expect(screen.queryByRole('button', { name: 'Open in book' })).toBeNull();
  });

  it('saves an edited hint', () => {
    render(<VocabularyView />);
    fireEvent.click(screen.getByRole('button', { name: 'sandworm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Hint' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Hint' }), { target: { value: '沙虫' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(useVocabularyStore.getState().entries['en:sandworm']!.hint).toBe('沙虫');
  });

  it('saves the hint on Enter inside a Dialog that stops keydown', () => {
    // Dialog.tsx stops every keydown at its node; only capture listeners see it.
    const StopKeys = ({ children }: { children: React.ReactNode }) => (
      <div
        ref={(el) => {
          el?.addEventListener('keydown', (e) => e.stopPropagation());
        }}
      >
        {children}
      </div>
    );
    render(
      <StopKeys>
        <VocabularyView />
      </StopKeys>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'sandworm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Hint' }));
    const input = screen.getByRole('textbox', { name: 'Hint' });
    fireEvent.change(input, { target: { value: '沙虫' } });
    // WebKit reports the Enter that confirms an IME composition as keyCode 229.
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    expect(useVocabularyStore.getState().entries['en:sandworm']!.hint).toBeUndefined();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useVocabularyStore.getState().entries['en:sandworm']!.hint).toBe('沙虫');
  });

  it('fills the hint from a dictionary', async () => {
    render(<VocabularyView />);
    fireEvent.click(screen.getByRole('button', { name: 'sandworm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Hint' }));
    fireEvent.click(screen.getByRole('button', { name: 'From Dictionary' }));
    await waitFor(() =>
      expect((screen.getByRole('textbox', { name: 'Hint' }) as HTMLInputElement).value).toBe(
        'good fortune',
      ),
    );
  });

  it('brings the book chip fully into view before its picker opens', () => {
    // The chip sits last in a sideways-scrolling row; its picker lines up with
    // the chip's edge, so a half-hidden chip opens a half-hidden picker.
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<VocabularyView />);
    const select = screen.getByRole('combobox', { name: 'Book' });
    fireEvent.pointerDown(select);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    expect(scrollIntoView.mock.contexts[0]).toBe(select.parentElement);
  });

  it('offers a language filter only when words span languages', () => {
    render(<VocabularyView />);
    expect(screen.queryByRole('combobox', { name: 'Language' })).toBeNull();
    cleanup();
    seed([
      entry('sandworm', {}),
      entry('haus', { id: 'de:haus', lang: 'de' }),
      entry('baum', { id: 'de:baum', lang: 'de' }),
    ]);
    render(<VocabularyView />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), {
      target: { value: 'de' },
    });
    expect(listWords()).toEqual(['haus', 'baum']);
  });

  it('drops the language filter when its last word is deleted', () => {
    seed([entry('sandworm', {}), entry('haus', { id: 'de:haus', lang: 'de' })]);
    render(<VocabularyView />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), {
      target: { value: 'de' },
    });
    expect(listWords()).toEqual(['haus']);
    act(() => useVocabularyStore.getState().remove('de:haus'));
    expect(screen.queryByRole('combobox', { name: 'Language' })).toBeNull();
    expect(listWords()).toEqual(['sandworm']);
    // A German word coming back (a Sync pull) doesn't turn the filter back on.
    act(() => useVocabularyStore.getState().importWords([{ word: 'baum', lang: 'de' }]));
    expect((screen.getByRole('combobox', { name: 'Language' }) as HTMLSelectElement).value).toBe(
      '',
    );
    expect(listWords()).toEqual(expect.arrayContaining(['sandworm', 'baum']));
  });

  it('exports only the words the filters show', async () => {
    render(
      <DropdownProvider>
        <VocabularyView />
      </DropdownProvider>,
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Book' }), { target: { value: 'emma' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export CSV' }));
    await waitFor(() => expect(saveFile).toHaveBeenCalled());
    // Choosing a format closes the menu and its overlay.
    expect(screen.queryByRole('menuitem', { name: 'Export CSV' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Export' }).getAttribute('aria-expanded')).toBe(
      'false',
    );
    const [filename, content] = saveFile.mock.calls[0] as unknown as [string, string];
    expect(filename).toBe('readest-vocabulary.csv');
    expect(content).toContain('ball');
    expect(content).not.toContain('sandworm');
  });
});

const toastOf = (message: string) => ['toast', { type: 'success', message, timeout: 3000 }];
const syncButton = () => screen.findByRole('button', { name: 'Sync with Anki' });
const openMenu = (name: 'More' | 'Export') => fireEvent.click(screen.getByRole('button', { name }));
const settle = () => act(async () => new Promise((r) => setTimeout(r, 0)));

describe('VocabularyView Anki link', () => {
  beforeEach(() => {
    appService.isAndroidApp = true;
    // spice was met while reading, so Sync may send it.
    seed([
      entry('spice', { state: 'learning', hint: '香料' }),
      entry('sandworm', {}),
      entry('ball', {}, 'emma'),
    ]);
  });

  it('syncs only Learning words met while reading, tagged with their mark', async () => {
    seed([
      entry('spice', { state: 'learning' }),
      // Came in from another Anki deck: already in Anki, so it stays there.
      entry('kettle', { state: 'learning', occurrences: [] }),
      entry('sandworm', {}),
      entry('melange', { state: 'mastered' }),
    ]);
    renderWithMenu();
    fireEvent.click(await syncButton());
    await waitFor(() => expect(anki.ankiAddNotes).toHaveBeenCalled());
    const [notes] = anki.ankiAddNotes.mock.calls[0] as [
      { deck: string; fields: [string, string]; tags: string[] }[],
    ];
    expect(notes.map((n) => n.deck)).toEqual(['Readest Vocabulary::English']);
    expect(notes.map((n) => n.fields[0].match(/>(\w+)</)?.[1])).toEqual(['spice']);
    expect(notes[0]!.tags).toEqual(
      expect.arrayContaining(['readest::lang::en', 'readest::learning']),
    );
  });

  it('asks before giving an old note type its audio, then fills the notes Sync added', async () => {
    const dispatch = vi.spyOn(eventDispatcher, 'dispatch');
    anki.ankiNoteType.mockResolvedValue({ outdated: true, id: 5, fields: ['Front', 'Back'] });
    anki.ankiReadDeck.mockResolvedValue({
      notes: [{ id: 1, fields: ['<div>spice</div>', 'a drug'], tags: 'readest readest::lang::en' }],
      cards: [],
    });
    renderWithMenu();
    fireEvent.click(await syncButton());
    const prompt = await screen.findByRole('region', { name: 'Add Audio to Anki Cards' });
    expect(anki.ankiUpgradeNoteType).not.toHaveBeenCalled();
    expect(anki.ankiAddNotes).not.toHaveBeenCalled();
    fireEvent.click(within(prompt).getByRole('button', { name: 'Add Audio' }));
    await waitFor(() =>
      expect(anki.ankiUpgradeNoteType).toHaveBeenCalledWith([
        { id: 1, word: 'spice', language: 'en_US' },
      ]),
    );
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith(...toastOf('Added audio to {{count}} cards')),
    );
    expect(screen.queryByRole('region', { name: 'Add Audio to Anki Cards' })).toBeNull();
    dispatch.mockRestore();
  });

  it('reads the deck again after the prompt, which asks to sync AnkiDroid first', async () => {
    anki.ankiNoteType.mockResolvedValue({ outdated: true, id: 5, fields: ['Front', 'Back'] });
    renderWithMenu();
    fireEvent.click(await syncButton());
    const prompt = await screen.findByRole('region', { name: 'Add Audio to Anki Cards' });
    // While the prompt was open, AnkiWeb brought in spice's note from another device.
    anki.ankiReadDeck.mockResolvedValue({
      notes: [{ id: 9, fields: ['<div>spice</div>', 'a drug'], tags: 'readest readest::lang::en' }],
      cards: [],
    });
    fireEvent.click(within(prompt).getByRole('button', { name: 'Add Audio' }));
    await waitFor(() =>
      expect(anki.ankiUpgradeNoteType).toHaveBeenCalledWith([
        { id: 9, word: 'spice', language: 'en_US' },
      ]),
    );
    await waitFor(() => expect(anki.ankiUpdateTags).toHaveBeenCalled());
    expect(anki.ankiAddNotes).not.toHaveBeenCalled();
  });

  it('syncs without audio on Not now, stops asking, and offers it again from the menu', async () => {
    anki.ankiNoteType.mockResolvedValue({ outdated: true, id: 5, fields: ['Front', 'Back'] });
    renderWithMenu();
    const sync = await syncButton();
    fireEvent.click(sync);
    const prompt = await screen.findByRole('region', { name: 'Add Audio to Anki Cards' });
    fireEvent.click(within(prompt).getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(anki.ankiAddNotes).toHaveBeenCalledTimes(1));
    expect(anki.ankiUpgradeNoteType).not.toHaveBeenCalled();

    fireEvent.click(sync);
    await waitFor(() => expect(anki.ankiNoteType).toHaveBeenCalledTimes(2));
    await settle();
    expect(screen.queryByRole('region', { name: 'Add Audio to Anki Cards' })).toBeNull();

    openMenu('More');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add Audio to Anki Cards' }));
    await screen.findByRole('region', { name: 'Add Audio to Anki Cards' });
  });

  it('offers Add Audio only while no Sync is running', async () => {
    localStorage.setItem('readest-anki-audio-declined', '1');
    renderWithMenu();
    const sync = await syncButton();
    await waitFor(() => expect(anki.ankiReadDeck).toHaveBeenCalledTimes(1));
    let finish = () => {};
    anki.ankiReadDeck.mockImplementation(
      () => new Promise((resolve) => (finish = () => resolve({ notes: [], cards: [] }))),
    );
    fireEvent.click(sync);
    await waitFor(() => expect(anki.ankiReadDeck).toHaveBeenCalledTimes(2));
    openMenu('More');
    const item = screen.getByText('Add Audio to Anki Cards').closest('button')!;
    expect(item.disabled).toBe(true);
    fireEvent.click(item);
    expect(localStorage.getItem('readest-anki-audio-declined')).toBe('1');
    finish();
    await waitFor(() => expect(sync.hasAttribute('disabled')).toBe(false));
  });

  describe('dictionary entries on the cards (#7728)', () => {
    const lookups: string[] = [];
    const collins: DictionaryProvider = {
      id: 'stardict:collins',
      kind: 'stardict',
      label: 'Collins',
      lookup: async (word, ctx) => {
        lookups.push(word);
        ctx.container.innerHTML = `<p>${word} <a href="x">def</a></p>`;
        return { ok: true };
      },
    };
    const choose = (id: string | undefined) =>
      useCustomDictionaryStore.setState((state) => ({
        settings: { ...state.settings, ankiEntryProviderId: id },
      }));
    const readNote = (id: number, word: string, entry = '') => ({
      id,
      mid: 5,
      fields: [`<div>${word}</div>`, 'hint', word, 'en_US', entry],
      tags: 'readest readest::lang::en',
    });

    beforeEach(() => {
      lookups.length = 0;
      dicts.providers = [collins];
    });

    it("puts the chosen dictionary's entry on new cards and on older cards that have none", async () => {
      const dispatch = vi.spyOn(eventDispatcher, 'dispatch');
      choose('stardict:collins');
      renderWithMenu();
      const sync = await syncButton();
      await waitFor(() => expect(anki.ankiReadDeck).toHaveBeenCalledTimes(1));
      anki.ankiReadDeck.mockResolvedValue({
        notes: [readNote(1, 'kettle'), readNote(2, 'ladle', '<p>mine</p>')],
        cards: [],
      });
      fireEvent.click(sync);
      await waitFor(() => expect(anki.ankiSetEntries).toHaveBeenCalled());
      const [sent] = anki.ankiAddNotes.mock.calls[0] as [{ fields: string[] }[]];
      expect(sent.map((n) => n.fields[4])).toEqual(['<p>spice def</p>']);
      expect(anki.ankiSetEntries).toHaveBeenCalledWith([{ id: 1, entry: '<p>kettle def</p>' }]);
      expect(lookups).not.toContain('ladle');
      await waitFor(() =>
        expect(dispatch).toHaveBeenCalledWith(
          'toast',
          expect.objectContaining({
            message: expect.stringContaining('Added dictionary entries to {{count}} cards'),
          }),
        ),
      );
      dispatch.mockRestore();
    });

    it('reads the saved choice when the dictionaries were not loaded yet, as from the library', async () => {
      // A load stands in for reading settings.json: the store starts without the choice.
      useCustomDictionaryStore.setState({
        loadCustomDictionaries: async () => {
          choose('stardict:collins');
          return true;
        },
      });
      renderWithMenu();
      await syncButton();
      openMenu('More');
      fireEvent.click(screen.getByRole('menuitem', { name: /Dictionary for Anki Cards/ }));
      const panel = await screen.findByRole('region', { name: 'Dictionary for Anki Cards' });
      expect(
        (within(panel).getByRole('combobox', { name: 'Dictionary' }) as HTMLSelectElement).value,
      ).toBe('stardict:collins');
      fireEvent.click(within(panel).getByRole('button', { name: 'Cancel' }));

      choose(undefined);
      fireEvent.click(await syncButton());
      await waitFor(() => expect(anki.ankiAddNotes).toHaveBeenCalled());
      expect(lookups).toEqual(['spice']);
    });

    it('looks nothing up until a dictionary is chosen', async () => {
      anki.ankiReadDeck.mockResolvedValue({ notes: [readNote(1, 'kettle')], cards: [] });
      renderWithMenu();
      fireEvent.click(await syncButton());
      await waitFor(() => expect(anki.ankiAddNotes).toHaveBeenCalled());
      expect(lookups).toEqual([]);
      expect(anki.ankiSetEntries).not.toHaveBeenCalled();
    });

    it('looks up at most 30 words in one Sync, and goes on from there next time', async () => {
      choose('stardict:collins');
      anki.ankiReadDeck.mockResolvedValue({
        notes: Array.from({ length: 40 }, (_, i) => readNote(i + 1, `w${i}`)),
        cards: [],
      });
      renderWithMenu();
      fireEvent.click(await syncButton());
      await waitFor(() => expect(anki.ankiSetEntries).toHaveBeenCalled());
      expect(lookups).toHaveLength(30);
      // spice, the new card, comes first; the rest of the budget goes to older cards.
      expect(lookups[0]).toBe('spice');
      expect((anki.ankiSetEntries.mock.calls[0] as [unknown[]])[0]).toHaveLength(29);

      // The next Sync goes on after note 29, so words the dictionary lacks can't hold the rest back.
      lookups.length = 0;
      fireEvent.click(await syncButton());
      await waitFor(() => expect(anki.ankiSetEntries).toHaveBeenCalledTimes(2));
      expect(lookups.slice(0, 3)).toEqual(['spice', 'w29', 'w30']);
    });

    it('looks nothing up while the note type has no Entry field', async () => {
      choose('stardict:collins');
      localStorage.setItem('readest-anki-audio-declined', '1');
      anki.ankiNoteType.mockResolvedValue({ outdated: true, id: 5, fields: ['Front', 'Back'] });
      renderWithMenu();
      fireEvent.click(await syncButton());
      await waitFor(() => expect(anki.ankiAddNotes).toHaveBeenCalled());
      expect(lookups).toEqual([]);
      expect(anki.ankiSetEntries).not.toHaveBeenCalled();
    });

    it("doesn't send a word deleted while its entry was being looked up", async () => {
      const dispatch = vi.spyOn(eventDispatcher, 'dispatch');
      choose('stardict:collins');
      const deleting: DictionaryProvider = {
        ...collins,
        lookup: async (word, ctx) => {
          const { entries, remove } = useVocabularyStore.getState();
          remove(Object.values(entries).find((e) => e.word === word)!.id);
          return collins.lookup(word, ctx);
        },
      };
      dicts.providers = [deleting];
      renderWithMenu();
      fireEvent.click(await syncButton());
      await waitFor(() => expect(dispatch).toHaveBeenCalledWith('toast', expect.anything()));
      expect(lookups).toEqual(['spice']);
      expect(anki.ankiAddNotes).not.toHaveBeenCalled();
      dispatch.mockRestore();
    });

    it('tags a word with the mark it has after the entries are written', async () => {
      choose('stardict:collins');
      anki.ankiReadDeck.mockResolvedValue({ notes: [readNote(1, 'kettle')], cards: [] });
      // The reader marks the word Mastered while Sync writes the entries.
      anki.ankiSetEntries.mockImplementation(async (notes: unknown[]) => {
        act(() => useVocabularyStore.getState().setState('en:kettle', 'mastered'));
        return notes.length;
      });
      renderWithMenu();
      fireEvent.click(await syncButton());
      await waitFor(() => expect(anki.ankiUpdateTags).toHaveBeenCalled());
      expect(anki.ankiUpdateTags).toHaveBeenCalledWith([
        { id: 1, tags: ['readest', 'readest::lang::en', 'readest::mastered'] },
      ]);
    });

    it('opens on None when the saved dictionary is no longer enabled', async () => {
      choose('stardict:removed');
      renderWithMenu();
      await syncButton();
      openMenu('More');
      fireEvent.click(screen.getByRole('menuitem', { name: /Dictionary for Anki Cards/ }));
      const panel = await screen.findByRole('region', { name: 'Dictionary for Anki Cards' });
      expect(
        within(panel).getByRole('heading', { name: 'Dictionary for Anki Cards' }),
      ).toBeTruthy();
      expect(
        (within(panel).getByRole('combobox', { name: 'Dictionary' }) as HTMLSelectElement).value,
      ).toBe('');
      fireEvent.click(within(panel).getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(useCustomDictionaryStore.getState().settings.ankiEntryProviderId).toBeUndefined(),
      );
    });

    it('keeps the panel open and the old choice when the choice could not be saved', async () => {
      const dispatch = vi.spyOn(eventDispatcher, 'dispatch');
      type SettingsState = ReturnType<typeof useSettingsStore.getState>;
      const settingsStore = useSettingsStore.getState();
      useSettingsStore.setState({
        settings: { customDictionaries: [] } as unknown as SettingsState['settings'],
        setSettings: (s: SettingsState['settings']) => useSettingsStore.setState({ settings: s }),
        saveSettings: vi.fn().mockRejectedValue(new Error('disk full')),
      } as unknown as SettingsState);
      renderWithMenu();
      await syncButton();
      openMenu('More');
      fireEvent.click(screen.getByRole('menuitem', { name: /Dictionary for Anki Cards/ }));
      const panel = await screen.findByRole('region', { name: 'Dictionary for Anki Cards' });
      fireEvent.change(within(panel).getByRole('combobox', { name: 'Dictionary' }), {
        target: { value: 'stardict:collins' },
      });
      fireEvent.click(within(panel).getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(dispatch).toHaveBeenCalledWith(
          'toast',
          expect.objectContaining({ type: 'error', message: "Couldn't save" }),
        ),
      );
      expect(screen.getByRole('region', { name: 'Dictionary for Anki Cards' })).toBeTruthy();
      // Neither store keeps the choice that wasn't saved, so Sync doesn't use it.
      expect(useCustomDictionaryStore.getState().settings.ankiEntryProviderId).toBeUndefined();
      expect(
        useSettingsStore.getState().settings.dictionarySettings?.ankiEntryProviderId,
      ).toBeUndefined();
      useSettingsStore.setState(settingsStore);
      dispatch.mockRestore();
    });

    it('chooses the dictionary from the More menu', async () => {
      const save = vi
        .spyOn(useCustomDictionaryStore.getState(), 'saveCustomDictionaries')
        .mockResolvedValue();
      renderWithMenu();
      await syncButton();
      openMenu('More');
      fireEvent.click(screen.getByRole('menuitem', { name: /Dictionary for Anki Cards/ }));
      const panel = await screen.findByRole('region', { name: 'Dictionary for Anki Cards' });
      const select = within(panel).getByRole('combobox', {
        name: 'Dictionary',
      }) as HTMLSelectElement;
      expect(Array.from(select.options).map((o) => o.text)).toEqual(['None', 'Collins']);
      fireEvent.change(select, { target: { value: 'stardict:collins' } });
      fireEvent.click(within(panel).getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(useCustomDictionaryStore.getState().settings.ankiEntryProviderId).toBe(
          'stardict:collins',
        ),
      );
      expect(save).toHaveBeenCalled();
      expect(screen.queryByRole('region', { name: 'Dictionary for Anki Cards' })).toBeNull();
      save.mockRestore();
    });
  });

  it('pulls before pushing: a mature card makes a word Mastered and a deck-only note comes in', async () => {
    const dispatch = vi.spyOn(eventDispatcher, 'dispatch');
    renderWithMenu();
    const sync = await syncButton();
    // After the open-time pull, so the deck below is what Sync itself reads.
    await waitFor(() => expect(anki.ankiReadDeck).toHaveBeenCalledTimes(1));
    anki.ankiReadDeck.mockResolvedValue({
      notes: [
        { id: 1, fields: ['spice'], tags: ' readest readest::lang::en readest::learning ' },
        { id: 2, fields: ['kettle', 'a pot'], tags: '' },
      ],
      cards: [{ noteId: 1, cardType: 2, interval: 30 }],
    });
    fireEvent.click(sync);
    await waitFor(() => expect(anki.ankiUpdateTags).toHaveBeenCalled());
    const { entries } = useVocabularyStore.getState();
    expect(entries['en:spice']?.state).toBe('mastered');
    expect(entries['en:kettle']).toMatchObject({ state: 'learning', hint: 'a pot' });
    expect(anki.ankiUpdateTags).toHaveBeenCalledWith([
      { id: 1, tags: ['readest', 'readest::lang::en', 'readest::mastered'] },
      { id: 2, tags: ['readest::lang::en', 'readest::learning'] },
    ]);
    expect(anki.ankiAddNotes).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith(
        ...toastOf('Imported {{count}} new words · {{count}} now Mastered'),
      ),
    );
    dispatch.mockRestore();
  });

  it('keeps a word lowered after a mature card raised it, until the card matures again', async () => {
    const spice = { id: 1, fields: ['spice'], tags: 'readest::lang::en readest::learning' };
    const mature = { notes: [spice], cards: [{ noteId: 1, cardType: 2, interval: 30 }] };
    const state = () => useVocabularyStore.getState().entries['en:spice']?.state;
    anki.ankiReadDeck.mockResolvedValue(mature);
    renderWithMenu();
    await waitFor(() => expect(state()).toBe('mastered'));
    act(() => useVocabularyStore.getState().setState('en:spice', 'learning'));
    const sync = await syncButton();
    const syncOnce = async () => {
      anki.ankiUpdateTags.mockClear();
      fireEvent.click(sync);
      await waitFor(() => expect((sync as HTMLButtonElement).disabled).toBe(false));
      await settle();
    };
    await syncOnce();
    expect(state()).toBe('learning');
    expect(anki.ankiUpdateTags).not.toHaveBeenCalled();
    // The card lapses (the deck holds no mature card), then matures again.
    anki.ankiReadDeck.mockResolvedValue({ notes: [spice], cards: [] });
    await syncOnce();
    expect(state()).toBe('learning');
    anki.ankiReadDeck.mockResolvedValue(mature);
    await syncOnce();
    expect(state()).toBe('mastered');
    expect(anki.ankiUpdateTags).toHaveBeenCalledWith([
      { id: 1, tags: ['readest::lang::en', 'readest::mastered'] },
    ]);
  });

  it('remembers applied maturity only when it could read the cards', async () => {
    const spice = { id: 1, fields: ['spice'], tags: 'readest::lang::en readest::learning' };
    anki.ankiReadDeck.mockResolvedValue({
      notes: [spice],
      cards: [{ noteId: 1, cardType: 2, interval: 30 }],
    });
    renderWithMenu();
    await waitFor(() =>
      expect(useVocabularyStore.getState().entries['en:spice']?.state).toBe('mastered'),
    );
    act(() => useVocabularyStore.getState().setState('en:spice', 'learning'));
    // An AnkiDroid without the cards query reads nothing as mature.
    anki.ankiReadDeck.mockResolvedValue({ notes: [spice] });
    const sync = await syncButton();
    fireEvent.click(sync);
    await waitFor(() => expect((sync as HTMLButtonElement).disabled).toBe(false));
    anki.ankiReadDeck.mockResolvedValue({
      notes: [spice],
      cards: [{ noteId: 1, cardType: 2, interval: 30 }],
    });
    fireEvent.click(sync);
    await waitFor(() => expect(anki.ankiReadDeck).toHaveBeenCalledTimes(3));
    await settle();
    expect(useVocabularyStore.getState().entries['en:spice']?.state).toBe('learning');
  });

  it('reads back a word saved with odd spacing without adding it again', async () => {
    seed([entry('ice\u00a0cream', { state: 'learning' })]);
    anki.ankiReadDeck.mockResolvedValue({
      notes: [{ id: 1, fields: ['ice cream'], tags: 'readest::lang::en readest::learning' }],
      cards: [{ noteId: 1, cardType: 2, interval: 30 }],
    });
    renderWithMenu();
    fireEvent.click(await syncButton());
    await waitFor(() => expect(anki.ankiUpdateTags).toHaveBeenCalled());
    const { entries } = useVocabularyStore.getState();
    expect(Object.keys(entries)).toEqual(['en:ice\u00a0cream']);
    expect(entries['en:ice\u00a0cream']?.state).toBe('mastered');
    expect(anki.ankiAddNotes).not.toHaveBeenCalled();
    expect(anki.ankiUpdateTags).toHaveBeenCalledWith([
      { id: 1, tags: ['readest::lang::en', 'readest::mastered'] },
    ]);
  });

  it('files an untagged note under the word Readest already has, in any language', async () => {
    seed([
      entry('spice', { state: 'learning', occurrences: [] }),
      entry('pain', { id: 'fr:pain', lang: 'fr', state: 'learning' }),
    ]);
    anki.ankiReadDeck.mockResolvedValue({
      notes: [{ id: 1, fields: ['pain', 'bread'], tags: '' }],
      cards: [],
    });
    renderWithMenu();
    fireEvent.click(await syncButton());
    await waitFor(() => expect(anki.ankiUpdateTags).toHaveBeenCalled());
    const { entries } = useVocabularyStore.getState();
    expect(entries['en:pain']).toBeUndefined();
    expect(entries['fr:pain']?.hint).toBe('bread');
    expect(anki.ankiAddNotes).not.toHaveBeenCalled();
    expect(anki.ankiUpdateTags).toHaveBeenCalledWith([
      { id: 1, tags: ['readest::lang::fr', 'readest::learning'] },
    ]);
  });

  it('says when Anki is in sync', async () => {
    const dispatch = vi.spyOn(eventDispatcher, 'dispatch');
    anki.ankiReadDeck.mockResolvedValue({
      notes: [{ id: 1, fields: ['spice'], tags: 'readest::lang::en readest::learning' }],
      cards: [],
    });
    renderWithMenu();
    fireEvent.click(await syncButton());
    await waitFor(() => expect(dispatch).toHaveBeenCalledWith(...toastOf('In sync with Anki')));
    expect(anki.ankiAddNotes).not.toHaveBeenCalled();
    expect(anki.ankiUpdateTags).not.toHaveBeenCalled();
    dispatch.mockRestore();
  });

  it('does not say "already" in sync after it rewrote mark tags', async () => {
    const dispatch = vi.spyOn(eventDispatcher, 'dispatch');
    // Marked Mastered in Readest since the last Sync; only the tag moves.
    seed([entry('spice', { state: 'mastered' })]);
    anki.ankiReadDeck.mockResolvedValue({
      notes: [{ id: 1, fields: ['spice'], tags: 'readest::lang::en readest::learning' }],
      cards: [],
    });
    renderWithMenu();
    fireEvent.click(await syncButton());
    await waitFor(() => expect(dispatch).toHaveBeenCalledWith(...toastOf('In sync with Anki')));
    expect(anki.ankiUpdateTags).toHaveBeenCalledWith([
      { id: 1, tags: ['readest::lang::en', 'readest::mastered'] },
    ]);
    dispatch.mockRestore();
  });

  it('still syncs on an AnkiDroid without the cards query, and says to update it', async () => {
    const dispatch = vi.spyOn(eventDispatcher, 'dispatch');
    anki.ankiReadDeck.mockResolvedValue({ notes: [] });
    renderWithMenu();
    fireEvent.click(await syncButton());
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith(
        ...toastOf(
          'Added {{count}} words to Anki · Update AnkiDroid to bring back mastered words.',
        ),
      ),
    );
    dispatch.mockRestore();
  });

  it('pulls on open without asking or writing', async () => {
    const dispatch = vi.spyOn(eventDispatcher, 'dispatch');
    anki.ankiReadDeck.mockResolvedValue({
      notes: [{ id: 1, fields: ['spice'], tags: 'readest::lang::en' }],
      cards: [{ noteId: 1, cardType: 2, interval: 30 }],
    });
    renderWithMenu();
    await waitFor(() =>
      expect(useVocabularyStore.getState().entries['en:spice']?.state).toBe('mastered'),
    );
    expect(anki.ankiReadDeck).toHaveBeenCalledWith([7], true);
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith(...toastOf('{{count}} now Mastered')),
    );
    expect(anki.ankiRequestPermission).not.toHaveBeenCalled();
    expect(anki.ankiAddNotes).not.toHaveBeenCalled();
    expect(anki.ankiUpdateTags).not.toHaveBeenCalled();
    dispatch.mockRestore();
  });

  it('keeps pull on open quiet when nothing changed', async () => {
    const dispatch = vi.spyOn(eventDispatcher, 'dispatch');
    renderWithMenu();
    await waitFor(() => expect(anki.ankiReadDeck).toHaveBeenCalled());
    await settle();
    expect(dispatch).not.toHaveBeenCalledWith('toast', expect.anything());
    dispatch.mockRestore();
  });

  it('does not pull on open without access, or for a free account', async () => {
    anki.ankiStatus.mockResolvedValue({ installed: true, granted: false });
    renderWithMenu();
    await syncButton();
    await settle();
    cleanup();
    anki.ankiStatus.mockResolvedValue({ installed: true, granted: true });
    account.plan = 'free';
    renderWithMenu();
    await syncButton();
    await settle();
    expect(anki.ankiListDecks).not.toHaveBeenCalled();
    expect(anki.ankiRequestPermission).not.toHaveBeenCalled();
  });

  it('pulls once on open when the plan arrives after AnkiDroid answers', async () => {
    account.plan = undefined;
    const view = renderWithMenu();
    await syncButton();
    await settle();
    expect(anki.ankiListDecks).not.toHaveBeenCalled();
    account.plan = 'plus';
    for (let i = 0; i < 2; i++) {
      view.rerender(
        <DropdownProvider>
          <VocabularyView />
        </DropdownProvider>,
      );
      await settle();
    }
    expect(anki.ankiListDecks).toHaveBeenCalledTimes(1);
  });

  it('reads AnkiDroid status again on every sync', async () => {
    renderWithMenu();
    const sync = (await syncButton()) as HTMLButtonElement;
    for (let i = 0; i < 2; i++) {
      fireEvent.click(sync);
      await waitFor(() => expect(anki.ankiAddNotes).toHaveBeenCalledTimes(i + 1));
      await waitFor(() => expect(sync.disabled).toBe(false));
    }
    // Once on open, then once per sync.
    expect(anki.ankiStatus).toHaveBeenCalledTimes(3);
  });

  it('sends a free account to the plans page instead of syncing', async () => {
    account.plan = 'free';
    renderWithMenu();
    const sync = await syncButton();
    expect(sync.textContent).not.toContain('Premium');
    fireEvent.click(sync);
    expect(push).toHaveBeenCalledWith(expect.stringContaining('/user?redirect='));
    openMenu('More');
    expect(screen.getByRole('menuitem', { name: /Import Anki Deck/ }).textContent).toContain(
      'Premium',
    );
    expect(anki.ankiStatus).toHaveBeenCalledTimes(1);
  });

  it('imports a deck from the menu, bringing a mature new word in as Mastered', async () => {
    const dispatch = vi.spyOn(eventDispatcher, 'dispatch');
    // Access not granted yet, so nothing is pulled on open.
    anki.ankiStatus.mockResolvedValue({ installed: true, granted: false });
    anki.ankiReadDeck.mockResolvedValue({
      notes: [{ id: 1, fields: ['ephemeral', 'short-lived'], tags: '' }],
      cards: [{ noteId: 1, cardType: 2, interval: 30 }],
    });
    renderWithMenu();
    await syncButton();
    openMenu('More');
    fireEvent.click(screen.getByRole('menuitem', { name: /Import Anki Deck/ }));
    const deck = (await screen.findByRole('combobox', { name: 'Deck' })) as HTMLSelectElement;
    expect(deck.value).toBe('7');
    expect((screen.getByRole('combobox', { name: 'Language' }) as HTMLSelectElement).value).toBe(
      'en',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() =>
      expect(useVocabularyStore.getState().entries['en:ephemeral']).toMatchObject({
        state: 'mastered',
        hint: 'short-lived',
      }),
    );
    expect(anki.ankiReadDeck).toHaveBeenCalledWith([7], true);
    expect(screen.queryByRole('combobox', { name: 'Deck' })).toBeNull();
    expect(dispatch).toHaveBeenCalledWith(
      ...toastOf('Imported {{count}} new words · {{count}} now Mastered'),
    );
    dispatch.mockRestore();
  });

  it('stops when access to AnkiDroid is refused', async () => {
    const dispatch = vi.spyOn(eventDispatcher, 'dispatch');
    anki.ankiStatus.mockResolvedValue({ installed: true, granted: false });
    anki.ankiRequestPermission.mockResolvedValue(false);
    renderWithMenu();
    fireEvent.click(await syncButton());
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith(
        'toast',
        expect.objectContaining({
          message: 'Allow Readest to access AnkiDroid in system settings.',
        }),
      ),
    );
    expect(anki.ankiListDecks).not.toHaveBeenCalled();
    dispatch.mockRestore();
  });

  it('offers import on the empty screen', async () => {
    seed([]);
    renderWithMenu();
    expect(await screen.findByRole('button', { name: 'Import from Anki' })).toBeTruthy();
  });

  it('keeps the Anki file export where AnkiDroid is not available', async () => {
    appService.isAndroidApp = false;
    renderWithMenu();
    openMenu('Export');
    expect(screen.getByRole('menuitem', { name: /Export to Anki/ })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /Import Anki Deck/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sync with Anki' })).toBeNull();
    expect(anki.ankiStatus).not.toHaveBeenCalled();
  });

  it('keeps the Anki file export next to deck import when AnkiDroid is there', async () => {
    renderWithMenu();
    await syncButton();
    openMenu('More');
    expect(screen.getByRole('menuitem', { name: /Import Anki Deck/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: /Export to Anki/ }));
    await waitFor(() => expect(saveFile).toHaveBeenCalled());
    expect((saveFile.mock.calls[0] as unknown as [string])[0]).toBe('readest-vocabulary-anki.txt');
  });

  it('gates the Anki file export behind premium', () => {
    appService.isAndroidApp = false;
    account.plan = 'free';
    renderWithMenu();
    openMenu('Export');
    fireEvent.click(screen.getByRole('menuitem', { name: /Export to Anki/ }));
    expect(push).toHaveBeenCalledWith(expect.stringContaining('/user?redirect='));
    expect(saveFile).not.toHaveBeenCalled();
  });

  it('reads the Readest deck together with its subdecks', async () => {
    anki.ankiListDecks.mockResolvedValue([
      { id: 7, name: 'Readest Vocabulary' },
      { id: 8, name: 'Readest Vocabulary::Dune' },
      { id: 9, name: 'Readest Vocabulary 2' },
    ]);
    renderWithMenu();
    await waitFor(() => expect(anki.ankiReadDeck).toHaveBeenCalledWith([7, 8], true));
    fireEvent.click(await syncButton());
    await waitFor(() => expect(anki.ankiReadDeck).toHaveBeenCalledTimes(2));
    expect(anki.ankiReadDeck).toHaveBeenLastCalledWith([7, 8], true);
  });

  it('lets an entitled account sync while its plan is still loading', async () => {
    account.plan = undefined;
    const quota = await import('@/hooks/useQuotaStats');
    const spy = vi
      .spyOn(quota, 'useQuotaStats')
      .mockReturnValue({ userProfilePlan: undefined, customizationPurchased: true } as never);
    renderWithMenu();
    fireEvent.click(await syncButton());
    await waitFor(() => expect(anki.ankiAddNotes).toHaveBeenCalled());
    spy.mockRestore();
  });

  it('lets a signed-out reader on a self-hosted server use it', async () => {
    vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', 'true');
    account.user = null;
    account.plan = undefined;
    renderWithMenu();
    fireEvent.click(await syncButton());
    await waitFor(() => expect(anki.ankiAddNotes).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalled();
    openMenu('More');
    expect(screen.getByRole('menuitem', { name: /Import Anki Deck/ }).textContent).not.toContain(
      'Premium',
    );
    vi.unstubAllEnvs();
  });
});

const renderWithMenu = () =>
  render(
    <DropdownProvider>
      <VocabularyView />
    </DropdownProvider>,
  );
