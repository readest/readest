import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Book } from '@/types/book';
import { md5Fingerprint } from '@/utils/md5';
import { useLibraryStore } from '@/store/libraryStore';
import GroupingModal from '@/app/library/components/GroupingModal';

const saveLibraryBooks = vi.fn();
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: { saveLibraryBooks } }) }));
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
  library = [book('direct', 'A'), book('nested', 'A/B'), book('deep', 'A/C/D'), book('other', 'X')];
  useLibraryStore.setState({ library, groups: {} });
});
afterEach(cleanup);

// Selecting the `A` tile selects every book in its subtree.
const renameA = (onConfirm = vi.fn()) => {
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
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  return onConfirm;
};
const groupNames = () => Object.fromEntries(library.map((b) => [b.hash, b.groupName]));

describe('renaming a group with nested groups', () => {
  it('renames only the group and keeps its nested structure', () => {
    renameA();
    expect(groupNames()).toEqual({ direct: 'Z', nested: 'Z/B', deep: 'Z/C/D', other: 'X' });
  });

  it('closes on Save, so Confirm cannot then move the subtree into one group', () => {
    // Left open, picking the renamed group and confirming flattened Z/B and Z/C/D into Z.
    const onConfirm = renameA();
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(groupNames()).toEqual({ direct: 'Z', nested: 'Z/B', deep: 'Z/C/D', other: 'X' });
  });
});
