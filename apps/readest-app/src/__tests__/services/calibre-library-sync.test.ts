import { describe, expect, it } from 'vitest';
import type { CalibreBookJson } from '@/types/calibre';
import type { Book } from '@/types/book';
import { reconcileCalibreBooks, type CalibreServerBook } from '@/services/calibre/librarySync';
import { makeCalibreFilePath } from '@/utils/calibre';
import { md5 } from '@/utils/md5';

const NOW = 1_700_000_000_000;

const serverBook = (id: string, overrides: Partial<CalibreBookJson> = {}): CalibreServerBook => ({
  id,
  json: {
    title: `Book ${id}`,
    authors: ['Author A'],
    formats: ['epub', 'mobi'],
    last_modified: '2026-01-01T00:00:00+00:00',
    ...overrides,
  },
});

const stub = (id: string, libraryId = 'lib'): Book => {
  const filePath = makeCalibreFilePath('srv1', libraryId, id);
  return {
    hash: md5(filePath),
    format: 'EPUB',
    filePath,
    title: `Book ${id}`,
    author: 'Author A',
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    metadata: {
      title: `Book ${id}`,
      author: 'Author A',
      language: '',
      calibreSource: {
        serverId: 'srv1',
        libraryId,
        bookId: id,
        format: 'epub',
        formats: ['epub', 'mobi'],
        lastModified: '2026-01-01T00:00:00+00:00',
      },
    },
  };
};

const downloaded = (id: string, libraryId = 'lib'): Book => ({
  hash: `real-hash-${id}`,
  format: 'EPUB',
  title: `Book ${id}`,
  author: 'Author A',
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
  metadata: {
    title: `Book ${id}`,
    author: 'Author A',
    language: '',
    calibreSource: { serverId: 'srv1', libraryId, bookId: id, format: 'epub' },
  },
});

const reconcile = (serverBooks: CalibreServerBook[], library: Book[]) =>
  reconcileCalibreBooks({
    server: { id: 'srv1' },
    libraryId: 'lib',
    serverBooks,
    library,
    now: NOW,
  });

describe('reconcileCalibreBooks', () => {
  it('creates stubs for new server books', () => {
    const { upserts, tombstoneHashes } = reconcile(
      [serverBook('1', { tags: ['Fantasy', 'Classic'], rating: 4 })],
      [],
    );
    expect(tombstoneHashes).toEqual([]);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.hash).toBe(md5(makeCalibreFilePath('srv1', 'lib', '1')));
    expect(upserts[0]!.format).toBe('EPUB');
    expect(upserts[0]!.title).toBe('Book 1');
    // Top-level tags drive the shelf's Tag grouping.
    expect(upserts[0]!.tags).toEqual(['Fantasy', 'Classic']);
    expect(upserts[0]!.metadata?.subject).toEqual(['Fantasy', 'Classic']);
    expect(upserts[0]!.metadata?.rating).toBe(4);
    expect(upserts[0]!.metadata?.calibreSource).toMatchObject({
      serverId: 'srv1',
      libraryId: 'lib',
      bookId: '1',
      format: 'epub',
      formats: ['epub', 'mobi'],
    });
  });

  it('backfills calibre-web shelf names as groupName without clobbering manual groups', () => {
    const serverBooks = [
      serverBook('1', { tags: ['Fantasy'] }),
      serverBook('2', { tags: ['Fantasy'] }),
    ];
    const getGroupName = () => 'Favorites';

    // New stubs take the shelf name; a stub the user already grouped keeps
    // its manual groupName (the upsert it does get is the one-time tags
    // backfill, and it must not carry the shelf name).
    const preGrouped = stub('2');
    preGrouped.groupName = 'My Manual Group';
    const { upserts } = reconcileCalibreBooks({
      server: { id: 'srv1' },
      libraryId: 'lib',
      serverBooks,
      library: [preGrouped],
      now: NOW,
      getGroupName,
    });
    expect(upserts).toHaveLength(2);
    const byId = new Map(upserts.map((u) => [u.metadata!.calibreSource!.bookId, u]));
    expect(byId.get('1')!.groupName).toBe('Favorites');
    expect(byId.get('2')!.groupName).toBe('My Manual Group');
  });

  it('is idempotent when nothing changed', () => {
    const library = [stub('1')];
    const { upserts, tombstoneHashes } = reconcile([serverBook('1')], library);
    expect(upserts).toEqual([]);
    expect(tombstoneHashes).toEqual([]);
  });

  it('upserts a stub when server metadata changed', () => {
    const library = [stub('1')];
    const { upserts } = reconcile(
      [serverBook('1', { title: 'Renamed', last_modified: '2026-02-01T00:00:00+00:00' })],
      library,
    );
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.title).toBe('Renamed');
    expect(upserts[0]!.hash).toBe(stub('1').hash);
  });

  it('reconciles in place when only the preferred format changed', () => {
    const library = [stub('1')];
    const { upserts } = reconcile([serverBook('1', { formats: ['mobi'] })], library);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.format).toBe('MOBI');
    expect(upserts[0]!.metadata?.calibreSource?.format).toBe('mobi');
  });

  it('keeps a user-edited stub title across re-syncs', () => {
    const edited = stub('1');
    edited.title = 'My Rename';
    edited.metadataUpdatedAt = NOW + 5;
    const { upserts } = reconcile(
      [serverBook('1', { title: 'Server Rename', last_modified: '2026-02-01T00:00:00+00:00' })],
      [edited],
    );
    // The only change worth writing is the refreshed sync stamp.
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.title).toBe('My Rename');
    expect(upserts[0]!.metadata?.calibreSource?.lastModified).toBe('2026-02-01T00:00:00+00:00');
  });

  it('tombstones stubs that vanished from the server', () => {
    const removed = stub('1');
    const kept = stub('2');
    const { upserts, tombstoneHashes } = reconcile([serverBook('2')], [removed, kept]);
    expect(upserts).toEqual([]);
    expect(tombstoneHashes).toEqual([removed.hash]);
  });

  it('never touches books already downloaded from the server', () => {
    const library = [downloaded('1')];
    // Server no longer has the book: the local copy is the user's now.
    const { upserts, tombstoneHashes } = reconcile([], library);
    expect(upserts).toEqual([]);
    expect(tombstoneHashes).toEqual([]);

    // Server metadata changed: local wins, no churn.
    const { upserts: upserts2 } = reconcile(
      [serverBook('1', { title: 'Server Rename', last_modified: '2026-03-01T00:00:00+00:00' })],
      library,
    );
    expect(upserts2).toEqual([]);
  });

  it('does not match a downloaded book to a different server', () => {
    const other = downloaded('1');
    other.metadata!.calibreSource = { ...other.metadata!.calibreSource!, serverId: 'srv2' };
    const { upserts } = reconcile([serverBook('1')], [other]);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.hash).toBe(stub('1').hash);
  });

  it('skips server books with no supported format', () => {
    const { upserts } = reconcile([serverBook('1', { formats: ['kfx', 'docx'] })], []);
    expect(upserts).toEqual([]);
  });

  it('only reconciles stubs of the same server', () => {
    const otherServer = stub('1');
    otherServer.filePath = makeCalibreFilePath('srv2', 'lib', '1');
    otherServer.hash = md5(otherServer.filePath);
    otherServer.metadata!.calibreSource = {
      ...otherServer.metadata!.calibreSource!,
      serverId: 'srv2',
    };
    const { upserts } = reconcile([serverBook('1')], [otherServer]);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.hash).toBe(stub('1').hash);
  });
});
