import { describe, expect, test } from 'vitest';
import {
  filterWebDAVEntries,
  sortWebDAVEntries,
} from '@/components/settings/integrations/webdavBrowseUtils';
import type { WebDAVEntry } from '@/services/sync/providers/webdav/client';

/**
 * Pure sort/filter helpers backing the WebDAV browser's sort + search
 * controls. They operate on already-fetched `WebDAVEntry[]` (the pane
 * lists a whole directory in one PROPFIND, so there's no pagination to
 * worry about) which keeps them trivially unit-testable here.
 */

const dir = (name: string, extra: Partial<WebDAVEntry> = {}): WebDAVEntry => ({
  name,
  path: `/${name}`,
  isDirectory: true,
  ...extra,
});

const file = (name: string, extra: Partial<WebDAVEntry> = {}): WebDAVEntry => ({
  name,
  path: `/${name}`,
  isDirectory: false,
  ...extra,
});

const names = (entries: WebDAVEntry[]): string[] => entries.map((e) => e.name);

describe('sortWebDAVEntries', () => {
  test('keeps directories grouped before files regardless of field/direction', () => {
    const entries = [file('b.epub', { size: 10 }), dir('z-folder'), file('a.epub', { size: 20 })];
    const sorted = sortWebDAVEntries(entries, 'size', false);
    // Directories first even though the field is size descending and the
    // dir has no size; files follow, ordered by the field.
    expect(sorted[0]!.isDirectory).toBe(true);
    expect(names(sorted.filter((e) => !e.isDirectory))).toEqual(['a.epub', 'b.epub']);
  });

  test('sorts by name ascending and descending', () => {
    const entries = [file('Charlie.epub'), file('alpha.epub'), file('Bravo.epub')];
    expect(names(sortWebDAVEntries(entries, 'name', true))).toEqual([
      'alpha.epub',
      'Bravo.epub',
      'Charlie.epub',
    ]);
    expect(names(sortWebDAVEntries(entries, 'name', false))).toEqual([
      'Charlie.epub',
      'Bravo.epub',
      'alpha.epub',
    ]);
  });

  test('sorts by last modified date, newest-first when descending', () => {
    const entries = [
      file('old.epub', { lastModified: 'Mon, 01 Jan 2024 00:00:00 GMT' }),
      file('new.epub', { lastModified: 'Wed, 01 Jan 2025 00:00:00 GMT' }),
      file('mid.epub', { lastModified: 'Sat, 01 Jun 2024 00:00:00 GMT' }),
    ];
    expect(names(sortWebDAVEntries(entries, 'modified', false))).toEqual([
      'new.epub',
      'mid.epub',
      'old.epub',
    ]);
    expect(names(sortWebDAVEntries(entries, 'modified', true))).toEqual([
      'old.epub',
      'mid.epub',
      'new.epub',
    ]);
  });

  test('sorts by creation date', () => {
    const entries = [
      file('second.epub', { created: '2024-05-01T00:00:00Z' }),
      file('first.epub', { created: '2024-01-01T00:00:00Z' }),
    ];
    expect(names(sortWebDAVEntries(entries, 'created', true))).toEqual([
      'first.epub',
      'second.epub',
    ]);
  });

  test('sorts by size', () => {
    const entries = [file('big.epub', { size: 5000 }), file('small.epub', { size: 10 })];
    expect(names(sortWebDAVEntries(entries, 'size', true))).toEqual(['small.epub', 'big.epub']);
    expect(names(sortWebDAVEntries(entries, 'size', false))).toEqual(['big.epub', 'small.epub']);
  });

  test('entries missing the sort field sort last in both directions, tie-broken by name', () => {
    const entries = [
      file('has-date.epub', { lastModified: 'Wed, 01 Jan 2025 00:00:00 GMT' }),
      file('no-date-b.epub'),
      file('no-date-a.epub'),
    ];
    // Ascending: dated entry first, then the undated pair alphabetically.
    expect(names(sortWebDAVEntries(entries, 'modified', true))).toEqual([
      'has-date.epub',
      'no-date-a.epub',
      'no-date-b.epub',
    ]);
    // Descending: dated entry still first; undated remain last (not flipped
    // to the top) and stay name-ordered.
    expect(names(sortWebDAVEntries(entries, 'modified', false))).toEqual([
      'has-date.epub',
      'no-date-a.epub',
      'no-date-b.epub',
    ]);
  });

  test('name sort follows the resolved display name when provided', () => {
    // Under Readest/books the entry name is a content hash; the resolver
    // maps it to the human title so "sort by name" matches what's shown.
    const entries = [dir('hashZ'), dir('hashA')];
    const titles: Record<string, string> = { hashZ: 'Alpha', hashA: 'Zulu' };
    const getName = (e: WebDAVEntry) => titles[e.name] ?? e.name;
    expect(names(sortWebDAVEntries(entries, 'name', true, getName))).toEqual(['hashZ', 'hashA']);
  });

  test('does not mutate the input array', () => {
    const entries = [file('b.epub'), file('a.epub')];
    const snapshot = names(entries);
    sortWebDAVEntries(entries, 'name', true);
    expect(names(entries)).toEqual(snapshot);
  });
});

describe('filterWebDAVEntries', () => {
  const entries = [file('The Great Gatsby.epub'), file('mobydick.epub'), dir('hash123')];

  test('returns every entry for an empty/whitespace query', () => {
    expect(filterWebDAVEntries(entries, '')).toHaveLength(3);
    expect(filterWebDAVEntries(entries, '   ')).toHaveLength(3);
  });

  test('matches file name case-insensitively as a substring', () => {
    expect(names(filterWebDAVEntries(entries, 'GREAT'))).toEqual(['The Great Gatsby.epub']);
    expect(names(filterWebDAVEntries(entries, 'dick'))).toEqual(['mobydick.epub']);
  });

  test('matches the resolved display title for hashed book directories', () => {
    const getName = (e: WebDAVEntry) => (e.name === 'hash123' ? 'Crime and Punishment' : e.name);
    expect(names(filterWebDAVEntries(entries, 'punishment', getName))).toEqual(['hash123']);
  });

  test('returns an empty array when nothing matches', () => {
    expect(filterWebDAVEntries(entries, 'zzz-nope')).toEqual([]);
  });
});
