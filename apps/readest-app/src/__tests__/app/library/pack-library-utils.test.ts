import { describe, expect, it } from 'vitest';
import type { Book } from '@/types/book';
import { getCommonGroupName } from '@/app/library/utils/libraryUtils';
import { resolveImportGroup } from '@/services/pack/packService';
import { md5Fingerprint } from '@/utils/md5';

const book = (hash: string, groupName?: string): Book =>
  ({
    hash,
    format: 'EPUB',
    title: hash,
    author: '',
    createdAt: 0,
    updatedAt: 0,
    groupName,
  }) as Book;

describe('getCommonGroupName', () => {
  it('returns the group all books share', () => {
    expect(getCommonGroupName([book('a', 'Classics'), book('b', 'Classics')])).toBe('Classics');
  });

  it('returns undefined when one book is outside the group', () => {
    expect(getCommonGroupName([book('a', 'Classics'), book('b')])).toBeUndefined();
    expect(
      getCommonGroupName([book('a', 'Classics'), book('b', 'Classics/Greek')]),
    ).toBeUndefined();
  });

  it('returns undefined for ungrouped books', () => {
    expect(getCommonGroupName([book('a'), book('b')])).toBeUndefined();
  });
});

describe('resolveImportGroup', () => {
  // Mirrors libraryStore: an unknown name still maps to its fingerprint id.
  const groups: Record<string, string> = { [md5Fingerprint('Existing')]: 'Existing' };
  const getGroupId = (name: string) =>
    Object.entries(groups).find(([, n]) => n === name)?.[0] ?? md5Fingerprint(name);
  const getGroupName = (id: string) => groups[id];

  it('names a new group after the pack collection, not its id', () => {
    expect(resolveImportGroup(undefined, 'Classics', getGroupId, getGroupName)).toEqual({
      groupId: md5Fingerprint('Classics'),
      groupName: 'Classics',
    });
  });

  it('reuses an existing group for the pack collection', () => {
    expect(resolveImportGroup('', 'Existing', getGroupId, getGroupName)).toEqual({
      groupId: md5Fingerprint('Existing'),
      groupName: 'Existing',
    });
  });

  it('keeps the import target when there is no pack collection', () => {
    expect(resolveImportGroup(undefined, undefined, getGroupId, getGroupName)).toEqual({
      groupId: undefined,
      groupName: undefined,
    });
    expect(resolveImportGroup('', undefined, getGroupId, getGroupName)).toEqual({
      groupId: '',
      groupName: undefined,
    });
    expect(
      resolveImportGroup(md5Fingerprint('Existing'), undefined, getGroupId, getGroupName),
    ).toEqual({ groupId: md5Fingerprint('Existing'), groupName: 'Existing' });
  });
});
