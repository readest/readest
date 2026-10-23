import i18next from 'i18next';
import { describe, expect, it } from 'vitest';
import en from '../../../../public/locales/en/translation.json';
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

describe('pack messages in English', () => {
  const t = async () => {
    const i18n = i18next.createInstance();
    await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
    return i18n.t.bind(i18n);
  };

  it('uses singular and plural book counts', async () => {
    const _ = await t();
    expect(_('Creating package for {{count}} book(s)...', { count: 1 })).toBe(
      'Creating package for 1 book...',
    );
    expect(_('Creating package for {{count}} book(s)...', { count: 3 })).toBe(
      'Creating package for 3 books...',
    );
    expect(_('{{count}} book(s) omitted (file not available locally)', { count: 1 })).toBe(
      '1 book omitted (file not available locally)',
    );
    expect(_('{{count}} book(s) omitted (file not available locally)', { count: 2 })).toBe(
      '2 books omitted (files not available locally)',
    );
    expect(
      _('Restored collection "{{name}}" ({{count}} books)', { name: 'Classics', count: 1 }),
    ).toBe('Restored collection "Classics" (1 book)');
    expect(
      _('Restored collection "{{name}}" ({{count}} books)', { name: 'Classics', count: 3 }),
    ).toBe('Restored collection "Classics" (3 books)');
  });
});
