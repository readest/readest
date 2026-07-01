import { describe, expect, test } from 'vitest';
import {
  mergeNotes,
  mergeBookConfig,
  mergeBookMetadata,
  isRemoteBookMetadataNewer,
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
