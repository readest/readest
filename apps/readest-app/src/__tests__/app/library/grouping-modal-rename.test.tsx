import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Book } from '@/types/book';
import { md5Fingerprint } from '@/utils/md5';
import { useLibraryStore } from '@/store/libraryStore';
import GroupingModal from '@/app/library/components/GroupingModal';
import { useSettingsStore } from '@/store/settingsStore';
import { applyBookshelfDraft, readBookshelves } from '@/services/bookshelves/state';
import { HlcGenerator } from '@/libs/crdt';
import type { saveBookshelfDraft } from '@/services/bookshelves/persistence';
import { createBookshelfOrderRows } from '@/services/bookshelves/orderRecords';

const { saveOrders } = vi.hoisted(() => ({
  saveOrders: vi.fn<typeof saveBookshelfDraft>(async () => {}),
}));
vi.mock('@/services/bookshelves/persistence', () => ({ saveBookshelfDraft: saveOrders }));

const saveLibraryBooks = vi.fn();
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    appService: { saveLibraryBooks },
    envConfig: { getAppService: async () => ({ saveLibraryBooks }) },
  }),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));

const book = (hash: string, groupName: string): Book => ({
  hash,
  title: hash,
  author: 'Writer',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
  groupId: md5Fingerprint(groupName),
  groupName,
});

let library: Book[];
beforeEach(() => {
  saveOrders.mockReset().mockResolvedValue(undefined);
  saveLibraryBooks.mockReset().mockResolvedValue(undefined);
  useSettingsStore.setState({
    settings: { ...useSettingsStore.getState().settings, bookshelves: undefined },
  });
  library = [book('direct', 'A'), book('nested', 'A/B'), book('deep', 'A/C/D'), book('other', 'X')];
  useLibraryStore.setState({ library, libraryLoaded: true, groups: {} });
});
afterEach(cleanup);

// Selecting the `A` tile selects every book in its subtree.
const renameA = (onConfirm = vi.fn(), save = true) => {
  render(
    <GroupingModal
      libraryBooks={library}
      selectedBooks={['direct', 'nested', 'deep']}
      parentGroupName=''
      renameGroupName='A'
      onCancel={vi.fn()}
      onConfirm={onConfirm}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Rename Group' }));
  fireEvent.change(screen.getByDisplayValue('A'), { target: { value: 'Z' } });
  if (save) fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  return onConfirm;
};
const groupNames = () =>
  Object.fromEntries(useLibraryStore.getState().library.map((b) => [b.hash, b.groupName]));

describe('renaming a group with nested groups', () => {
  it('saves the edited name with Enter before the dialog confirms the selection', async () => {
    const confirm = renameA(vi.fn(), false);
    fireEvent.keyDown(screen.getByDisplayValue('Z'), { key: 'Enter' });
    await waitFor(() => expect(saveLibraryBooks).toHaveBeenCalledOnce());
    await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    expect(groupNames()).toEqual({ direct: 'Z', nested: 'Z/B', deep: 'Z/C/D', other: 'X' });
  });

  it('lets Escape cancel editing without closing the group dialog', () => {
    const confirm = renameA(vi.fn(), false);
    fireEvent.keyDown(screen.getByDisplayValue('Z'), { key: 'Escape' });
    expect(screen.queryByDisplayValue('Z')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Group Books' })).toBeTruthy();
    expect(confirm).not.toHaveBeenCalled();
    expect(saveLibraryBooks).not.toHaveBeenCalled();
  });

  it('saves a pending rename only once across repeated Save and Enter actions', async () => {
    const pending = Promise.withResolvers<void>();
    saveLibraryBooks.mockReturnValueOnce(pending.promise);
    const confirm = renameA();
    await waitFor(() => expect(saveLibraryBooks).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.keyDown(screen.getByDisplayValue('Z'), { key: 'Enter' });
    await Promise.resolve();
    expect(saveLibraryBooks).toHaveBeenCalledOnce();
    await act(async () => pending.resolve());
    expect(saveLibraryBooks).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledOnce();
    expect(groupNames()).toEqual({ direct: 'Z', nested: 'Z/B', deep: 'Z/C/D', other: 'X' });
  });

  it('preserves imported books and reading updates received while saving the renamed order', async () => {
    useLibraryStore.getState().refreshGroups();
    const base = readBookshelves(useSettingsStore.getState().settings);
    const clock = new HlcGenerator('rename');
    const state = applyBookshelfDraft({ rows: {} }, base, base, {
      userId: '',
      deviceId: 'rename',
      next: () => clock.next(),
    }).state;
    for (const row of createBookshelfOrderRows('default', 'group:A', ['b:direct'], {
      userId: '',
      deviceId: 'rename',
      next: () => clock.next(),
    }))
      state.rows[row.replica_id] = row;
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, bookshelves: state },
    });
    const pending = Promise.withResolvers<void>();
    saveOrders.mockReturnValueOnce(pending.promise);
    const confirm = renameA();
    await waitFor(() => expect(saveOrders).toHaveBeenCalled());
    const imported = book('imported', 'X');
    useLibraryStore
      .getState()
      .setLibrary([
        ...library.map((b) =>
          b.hash === 'direct' ? { ...b, updatedAt: 900, progress: [8, 10] as [number, number] } : b,
        ),
        imported,
      ]);
    pending.resolve();
    await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    expect(useLibraryStore.getState().library.find((b) => b.hash === 'direct')).toMatchObject({
      groupName: 'Z',
      updatedAt: 900,
      progress: [8, 10],
    });
    expect(useLibraryStore.getState().library).toContainEqual(imported);
  });

  it('keeps the rename dialog open and restores membership if saving the library fails', async () => {
    saveLibraryBooks.mockRejectedValueOnce(new Error('Library storage unavailable'));
    const confirm = renameA();
    await waitFor(() => expect(saveLibraryBooks).toHaveBeenCalled());
    await waitFor(() =>
      expect(groupNames()).toEqual({ direct: 'A', nested: 'A/B', deep: 'A/C/D', other: 'X' }),
    );
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    expect(saveLibraryBooks).toHaveBeenCalledTimes(2);
    expect(groupNames()).toEqual({ direct: 'Z', nested: 'Z/B', deep: 'Z/C/D', other: 'X' });
  });
  it('keeps the dragged group position and the order inside renamed descendants', async () => {
    useLibraryStore.getState().refreshGroups();
    const base = readBookshelves(useSettingsStore.getState().settings);
    const clock = new HlcGenerator('test');
    const draft = base.map((shelf) =>
      shelf.id === 'default'
        ? {
            ...shelf,
            manualOrder: {
              'group:': [`g:${md5Fingerprint('A')}`, 'b:other'],
              'group:A/B': ['b:nested'],
            },
          }
        : shelf,
    );
    const { state } = applyBookshelfDraft({ rows: {} }, base, draft, {
      userId: '',
      deviceId: 'test',
      next: () => clock.next(),
    });
    for (const [scope, ids] of Object.entries(
      draft.find((shelf) => shelf.id === 'default')!.manualOrder ?? {},
    )) {
      for (const row of createBookshelfOrderRows('default', scope, ids, {
        userId: '',
        deviceId: 'test',
        next: () => clock.next(),
      }))
        state.rows[row.replica_id] = row;
    }
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, bookshelves: state },
    });
    renameA();
    await waitFor(() => expect(saveOrders).toHaveBeenCalledOnce());
    expect(saveOrders.mock.calls[0]?.[2]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'default',
          manualOrder: {
            'group:': [`g:${md5Fingerprint('Z')}`, 'b:other'],
            'group:Z/B': ['b:nested'],
          },
        }),
      ]),
    );
    expect(groupNames()).toEqual({ direct: 'Z', nested: 'Z/B', deep: 'Z/C/D', other: 'X' });
  });

  it('renames only the group and keeps its nested structure', async () => {
    const confirm = renameA();
    await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    expect(groupNames()).toEqual({ direct: 'Z', nested: 'Z/B', deep: 'Z/C/D', other: 'X' });
  });

  it('closes on Save, so Confirm cannot then move the subtree into one group', async () => {
    // Left open, picking the renamed group and confirming flattened Z/B and Z/C/D into Z.
    const onConfirm = renameA();
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    expect(groupNames()).toEqual({ direct: 'Z', nested: 'Z/B', deep: 'Z/C/D', other: 'X' });
  });
});
