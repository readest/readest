import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import VocabularyView from '@/components/vocabulary/VocabularyView';
import { DropdownProvider } from '@/context/DropdownContext';
import { useVocabularyStore } from '@/store/vocabularyStore';
import { useLibraryStore } from '@/store/libraryStore';
import type { VocabularyEntry } from '@/services/vocabulary/types';
import type { Book } from '@/types/book';
import { eventDispatcher } from '@/utils/event';

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
}));
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
vi.mock('@/services/vocabulary/hintSources', () => ({
  canAskAIForHint: async () => false,
  hintFromAI: vi.fn(),
  hintFromDictionary: vi.fn(async () => 'good fortune'),
}));
vi.mock('@/services/dictionaries/registry', () => ({ getEnabledProviders: () => [] }));

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
  account.user = { id: 'u1' };
  account.plan = 'plus';
  anki.ankiStatus.mockReset().mockResolvedValue({ installed: true, granted: true });
  anki.ankiRequestPermission.mockReset().mockResolvedValue(true);
  anki.ankiListDecks.mockReset().mockResolvedValue([{ id: 7, name: 'Readest Vocabulary' }]);
  anki.ankiReadDeck.mockReset().mockResolvedValue({ notes: [], cards: [] });
  anki.ankiAddNotes
    .mockReset()
    .mockImplementation(async (_deck: string, notes: unknown[]) => notes.length);
  anki.ankiUpdateTags.mockReset().mockImplementation(async (notes: unknown[]) => notes.length);
});
afterEach(() => cleanup());

describe('VocabularyView', () => {
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
    const [deck, notes] = anki.ankiAddNotes.mock.calls[0] as [
      string,
      { fields: [string, string]; tags: string[] }[],
    ];
    expect(deck).toBe('Readest Vocabulary');
    expect(notes.map((n) => n.fields[0].match(/>(\w+)</)?.[1])).toEqual(['spice']);
    expect(notes[0]!.tags).toEqual(
      expect.arrayContaining(['readest::lang::en', 'readest::learning']),
    );
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

  it('says when Anki is already in sync', async () => {
    const dispatch = vi.spyOn(eventDispatcher, 'dispatch');
    anki.ankiReadDeck.mockResolvedValue({
      notes: [{ id: 1, fields: ['spice'], tags: 'readest::lang::en readest::learning' }],
      cards: [],
    });
    renderWithMenu();
    fireEvent.click(await syncButton());
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith(...toastOf('Already in sync with Anki')),
    );
    expect(anki.ankiAddNotes).not.toHaveBeenCalled();
    expect(anki.ankiUpdateTags).not.toHaveBeenCalled();
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
