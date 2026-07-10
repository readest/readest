import { describe, expect, test } from 'vitest';
import {
  mergeNotes,
  mergeBookConfig,
  mergeBookMetadata,
  isRemoteBookMetadataNewer,
  shouldApplyRemoteBookMetadata,
} from '@/services/sync/file/merge';
import type { Book, BookConfig, BookNote } from '@/types/book';
import type { RemoteBookConfig } from '@/services/sync/file/wire';

const note = (id: string, updatedAt: number, deletedAt?: number): BookNote =>
  ({
    id,
    type: 'annotation',
    cfi: `c-${id}`,
    note: '',
    createdAt: updatedAt,
    updatedAt,
    deletedAt,
  }) as BookNote;

const envelope = (over: Partial<RemoteBookConfig> = {}): RemoteBookConfig => ({
  schemaVersion: 1,
  bookHash: 'h1',
  config: { updatedAt: 100 },
  booknotes: [],
  writerDeviceId: 'd',
  writerVersion: 'readest-webdav-1',
  updatedAt: 100,
  ...over,
});

describe('mergeNotes (element-set CRDT)', () => {
  test('union keeps ids from both sides', () => {
    const out = mergeNotes([note('a', 1)], [note('b', 1)])
      .map((n) => n.id)
      .sort();
    expect(out).toEqual(['a', 'b']);
  });

  test('newer updatedAt wins', () => {
    const out = mergeNotes([note('a', 1)], [{ ...note('a', 5), note: 'remote' }]);
    expect(out.find((n) => n.id === 'a')!.note).toBe('remote');
  });

  test('local-newer keeps local fields', () => {
    const out = mergeNotes(
      [{ ...note('a', 9), note: 'local' }],
      [{ ...note('a', 3), note: 'remote' }],
    );
    expect(out.find((n) => n.id === 'a')!.note).toBe('local');
  });

  test('deletedAt tombstone wins on updatedAt tie', () => {
    const out = mergeNotes([note('a', 5)], [note('a', 5, 9)]);
    expect(out.find((n) => n.id === 'a')!.deletedAt).toBe(9);
  });

  test('idempotent on identical input (id set + field values stable)', () => {
    const a = [note('a', 1), note('b', 2)];
    const once = mergeNotes(a, a);
    expect(once.map((n) => n.id).sort()).toEqual(['a', 'b']);
    const twice = mergeNotes(once, once);
    expect(twice.map((n) => n.id).sort()).toEqual(['a', 'b']);
  });

  test('commutative on the winning value per id', () => {
    const l = [note('a', 5)];
    const r = [{ ...note('a', 9), note: 'remote' }];
    const lr = mergeNotes(l, r).find((n) => n.id === 'a')!;
    const rl = mergeNotes(r, l).find((n) => n.id === 'a')!;
    // Whichever order, the strictly-newer side (updatedAt 9) supplies `note`.
    expect(lr.note).toBe('remote');
    expect(rl.note).toBe('remote');
  });
});

describe('mergeBookConfig (LWW scalars + CRDT notes)', () => {
  test('remote newer overrides scalars but unions notes', () => {
    const local: BookConfig = { updatedAt: 50, progress: [1, 10], booknotes: [note('l', 50)] };
    const r = envelope({
      config: { updatedAt: 100, progress: [5, 10] },
      booknotes: [note('r', 100)],
    });
    const { config, notes } = mergeBookConfig(local, r);
    expect(config.progress).toEqual([5, 10]);
    expect(notes.map((n) => n.id).sort()).toEqual(['l', 'r']);
    expect(config.booknotes!.map((n) => n.id).sort()).toEqual(['l', 'r']);
  });

  test('local newer keeps local scalars, still unions notes', () => {
    const local: BookConfig = { updatedAt: 200, progress: [9, 10], booknotes: [note('l', 200)] };
    const r = envelope({
      config: { updatedAt: 100, progress: [1, 10] },
      booknotes: [note('r', 100)],
    });
    const { config, notes } = mergeBookConfig(local, r);
    expect(config.progress).toEqual([9, 10]);
    expect(notes.map((n) => n.id).sort()).toEqual(['l', 'r']);
  });

  test('null/undefined remote scalars are dropped (never clobber local)', () => {
    const local: BookConfig = { updatedAt: 50, location: 'keepme', booknotes: [] };
    const r = envelope({
      config: { updatedAt: 100, location: undefined, xpointer: undefined },
    });
    const { config } = mergeBookConfig(local, r);
    expect(config.location).toBe('keepme');
  });
});

describe('mergeBookMetadata (LWW field subset)', () => {
  test('overlays only metadata fields, preserves local file/progress fields', () => {
    const local = {
      hash: 'h',
      title: 'L',
      author: 'L',
      sourceTitle: 'src',
      filePath: '/p',
      progress: [1, 2],
      updatedAt: 1,
    } as Book;
    const remote = { hash: 'h', title: 'R', author: 'R', updatedAt: 9 } as Book;
    const m = mergeBookMetadata(local, remote);
    expect(m.title).toBe('R');
    expect(m.author).toBe('R');
    expect(m.sourceTitle).toBe('src');
    expect(m.filePath).toBe('/p');
    expect(m.progress).toEqual([1, 2]);
    expect(m.updatedAt).toBe(9);
  });

  test('carries remote group membership (add-to-group) when remote is newer (#4942)', () => {
    const local = { hash: 'h', title: 'T', author: 'A', updatedAt: 1 } as Book;
    const remote = {
      hash: 'h',
      title: 'T',
      author: 'A',
      groupId: 'g1',
      groupName: 'Sci-Fi',
      updatedAt: 9,
    } as Book;
    const m = mergeBookMetadata(local, remote);
    expect(m.groupId).toBe('g1');
    expect(m.groupName).toBe('Sci-Fi');
  });

  test('propagates group removal when remote cleared membership (#4942)', () => {
    const local = {
      hash: 'h',
      title: 'T',
      author: 'A',
      groupId: 'g1',
      groupName: 'Sci-Fi',
      updatedAt: 1,
    } as Book;
    const remote = { hash: 'h', title: 'T', author: 'A', updatedAt: 9 } as Book;
    const m = mergeBookMetadata(local, remote);
    expect(m.groupId).toBeUndefined();
    expect(m.groupName).toBeUndefined();
  });

  test('carries remote tags when remote is newer; tag removal propagates', () => {
    const local = { hash: 'h', title: 'T', author: 'A', tags: ['old'], updatedAt: 1 } as Book;
    const tagged = {
      hash: 'h',
      title: 'T',
      author: 'A',
      tags: ['sf', 'fav'],
      updatedAt: 9,
    } as Book;
    expect(mergeBookMetadata(local, tagged).tags).toEqual(['sf', 'fav']);

    const cleared = { hash: 'h', title: 'T', author: 'A', updatedAt: 9 } as Book;
    expect(mergeBookMetadata(local, cleared).tags).toBeUndefined();
  });

  test('keeps every local metadata field (incl. tags) when local is newer', () => {
    const local = { hash: 'h', title: 'L', author: 'L', tags: ['mine'], updatedAt: 9 } as Book;
    const remote = { hash: 'h', title: 'R', author: 'R', tags: ['theirs'], updatedAt: 1 } as Book;
    const m = mergeBookMetadata(local, remote);
    expect(m.title).toBe('L');
    expect(m.tags).toEqual(['mine']);
    expect(m.updatedAt).toBe(9);
  });

  test('readingStatus merges on its own timestamp even when local metadata is newer (#4634 semantics)', () => {
    // Asymmetric case: this device edited the title AFTER the peer marked
    // the book Finished. Whole-book LWW would drop the status change.
    const local = {
      hash: 'h',
      title: 'Edited locally',
      author: 'A',
      readingStatus: 'reading',
      readingStatusUpdatedAt: 5,
      updatedAt: 20,
    } as Book;
    const remote = {
      hash: 'h',
      title: 'Old title',
      author: 'A',
      readingStatus: 'finished',
      readingStatusUpdatedAt: 15,
      updatedAt: 10,
    } as Book;
    const m = mergeBookMetadata(local, remote);
    expect(m.readingStatus).toBe('finished');
    expect(m.readingStatusUpdatedAt).toBe(15);
    expect(m.title).toBe('Edited locally');
    expect(m.updatedAt).toBe(20);
  });

  test('keeps the local readingStatus when it is newer, even as remote metadata wins', () => {
    const local = {
      hash: 'h',
      title: 'L',
      author: 'A',
      readingStatus: 'finished',
      readingStatusUpdatedAt: 15,
      updatedAt: 1,
    } as Book;
    const remote = {
      hash: 'h',
      title: 'R',
      author: 'A',
      readingStatus: 'reading',
      readingStatusUpdatedAt: 5,
      updatedAt: 9,
    } as Book;
    const m = mergeBookMetadata(local, remote);
    expect(m.title).toBe('R');
    expect(m.readingStatus).toBe('finished');
    expect(m.readingStatusUpdatedAt).toBe(15);
  });

  test('merge is idempotent: re-merging the same remote is a no-op', () => {
    const local = {
      hash: 'h',
      title: 'L',
      author: 'A',
      readingStatus: 'reading',
      readingStatusUpdatedAt: 5,
      tags: ['a'],
      updatedAt: 1,
    } as Book;
    const remote = {
      hash: 'h',
      title: 'R',
      author: 'A',
      readingStatus: 'finished',
      readingStatusUpdatedAt: 15,
      tags: ['b'],
      updatedAt: 9,
    } as Book;
    const once = mergeBookMetadata(local, remote);
    const twice = mergeBookMetadata(once, remote);
    expect(twice).toEqual(once);
  });
});

describe('shouldApplyRemoteBookMetadata', () => {
  test('true when only the readingStatus timestamp is newer', () => {
    const local = { updatedAt: 20, readingStatusUpdatedAt: 5 } as Book;
    const remote = { updatedAt: 10, readingStatusUpdatedAt: 15 } as Book;
    expect(shouldApplyRemoteBookMetadata(local, remote)).toBe(true);
  });

  test('true when book metadata is newer, false when neither is', () => {
    expect(shouldApplyRemoteBookMetadata({ updatedAt: 1 } as Book, { updatedAt: 2 } as Book)).toBe(
      true,
    );
    expect(
      shouldApplyRemoteBookMetadata(
        { updatedAt: 2, readingStatusUpdatedAt: 2 } as Book,
        { updatedAt: 2, readingStatusUpdatedAt: 2 } as Book,
      ),
    ).toBe(false);
  });

  test('tombstone on either side disqualifies', () => {
    expect(
      shouldApplyRemoteBookMetadata(
        { updatedAt: 1 } as Book,
        { updatedAt: 9, readingStatusUpdatedAt: 9, deletedAt: 9 } as Book,
      ),
    ).toBe(false);
    expect(
      shouldApplyRemoteBookMetadata(
        { updatedAt: 1, deletedAt: 1 } as Book,
        { updatedAt: 9 } as Book,
      ),
    ).toBe(false);
  });
});

describe('isRemoteBookMetadataNewer', () => {
  test('strictly newer remote only', () => {
    expect(isRemoteBookMetadataNewer({ updatedAt: 1 } as Book, { updatedAt: 2 } as Book)).toBe(
      true,
    );
    expect(isRemoteBookMetadataNewer({ updatedAt: 2 } as Book, { updatedAt: 2 } as Book)).toBe(
      false,
    );
    expect(isRemoteBookMetadataNewer({ updatedAt: 3 } as Book, { updatedAt: 2 } as Book)).toBe(
      false,
    );
  });

  test('tombstone on either side disqualifies', () => {
    expect(
      isRemoteBookMetadataNewer({ updatedAt: 1 } as Book, { updatedAt: 9, deletedAt: 9 } as Book),
    ).toBe(false);
    expect(
      isRemoteBookMetadataNewer({ updatedAt: 1, deletedAt: 1 } as Book, { updatedAt: 9 } as Book),
    ).toBe(false);
  });
});
