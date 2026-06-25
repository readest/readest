import { describe, expect, test } from 'vitest';
import {
  buildRemotePayload,
  parseRemotePayload,
  parseRemoteLibraryIndex,
} from '@/services/sync/file/wire';
import type { Book, BookConfig } from '@/types/book';

const book = {
  hash: 'h1',
  metaHash: 'm1',
  format: 'EPUB',
  title: 'T',
  author: 'A',
  createdAt: 1,
  updatedAt: 1,
} as Book;

// Cast through unknown so a device-local field (viewSettings) can be present
// on the source config without fighting the BookConfig type — the point of
// the test is that it never reaches the wire.
const config = {
  updatedAt: 42,
  progress: [3, 10],
  location: 'loc',
  xpointer: 'xp',
  booknotes: [],
  viewSettings: { fontSize: 14 },
} as unknown as BookConfig;

describe('wire envelope (frozen)', () => {
  test('buildRemotePayload trims to reading state + stable header', () => {
    const p = buildRemotePayload(book, config, 'dev-1');
    expect(p.schemaVersion).toBe(1);
    expect(p.writerVersion).toBe('readest-webdav-1');
    expect(p.writerDeviceId).toBe('dev-1');
    expect(p.bookHash).toBe('h1');
    expect(p.metaHash).toBe('m1');
    expect(p.config).toEqual({ progress: [3, 10], location: 'loc', xpointer: 'xp', updatedAt: 42 });
    // Device-local fields never travel.
    expect('viewSettings' in p.config).toBe(false);
  });

  test('parseRemotePayload rejects null / non-JSON / wrong schema', () => {
    expect(parseRemotePayload(null)).toBeNull();
    expect(parseRemotePayload('not json')).toBeNull();
    expect(parseRemotePayload(JSON.stringify({ schemaVersion: 2 }))).toBeNull();
    const ok = parseRemotePayload(JSON.stringify(buildRemotePayload(book, config, 'd')));
    expect(ok?.bookHash).toBe('h1');
  });

  test('parseRemoteLibraryIndex rejects null / malformed / wrong schema', () => {
    expect(parseRemoteLibraryIndex(null)).toBeNull();
    expect(parseRemoteLibraryIndex('{')).toBeNull();
    expect(parseRemoteLibraryIndex(JSON.stringify({ schemaVersion: 9, books: [] }))).toBeNull();
    const ok = parseRemoteLibraryIndex(
      JSON.stringify({ schemaVersion: 1, books: [book], updatedAt: 5 }),
    );
    expect(ok?.books).toHaveLength(1);
    expect(ok?.updatedAt).toBe(5);
  });
});
