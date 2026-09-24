import { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BookshelvesDialog, {
  BookshelvesEditor,
  type BookshelvesEditorHandle,
} from '@/app/library/components/BookshelvesDialog';
import { eventDispatcher } from '@/utils/event';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { DEFAULT_SYSTEM_SETTINGS as partialSettings } from '@/services/constants';
import type { SystemSettings } from '@/types/settings';
const DEFAULT_SYSTEM_SETTINGS = partialSettings as SystemSettings;
import type { Book } from '@/types/book';
import type { BookshelfDefinition } from '@/types/bookshelf';
import type { ShelfSection } from '@/app/library/components/BookshelfStream';
import { createBookshelf, defaultBookshelves } from '@/services/bookshelves/definitions';
import { applyBookshelfDraft } from '@/services/bookshelves/state';
import { HlcGenerator } from '@/libs/crdt';

const save = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/utils/nav', () => ({ navigateToLibrary: vi.fn() }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/services/bookshelves/persistence', () => ({ saveBookshelfDraft: save }));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string, values?: Record<string, unknown>) =>
    s.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values?.[key] ?? '')),
}));
vi.mock('@/hooks/useMedianPageDurationSecs', () => ({ useMedianPageDurationsSecs: () => ({}) }));
vi.mock('@/app/library/components/BookItem', () => ({
  default: ({ book }: { book: Book }) => <span>{book.title}</span>,
}));
vi.mock('@/app/library/components/GroupItem', () => ({ default: () => null }));
vi.mock('@/app/library/components/BookshelfStream', () => ({
  default: ({ sections }: { sections: ShelfSection[] }) => (
    <div data-testid='preview'>
      {sections.map((s) => (
        <div key={s.definition.id} data-layout={s.definition.layout}>
          {s.items.map((b) => ('hash' in b ? <span key={b.hash}>{b.title}</span> : null))}
        </div>
      ))}
    </div>
  ),
}));
vi.mock('@/components/Dialog', () => ({
  default: ({
    isOpen,
    title,
    children,
    onClose,
  }: {
    isOpen: boolean;
    title: string;
    children: React.ReactNode;
    onClose: () => void;
  }) =>
    isOpen ? (
      <div role='dialog' aria-label={title}>
        <button type='button' aria-label={`Close ${title}`} onClick={onClose}>
          Close
        </button>
        {children}
      </div>
    ) : null,
}));
vi.mock('@/store/absServerStore', () => ({
  useABSServerStore: () => [],
  isAbsBookOrphaned: () => false,
}));

beforeEach(() => {
  localStorage.removeItem('lastBookshelfTab');
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  save.mockReset().mockResolvedValue(undefined);
  useSettingsStore.setState({ settings: { ...DEFAULT_SYSTEM_SETTINGS, libraryGroupBy: 'none' } });
  useLibraryStore.setState({
    library: Array.from({ length: 20 }, (_, i) => ({
      hash: `${i}`,
      title: `Book ${i}`,
      author: 'Writer',
      format: 'EPUB',
      createdAt: i,
      updatedAt: i,
    })),
  });
});
afterEach(async () => {
  cleanup();
  await act(async () => {});
  localStorage.removeItem('i18nextLng');
  localStorage.removeItem('lastBookshelfTab');
  vi.unstubAllGlobals();
});
describe('bookshelf editor', () => {
  it('remembers the selected shelf when the dialog is reopened after a remount', async () => {
    const { unmount } = render(<BookshelvesDialog />);
    await act(async () => {
      await eventDispatcher.dispatch('show-bookshelves');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Default' }));
    fireEvent.click(screen.getByLabelText('Close Manage Bookshelves'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    unmount();

    render(<BookshelvesDialog />);
    await act(async () => {
      await eventDispatcher.dispatch('show-bookshelves');
    });
    expect(screen.getByRole('button', { name: 'Default' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(save).not.toHaveBeenCalled();
  });
  it('falls back to the first shelf when the remembered shelf no longer exists', () => {
    localStorage.setItem('lastBookshelfTab', 'deleted-shelf');
    render(<BookshelvesEditor />);
    expect(
      screen.getByRole('button', { name: /^Recently read/ }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(localStorage.getItem('lastBookshelfTab')).toBe('recent');
  });
  it('previews Finished books ahead of an earlier exclusive shelf', () => {
    const base = defaultBookshelves(DEFAULT_SYSTEM_SETTINGS);
    const clock = new HlcGenerator('test');
    const audio: BookshelfDefinition = {
      ...createBookshelf('Audio shelf'),
      exclusive: true,
      filters: {
        type: 'group',
        match: 'all',
        children: [
          { type: 'rule', field: 'audio', kind: 'boolean', operator: 'equals', value: true },
        ],
      },
    };
    const state = applyBookshelfDraft(
      { rows: {} },
      base,
      [
        audio,
        ...base.map((s) => (s.id === 'finished' ? { ...s, enabled: true, exclusive: true } : s)),
      ],
      { userId: '', deviceId: 'test', next: () => clock.next() },
    ).state;
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, bookshelves: state },
    });
    useLibraryStore.setState({
      library: [
        {
          ...useLibraryStore.getState().library[0]!,
          format: 'ABS',
          readingStatus: 'finished',
        },
      ],
    });
    render(<BookshelvesEditor />);
    fireEvent.click(screen.getByRole('button', { name: 'Audio shelf' }));
    expect(screen.getByTestId('preview').textContent).toBe('');
    expect(screen.getByText('0 displayed · 1 matching · 1 excluded')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Finished books' }));
    expect(screen.getByTestId('preview').textContent).toBe('Book 0');
    expect(screen.getByText('1 displayed · 1 matching · 0 excluded')).toBeTruthy();
  });
  it('saves a relative date range and clears incompatible values when switching back to an exact date', async () => {
    const ref = createRef<BookshelvesEditorHandle>();
    render(<BookshelvesEditor ref={ref} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add bookshelf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    fireEvent.change(screen.getByLabelText('Filter field'), { target: { value: 'published' } });
    expect(screen.getByRole('option', { name: 'Within the last' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Filter comparison'), {
      target: { value: 'withinLast' },
    });
    fireEvent.change(screen.getByLabelText('Time period'), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText('Time unit'), { target: { value: 'months' } });
    await act(async () => {
      await ref.current!.flush();
    });
    expect(save.mock.calls.at(-1)?.[2][1].filters.children[0]).toMatchObject({
      field: 'published',
      operator: 'withinLast',
      value: 6,
      unit: 'months',
    });
    fireEvent.change(screen.getByLabelText('Time period'), { target: { value: '' } });
    await act(async () => {
      await ref.current!.flush();
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert').textContent).toContain('Complete every filter condition.');
    fireEvent.change(screen.getByLabelText('Filter comparison'), { target: { value: 'gte' } });
    expect(screen.queryByLabelText('Time unit')).toBeNull();
    const date = screen.getByLabelText('Filter value') as HTMLInputElement;
    expect(date.type).toBe('date');
    expect(date.value).toBe('');
    fireEvent.change(date, { target: { value: '2025-01-01' } });
    await act(async () => {
      await ref.current!.flush();
    });
    expect(save.mock.calls.at(-1)?.[2][1].filters.children[0]).toMatchObject({
      operator: 'gte',
      value: '2025-01-01',
      unit: undefined,
    });
  });
  it('inherits grouping and retains each shelf’s independent choice', async () => {
    render(<BookshelvesEditor />);
    const grouping = screen.getByRole('group', { name: 'Grouping' });
    const inherit = within(grouping).getByLabelText('Use global grouping') as HTMLInputElement;
    const groupBy = within(grouping).getByLabelText('Group by') as HTMLSelectElement;
    expect(inherit.checked).toBe(true);
    expect(groupBy.disabled).toBe(true);
    expect(groupBy.value).toBe('none');
    expect(Array.from(groupBy.options, (option) => option.text)).toEqual([
      'Authors',
      'Books',
      'Groups',
      'Series',
      'Tags',
      'Subjects',
      'Status',
    ]);
    fireEvent.click(inherit);
    fireEvent.change(groupBy, { target: { value: 'author' } });
    fireEvent.click(inherit);
    act(() =>
      useSettingsStore.setState({
        settings: { ...useSettingsStore.getState().settings, libraryGroupBy: 'status' },
      }),
    );
    expect(groupBy.value).toBe('status');
    expect(groupBy.disabled).toBe(true);
    fireEvent.click(inherit);
    expect(groupBy.value).toBe('author');
    expect(groupBy.disabled).toBe(false);
    await waitFor(() =>
      expect(save.mock.calls.at(-1)?.[2][0]).toMatchObject({
        useGlobalGrouping: false,
        groupBy: 'author',
      }),
    );
  });
  it('saves cover sizing independently for the selected shelf', async () => {
    render(<BookshelvesEditor />);
    fireEvent.change(screen.getByLabelText('Book covers'), { target: { value: 'fit' } });
    await waitFor(() => expect(save.mock.calls.at(-1)?.[2][0]).toMatchObject({ coverFit: 'fit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Default' }));
    expect((screen.getByLabelText('Book covers') as HTMLSelectElement).value).toBe('crop');
    fireEvent.click(screen.getByRole('button', { name: /^Recently read/ }));
    expect((screen.getByLabelText('Book covers') as HTMLSelectElement).value).toBe('fit');
  });
  it('saves skeuomorphic covers independently while preserving the previous appearance', async () => {
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, librarySkeuomorphicCovers: true },
    });
    render(<BookshelvesEditor />);
    expect((screen.getByLabelText('Skeuomorphic covers') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText('Skeuomorphic covers'));
    await waitFor(() =>
      expect(save.mock.calls.at(-1)?.[2][0]).toMatchObject({ skeuomorphicCovers: false }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Default' }));
    expect((screen.getByLabelText('Skeuomorphic covers') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /^Recently read/ }));
    expect((screen.getByLabelText('Skeuomorphic covers') as HTMLInputElement).checked).toBe(false);
    expect(useSettingsStore.getState().settings.librarySkeuomorphicCovers).toBe(true);
  });
  it('inherits global sorting by default and retains independent settings when toggled', async () => {
    render(<BookshelvesEditor />);
    fireEvent.click(screen.getByRole('button', { name: 'Add bookshelf' }));
    const sorting = screen.getByRole('group', { name: 'Sorting' });
    const inherit = within(sorting).getByLabelText('Use global sorting') as HTMLInputElement;
    expect(inherit.checked).toBe(true);
    for (const label of ['Sort by', 'Ascending', 'Then by', 'Secondary sort ascending']) {
      expect((within(sorting).getByLabelText(label) as HTMLInputElement).disabled).toBe(true);
    }
    fireEvent.click(inherit);
    expect((screen.getByLabelText('Sort by') as HTMLSelectElement).value).toBe('updated');
    expect((screen.getByLabelText('Ascending') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('Then by') as HTMLSelectElement).value).toBe('none');
    expect((screen.getByLabelText('Secondary sort ascending') as HTMLInputElement).checked).toBe(
      true,
    );
    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'title' } });
    fireEvent.change(screen.getByLabelText('Then by'), { target: { value: 'author' } });
    expect((screen.getByLabelText('Secondary sort ascending') as HTMLInputElement).disabled).toBe(
      false,
    );
    fireEvent.click(inherit);
    act(() =>
      useSettingsStore.setState({
        settings: {
          ...useSettingsStore.getState().settings,
          librarySortBy: 'created',
          librarySortAscending: true,
          libraryThenSortBy: 'progress',
          libraryThenSortAscending: false,
        },
      }),
    );
    expect((screen.getByLabelText('Sort by') as HTMLSelectElement).value).toBe('created');
    expect((screen.getByLabelText('Then by') as HTMLSelectElement).value).toBe('progress');
    expect((screen.getByLabelText('Ascending') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Secondary sort ascending') as HTMLInputElement).checked).toBe(
      false,
    );
    await waitFor(() =>
      expect(screen.getByTestId('preview').querySelector('span')?.textContent).toBe('Book 0'),
    );
    fireEvent.click(inherit);
    expect((screen.getByLabelText('Sort by') as HTMLSelectElement).value).toBe('title');
    expect((screen.getByLabelText('Then by') as HTMLSelectElement).value).toBe('author');
    expect((screen.getByLabelText('Ascending') as HTMLInputElement).checked).toBe(false);
    await waitFor(() =>
      expect(save.mock.calls.at(-1)?.[2][1]).toMatchObject({
        useGlobalSort: false,
        sort: { by: 'title', thenBy: 'author', ascending: false },
      }),
    );
  });
  it('automatically saves valid changes without Save or Cancel actions', async () => {
    render(<BookshelvesEditor />);
    fireEvent.click(screen.getByLabelText('Hide covers'));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect((save.mock.calls.at(-1)![2] as BookshelfDefinition[])[0]!.hideCovers).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });
  it('starts Default without Carousel and inserts numbered carousel shelves after Recently read', async () => {
    render(<BookshelvesEditor />);
    fireEvent.click(screen.getByRole('button', { name: 'Default' }));
    expect((screen.getByLabelText('Carousel layout') as HTMLInputElement).checked).toBe(false);
    for (const number of [1, 2]) {
      fireEvent.click(screen.getByRole('button', { name: 'Add bookshelf' }));
      expect(
        screen
          .getByRole('button', { name: `New bookshelf ${number}` })
          .getAttribute('aria-pressed'),
      ).toBe('true');
      expect((screen.getByLabelText('Carousel layout') as HTMLInputElement).checked).toBe(true);
    }
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const draft = save.mock.calls.at(-1)![2] as BookshelfDefinition[];
    expect(draft.map((s) => s.name || s.id)).toEqual([
      'recent',
      'New bookshelf 2',
      'New bookshelf 1',
      'audiobooks',
      'podcasts',
      'default',
      'finished',
    ]);
  });
  it('continues numbering existing shelves and inserts after Recently read even when renamed and moved', async () => {
    const base = defaultBookshelves(DEFAULT_SYSTEM_SETTINGS);
    const clock = new HlcGenerator('test');
    const existing = createBookshelf('New bookshelf 1');
    const state = applyBookshelfDraft(
      { rows: {} },
      base,
      [
        base.find((s) => s.id === 'default')!,
        existing,
        { ...base[0]!, name: 'Reading now' },
        ...base.filter((s) => !['recent', 'default'].includes(s.id)),
      ],
      { userId: '', deviceId: 'test', next: () => clock.next() },
    ).state;
    useSettingsStore.setState({ settings: { ...DEFAULT_SYSTEM_SETTINGS, bookshelves: state } });
    render(<BookshelvesEditor />);
    fireEvent.click(screen.getByRole('button', { name: 'Add bookshelf' }));
    expect(screen.getByRole('button', { name: 'New bookshelf 2' })).toBeTruthy();
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const draft = save.mock.calls.at(-1)![2] as BookshelfDefinition[];
    expect(draft.map((s) => s.name || s.id)).toEqual([
      'default',
      'New bookshelf 1',
      'Reading now',
      'New bookshelf 2',
      'audiobooks',
      'podcasts',
      'finished',
    ]);
  });
  it('confirms deletion before automatically persisting its removal', async () => {
    render(<BookshelvesEditor />);
    fireEvent.click(screen.getByRole('button', { name: 'Add bookshelf' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const confirmation = screen.getByRole('dialog', { name: 'Delete bookshelf?' });
    expect(screen.getByRole('button', { name: 'New bookshelf 1' })).toBeTruthy();
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Delete bookshelf?' })).toBeNull();
    expect(screen.getByRole('button', { name: 'New bookshelf 1' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Delete bookshelf?' })).getByRole('button', {
        name: 'Delete',
      }),
    );
    expect(screen.queryByRole('button', { name: 'New bookshelf 1' })).toBeNull();
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect((save.mock.calls.at(-1)![2] as BookshelfDefinition[]).map((s) => s.id)).toEqual([
      'recent',
      'audiobooks',
      'podcasts',
      'default',
      'finished',
    ]);
  });
  it('confirms reset and restores only the selected shelf, preserving its name and position', async () => {
    const ref = createRef<BookshelvesEditorHandle>();
    render(<BookshelvesEditor ref={ref} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add bookshelf' }));
    fireEvent.click(screen.getByLabelText('Hide covers'));
    fireEvent.click(screen.getByLabelText('Carousel layout'));
    fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    fireEvent.change(screen.getByLabelText('Filter value'), { target: { value: 'Book' } });
    fireEvent.click(screen.getByLabelText(/^Exclusive/));
    await act(async () => {
      await ref.current!.flush();
    });
    const edited = save.mock.calls.at(-1)![2] as BookshelfDefinition[];
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Reset bookshelf?' })).getByRole('button', {
        name: 'Cancel',
      }),
    );
    expect((screen.getByLabelText('Hide covers') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Reset bookshelf?' })).getByRole('button', {
        name: 'Reset',
      }),
    );
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    const reset = save.mock.calls.at(-1)![2] as BookshelfDefinition[];
    expect(reset[1]).toEqual({
      ...createBookshelf(edited[1]!.name, edited[1]!.id),
      filters: edited[1]!.filters,
      exclusive: true,
      includeExclusiveBooks: false,
    });
    expect(reset.filter((s) => s.id !== edited[1]!.id)).toEqual(
      edited.filter((s) => s.id !== edited[1]!.id),
    );
  });
  it('keeps autosaving other shelves while one shelf has an incomplete condition', async () => {
    render(<BookshelvesEditor />);
    fireEvent.click(screen.getByRole('button', { name: 'Add bookshelf' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const added = (save.mock.calls.at(-1)![2] as BookshelfDefinition[])[1]!;
    fireEvent.click(screen.getByRole('button', { name: 'Add filter group' }));
    expect(screen.getByRole('alert').textContent).toContain('Complete every filter condition.');
    fireEvent.click(screen.getByRole('button', { name: 'Default' }));
    fireEvent.click(screen.getByLabelText('Hide covers'));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    const draft = save.mock.calls.at(-1)![2] as BookshelfDefinition[];
    expect(draft.find((s) => s.id === 'default')?.hideCovers).toBe(true);
    expect(draft.find((s) => s.id === added.id)).toEqual(added);
    expect(screen.getByRole('alert').textContent).toContain('Complete every filter condition.');
  });
  it('restores the previous include setting when Exclusive is turned back off', async () => {
    render(<BookshelvesEditor />);
    const include = screen.getByLabelText(
      'Include books from exclusive shelves',
    ) as HTMLInputElement;
    expect(include.checked).toBe(true);
    fireEvent.click(screen.getByLabelText(/^Exclusive/));
    expect(include.checked).toBe(false);
    expect(include.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/^Exclusive/));
    expect(include.checked).toBe(true);
    expect(include.disabled).toBe(false);
    fireEvent.click(screen.getByLabelText('Hide covers'));
    await waitFor(() =>
      expect(save.mock.calls.at(-1)?.[2][0]).toMatchObject({
        exclusive: false,
        includeExclusiveBooks: true,
      }),
    );
  });
  it('moves focus to Add condition after removing a condition', () => {
    render(<BookshelvesEditor />);
    fireEvent.click(screen.getByRole('button', { name: 'Add bookshelf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove condition' })[0]!);
    expect(screen.getAllByRole('button', { name: 'Remove condition' })).toHaveLength(1);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add condition' }));
  });
  it('describes each shelf tab as a whole sentence', () => {
    render(<BookshelvesEditor />);
    expect(screen.getByRole('button', { name: 'Default' }).title).toBe('Default · Drag to reorder');
    expect(screen.getByRole('button', { name: /^Finished books/ }).title).toBe(
      'Finished books (disabled) · Drag to reorder',
    );
  });
  it('focuses the newly selected tab after a confirmed deletion', async () => {
    render(<BookshelvesEditor />);
    fireEvent.click(screen.getByRole('button', { name: 'Add bookshelf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Delete bookshelf?' })).getByRole('button', {
        name: 'Delete',
      }),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Default' })),
    );
    expect(localStorage.getItem('lastBookshelfTab')).toBe('default');
  });
  it('stays open until an edit made while closing has been saved', async () => {
    let finishFirst!: () => void;
    let finishSecond!: () => void;
    save
      .mockImplementationOnce(() => new Promise<void>((resolve) => (finishFirst = resolve)))
      .mockImplementationOnce(() => new Promise<void>((resolve) => (finishSecond = resolve)));
    render(<BookshelvesDialog />);
    await act(async () => {
      await eventDispatcher.dispatch('show-bookshelves');
    });
    fireEvent.click(screen.getByLabelText('Hide covers'));
    fireEvent.click(screen.getByLabelText('Close Manage Bookshelves'));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByLabelText('Carousel layout'));
    await act(async () => {
      finishFirst();
    });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]![2][0]).toMatchObject({ hideCovers: true, layout: 'grid' });
    expect(screen.getByRole('dialog', { name: 'Manage Bookshelves' })).toBeTruthy();
    await act(async () => {
      finishSecond();
    });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Manage Bookshelves' })).toBeNull(),
    );
  });
  it('restores builtin filters without disabling the last enabled shelf', async () => {
    const base = defaultBookshelves(DEFAULT_SYSTEM_SETTINGS);
    const clock = new HlcGenerator('test');
    const state = applyBookshelfDraft(
      { rows: {} },
      base,
      base.map((s) => ({
        ...s,
        enabled: s.id === 'finished',
        exclusive: false,
        filters: { type: 'group', match: 'all', children: [] },
      })),
      { userId: '', deviceId: 'test', next: () => clock.next() },
    ).state;
    useSettingsStore.setState({ settings: { ...DEFAULT_SYSTEM_SETTINGS, bookshelves: state } });
    render(<BookshelvesEditor />);
    fireEvent.click(screen.getByRole('button', { name: 'Finished books' }));
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Reset bookshelf?' })).getByRole('button', {
        name: 'Reset',
      }),
    );
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(
      (save.mock.calls.at(-1)![2] as BookshelfDefinition[]).find((s) => s.id === 'finished'),
    ).toMatchObject({
      enabled: true,
      filters: defaultBookshelves({}).find((s) => s.id === 'finished')!.filters,
    });
  });
  it('renames inside the tab, supports cancelling edits, and saves the final name', async () => {
    render(<BookshelvesEditor />);
    expect(screen.queryByLabelText('Bookshelf name')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Default' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rename bookshelf' }));
    const input = screen.getByLabelText('Bookshelf name');
    expect(screen.getByRole('group', { name: 'Bookshelves' }).contains(input)).toBe(true);
    fireEvent.change(input, { target: { value: 'My library' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Default' })).toBeTruthy();
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Default' }));
    fireEvent.change(screen.getByLabelText('Bookshelf name'), { target: { value: 'My library' } });
    fireEvent.keyDown(screen.getByLabelText('Bookshelf name'), { key: 'Enter' });
    expect(screen.getByRole('button', { name: 'My library' })).toBeTruthy();
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(
      (save.mock.calls.at(-1)![2] as BookshelfDefinition[]).find((s) => s.id === 'default')?.name,
    ).toBe('My library');
  });
  it('saves cover visibility for the selected shelf independently', async () => {
    render(<BookshelvesEditor />);
    fireEvent.click(screen.getByRole('button', { name: 'Add bookshelf' }));
    fireEvent.click(screen.getByLabelText('Hide covers'));
    fireEvent.click(screen.getByRole('button', { name: 'Default' }));
    expect((screen.getByLabelText('Hide covers') as HTMLInputElement).checked).toBe(false);
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const draft = save.mock.calls.at(-1)![2] as BookshelfDefinition[];
    expect(draft.find((s) => s.name === 'New bookshelf 1')?.hideCovers).toBe(true);
    expect(draft.find((s) => s.id === 'default')?.hideCovers).toBe(false);
  });
  it('uses the library language for preview sorting', async () => {
    localStorage.setItem('i18nextLng', 'sv');
    useLibraryStore.setState({
      library: useLibraryStore
        .getState()
        .library.slice(0, 3)
        .map((book, index) => ({
          ...book,
          title: ['Äpple', 'Zebra', 'Apple'][index]!,
        })),
    });
    render(<BookshelvesEditor />);
    fireEvent.click(screen.getByRole('button', { name: 'Add bookshelf' }));
    fireEvent.click(screen.getByLabelText('Use global sorting'));
    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'title' } });
    fireEvent.click(screen.getByLabelText('Ascending'));
    await waitFor(() =>
      expect(
        Array.from(screen.getByTestId('preview').querySelectorAll('span'), (el) => el.textContent),
      ).toEqual(['Apple', 'Zebra', 'Äpple']),
    );
  });
  it('includes all books when switching layouts and saves automatically', async () => {
    render(<BookshelvesEditor />);
    fireEvent.click(screen.getByRole('button', { name: 'Add bookshelf' }));
    expect(screen.queryByLabelText('Book limit')).toBeNull();
    expect(screen.queryByLabelText('Layout')).toBeNull();
    fireEvent.click(screen.getByLabelText('Carousel layout'));
    expect(screen.queryByLabelText('Book limit')).toBeNull();
    await waitFor(() =>
      expect(screen.getByText('20 displayed · 20 matching · 0 excluded')).toBeTruthy(),
    );
    for (const mode of ['grid', 'list'] as const) {
      act(() =>
        useSettingsStore.setState({
          settings: { ...useSettingsStore.getState().settings, libraryViewMode: mode },
        }),
      );
      await waitFor(() =>
        expect(screen.getByTestId('preview').firstElementChild?.getAttribute('data-layout')).toBe(
          mode,
        ),
      );
    }
    fireEvent.click(screen.getByLabelText('Carousel layout'));
    await waitFor(() =>
      expect(screen.getByTestId('preview').firstElementChild?.getAttribute('data-layout')).toBe(
        'carousel',
      ),
    );
    await waitFor(() =>
      expect(screen.getByText('20 displayed · 20 matching · 0 excluded')).toBeTruthy(),
    );
    expect(screen.queryByLabelText('Book limit')).toBeNull();
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });
  it('retains the last valid state when an exclusive condition is removed', async () => {
    const ref = createRef<BookshelvesEditorHandle>();
    render(<BookshelvesEditor ref={ref} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add bookshelf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    fireEvent.change(screen.getByLabelText('Filter value'), { target: { value: 'Book' } });
    fireEvent.click(screen.getByLabelText(/^Exclusive/));
    await act(async () => {
      await ref.current!.flush();
    });
    expect(save).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Remove condition' }));
    expect(screen.getByRole('alert').textContent).toContain(
      'Exclusive shelves need a complete filter',
    );
    expect(
      screen.getByRole('group', { name: 'Bookshelves' }).contains(screen.getByRole('alert')),
    ).toBe(true);
    await act(async () => {
      await ref.current!.flush();
    });
    expect(save).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByLabelText(/^Exclusive/));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(save.mock.calls.at(-1)![2][1].exclusive).toBe(false);
  });
  it('previews disabled shelves as enabled and refuses empty nested groups', async () => {
    const ref = createRef<BookshelvesEditorHandle>();
    render(<BookshelvesEditor ref={ref} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add bookshelf' }));
    fireEvent.click(screen.getByLabelText('Enabled'));
    expect(screen.queryByText('Previewing this shelf as enabled')).toBeNull();
    await waitFor(() =>
      expect(screen.getByText('20 displayed · 20 matching · 0 excluded')).toBeTruthy(),
    );
    await act(async () => {
      await ref.current!.flush();
    });
    expect(save).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Add filter group' }));
    expect(screen.getByRole('alert').textContent).toContain('Complete every filter condition.');
    await act(async () => {
      await ref.current!.flush();
    });
    expect(save).toHaveBeenCalledOnce();
  });
  it('serializes changes made during saving against the last persisted version', async () => {
    const ref = createRef<BookshelvesEditorHandle>();
    let finish!: () => void;
    save.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(<BookshelvesEditor ref={ref} />);
    fireEvent.click(screen.getByLabelText('Hide covers'));
    let first!: Promise<boolean>;
    await act(async () => {
      first = ref.current!.flush();
    });
    expect(screen.getByRole('status', { name: 'Bookshelf status' }).textContent).toBe('Saving...');
    fireEvent.click(screen.getByLabelText('Carousel layout'));
    let second!: Promise<boolean>;
    await act(async () => {
      second = ref.current!.flush();
    });
    expect(save).toHaveBeenCalledOnce();
    await act(async () => {
      finish();
      await first;
      await second;
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]![1]).toEqual(save.mock.calls[0]![2]);
    expect(save.mock.calls[1]![2][0]).toMatchObject({ hideCovers: true, layout: 'grid' });
    expect(screen.getByRole('status', { name: 'Bookshelf status' }).textContent).toBe('Saved');
    await waitFor(
      () => expect(screen.getByRole('status', { name: 'Bookshelf status' }).textContent).toBe(''),
      { timeout: 3000 },
    );
  });
  it('keeps failed changes for retry and flushes edits before the debounce expires', async () => {
    const ref = createRef<BookshelvesEditorHandle>();
    save.mockRejectedValueOnce(new Error('Storage unavailable'));
    render(<BookshelvesEditor ref={ref} />);
    fireEvent.click(screen.getByLabelText('Hide covers'));
    await act(async () => {
      expect(await ref.current!.flush()).toBe(false);
    });
    expect(screen.getByRole('alert').textContent).toBe('Storage unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Bookshelf status' }).textContent).toBe('Saved'),
    );
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]!.slice(1)).toEqual(save.mock.calls[0]!.slice(1));
  });
  it('does not publish untouched defaults when opened or closed', async () => {
    const ref = createRef<BookshelvesEditorHandle>();
    const { unmount } = render(<BookshelvesEditor ref={ref} />);
    await act(async () => {
      expect(await ref.current!.flush()).toBe(true);
    });
    unmount();
    await act(async () => {});
    expect(save).not.toHaveBeenCalled();
  });
  it('disables the last enabled switch and never offers deletion of built-ins', () => {
    const base = defaultBookshelves(DEFAULT_SYSTEM_SETTINGS);
    const clock = new HlcGenerator('test');
    const state = applyBookshelfDraft(
      { rows: {} },
      base,
      base.map((s) => ({ ...s, enabled: s.id === 'default' })),
      { userId: '', deviceId: 'test', next: () => clock.next() },
    ).state;
    useSettingsStore.setState({ settings: { ...DEFAULT_SYSTEM_SETTINGS, bookshelves: state } });
    render(<BookshelvesEditor />);
    fireEvent.click(screen.getByRole('button', { name: 'Default' }));
    expect((screen.getByLabelText('Enabled') as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Move up' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Move down' })).toBeNull();
  });
});
