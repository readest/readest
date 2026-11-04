import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import VocabularyView from '@/components/vocabulary/VocabularyView';
import { DropdownProvider } from '@/context/DropdownContext';
import { useVocabularyStore } from '@/store/vocabularyStore';
import { useLibraryStore } from '@/store/libraryStore';
import type { VocabularyEntry } from '@/services/vocabulary/types';
import type { Book } from '@/types/book';

const saveFile = vi.fn(async () => true);
const push = vi.fn();

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { saveFile } }),
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
