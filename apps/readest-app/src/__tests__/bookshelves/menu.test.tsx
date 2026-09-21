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
    fireEvent.click(screen.getAllByText('Title')[0]!);
    await waitFor(() => expect(useSettingsStore.getState().settings.librarySortBy).toBe('title'));
    expect(readBookshelves(useSettingsStore.getState().settings)).toEqual(before);
    expect(readPendingBookshelves()).toEqual(pending);
  });
  it('offers the same sort labels as the bookshelf editor, except Size', () => {
    render(<ViewMenu />);
    for (const [value, label] of Object.entries(BOOKSHELF_SORT_LABELS))
      if (value === 'size') expect(screen.queryByText(label)).toBeNull();
      else expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Date Published').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Progress Read').length).toBeGreaterThan(0);
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
