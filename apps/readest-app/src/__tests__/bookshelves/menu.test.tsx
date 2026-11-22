import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ViewMenu from '@/app/library/components/ViewMenu';
import { useSettingsStore } from '@/store/settingsStore';
import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';
import type { SystemSettings } from '@/types/settings';
import type { EnvConfigType } from '@/services/environment';
import { BOOKSHELF_SORT_LABELS, createBookshelf } from '@/services/bookshelves/definitions';
import { readBookshelves } from '@/services/bookshelves/state';
import { saveBookshelfDraft } from '@/services/bookshelves/persistence';
import { readPendingBookshelves } from '@/services/bookshelves/journal';
import { getGlobalBookshelfSort } from '@/services/bookshelves/sorting';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {}, appService: null }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/utils/access', () => ({ getUserID: async () => null }));
vi.mock('@/services/sync/replicaSync', () => ({ getReplicaSync: () => null }));
vi.mock('@/helpers/settings', () => ({
  saveSysSettings: async (_env: unknown, key: string, value: unknown) => {
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, [key]: value },
    });
  },
}));
vi.mock('@/utils/nav', () => ({ navigateToLibrary: vi.fn() }));
beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState({
    settings: { ...DEFAULT_SYSTEM_SETTINGS, libraryViewMode: 'grid' } as SystemSettings,
    saveSettings: vi.fn().mockResolvedValue(undefined),
  });
});
afterEach(cleanup);
const env = {} as EnvConfigType;
describe('bookshelf layouts from the View menu', () => {
  it('shows custom order and exits it through a normal sort choice without discarding saved positions', async () => {
    const base = readBookshelves(useSettingsStore.getState().settings);
    await saveBookshelfDraft(
      env,
      base,
      base.map((shelf) =>
        shelf.id === 'default'
          ? {
              ...shelf,
              useGlobalSort: false,
              sort: { by: 'custom', ascending: true, thenBy: 'none', thenAscending: true },
              manualOrder: { 'group:': ['b:second', 'b:first'] },
            }
          : shelf,
      ),
    );
    render(<ViewMenu />);
    const custom = screen.getByText('Custom').closest('button')!;
    expect(custom.querySelector('svg')).toBeTruthy();
    fireEvent.click(screen.getByText('Title'));
    await waitFor(() =>
      expect(
        readBookshelves(useSettingsStore.getState().settings).find(
          (shelf) => shelf.id === 'default',
        )?.useGlobalSort,
      ).toBe(true),
    );
    expect(
      readBookshelves(useSettingsStore.getState().settings).find((shelf) => shelf.id === 'default')
        ?.manualOrder,
    ).toEqual({ 'group:': ['b:second', 'b:first'] });
  });

  it('keeps Custom out of the sort setting that older versions read', async () => {
    // Releases before custom order give every shelf an unknown sort no books,
    // so a downgrade would open on an empty library.
    render(<ViewMenu />);
    fireEvent.click(screen.getByText('Custom'));
    await waitFor(() =>
      expect(getGlobalBookshelfSort(useSettingsStore.getState().settings).by).toBe('custom'),
    );
    expect(useSettingsStore.getState().settings.librarySortBy).toBe('updated');
    fireEvent.click(screen.getByText('Title'));
    await waitFor(() =>
      expect(getGlobalBookshelfSort(useSettingsStore.getState().settings).by).toBe('updated'),
    );
    expect(useSettingsStore.getState().settings.librarySortBy).toBe('updated');
    const titleEntry = useSettingsStore
      .getState()
      .settings.librarySortOrder?.find((c) => c.by === 'title');
    expect(titleEntry?.ascending).toBe(false);
  });

  it('changes global sorting without rewriting shelf definitions or their pending edits', async () => {
    const base = readBookshelves(useSettingsStore.getState().settings);
    await saveBookshelfDraft(
      env,
      base,
      base.map((s) => ({ ...s, name: `Saved ${s.id}` })),
    );
    const before = readBookshelves(useSettingsStore.getState().settings);
    const pending = readPendingBookshelves();
    render(<ViewMenu />);
    fireEvent.click(screen.getByText('Title'));
    await waitFor(() =>
      expect(
        useSettingsStore.getState().settings.librarySortOrder?.find((c) => c.by === 'title')
          ?.ascending,
      ).toBe(false),
    );
    expect(readBookshelves(useSettingsStore.getState().settings)).toEqual(before);
    expect(readPendingBookshelves()).toEqual(pending);
  });
  it('does not offer an article sorting toggle', () => {
    render(<ViewMenu />);
    expect(screen.queryByText('Ignore A, An, The in titles')).toBeNull();
  });
  it('offers each sort label exactly once without duplicating primary and secondary lists', () => {
    render(<ViewMenu />);
    for (const [value, label] of Object.entries(BOOKSHELF_SORT_LABELS))
      if (value === 'size') expect(screen.queryByText(label)).toBeNull();
      // 'Series' also appears once in Group by..., so it appears twice total instead of three times.
      else expect(screen.getAllByText(label)).toHaveLength(value === 'series' ? 2 : 1);
    expect(screen.queryByText('Then by...')).toBeNull();
    expect(screen.getAllByText('Date Published')).toHaveLength(1);
    expect(screen.getAllByText('Progress Read')).toHaveLength(1);
  });
  // Group by Author with no Then by picks Series automatically (#4307); the
  // list marks it "(Auto)" at rank 2, as the old Then by menu did.
  it('marks an automatic rank-2 pick as Auto until the list is customized', () => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        libraryGroupBy: 'author',
        libraryThenSortBy: 'none',
      } as SystemSettings,
    });
    render(<ViewMenu />);
    expect(screen.getByText('Series (Auto)')).toBeTruthy();
  });

  it('toggles direction per criterion independently with arrow indicators', async () => {
    render(<ViewMenu />);
    const titleBtn = screen.getByRole('menuitem', { name: /Title \(Ascending\)/i });
    expect(titleBtn.textContent).toContain('↑');
    fireEvent.click(titleBtn);
    await waitFor(() =>
      expect(
        useSettingsStore.getState().settings.librarySortOrder?.find((c) => c.by === 'title')
          ?.ascending,
      ).toBe(false),
    );
    expect(screen.getByRole('menuitem', { name: /Title \(Descending\)/i }).textContent).toContain(
      '↓',
    );
  });

  it('preserves global metadata direction when a local Custom shelf has ascending: true', async () => {
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SYSTEM_SETTINGS,
        librarySortBy: 'updated',
        librarySortAscending: false,
      } as SystemSettings,
    });
    const base = readBookshelves(useSettingsStore.getState().settings);
    await saveBookshelfDraft(
      env,
      base,
      base.map((shelf) =>
        shelf.id === 'default'
          ? {
              ...shelf,
              useGlobalSort: false,
              sort: { by: 'custom', ascending: true, thenBy: 'none', thenAscending: true },
            }
          : shelf,
      ),
    );
    render(<ViewMenu />);
    expect(screen.getByRole('menuitem', { name: /Date Read \(Descending\)/i })).toBeTruthy();
    fireEvent.click(screen.getByText('Custom'));
    await waitFor(() =>
      expect(
        readBookshelves(useSettingsStore.getState().settings).find((s) => s.id === 'default')
          ?.useGlobalSort,
      ).toBe(true),
    );
    expect(useSettingsStore.getState().settings.librarySortOrder?.[0]).toEqual({
      by: 'updated',
      ascending: false,
    });
  });

  it('serializes rapid consecutive direction toggles so both updates land', async () => {
    render(<ViewMenu />);
    fireEvent.click(screen.getByRole('menuitem', { name: /Title \(Ascending\)/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Author \(Ascending\)/i }));
    await waitFor(() => {
      const order = useSettingsStore.getState().settings.librarySortOrder;
      expect(order?.find((c) => c.by === 'title')?.ascending).toBe(false);
      expect(order?.find((c) => c.by === 'author')?.ascending).toBe(false);
    });
  });
  it('keeps shelf visibility and cover visibility in Bookshelves settings', () => {
    render(<ViewMenu />);
    expect(screen.getByText('Bookshelves')).toBeTruthy();
    expect(screen.queryByText('Hide covers')).toBeNull();
    expect(screen.queryByText('Show recently read')).toBeNull();
    expect(screen.queryByText('Book Covers')).toBeNull();
    expect(screen.queryByText('Crop')).toBeNull();
    expect(screen.queryByText('Fit')).toBeNull();
  });
  it('keeps every carousel, including Default, when switching between Grid and List', async () => {
    const base = readBookshelves(useSettingsStore.getState().settings);
    await saveBookshelfDraft(env, base, [
      createBookshelf('Custom'),
      ...base.map((s) => ({ ...s, layout: 'carousel' as const })),
    ]);
    const before = readBookshelves(useSettingsStore.getState().settings);
    const pending = readPendingBookshelves();
    render(<ViewMenu />);
    for (const [label, value] of [
      ['List', 'list'],
      ['Grid', 'grid'],
    ]) {
      fireEvent.click(screen.getByText(label!));
      await waitFor(() => expect(useSettingsStore.getState().settings.libraryViewMode).toBe(value));
      expect(readBookshelves(useSettingsStore.getState().settings)).toEqual(before);
      expect(readPendingBookshelves()).toEqual(pending);
    }
  });
  it('changes the global mode without rewriting any non-carousel definitions', async () => {
    const base = readBookshelves(useSettingsStore.getState().settings);
    await saveBookshelfDraft(env, base, [
      { ...createBookshelf('Following view mode'), layout: 'grid' },
      ...base.map((s) => ({ ...s, name: `Saved ${s.id}` })),
    ]);
    const before = readBookshelves(useSettingsStore.getState().settings);
    const pending = readPendingBookshelves();
    render(<ViewMenu />);
    fireEvent.click(screen.getByText('List'));
    await waitFor(() => expect(useSettingsStore.getState().settings.libraryViewMode).toBe('list'));
    expect(readBookshelves(useSettingsStore.getState().settings)).toEqual(before);
    expect(readPendingBookshelves()).toEqual(pending);
  });
});
