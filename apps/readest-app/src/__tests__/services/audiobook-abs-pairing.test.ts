import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  absPreviewClip,
  buildAbsPairingSource,
  listPairableAbsBooks,
} from '@/services/audiobook/absPairing';
import { useABSServerStore } from '@/store/absServerStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { ABSLibraryItem, ABSServer } from '@/types/audiobookshelf';
import type { Book } from '@/types/book';
import type { SystemSettings } from '@/types/settings';
import { makeAbsFilePath } from '@/utils/audiobook';

const server: ABSServer = { id: 'srv1', name: 'Home', url: 'http://abs.local:13378' };

// Two files; the middle chapter straddles the file boundary at 100s, as ABS
// chapter tables routinely do.
const item: ABSLibraryItem = {
  id: 'item1',
  mediaType: 'book',
  media: {
    metadata: {
      title: 'Pride and Prejudice',
      authorName: 'Jane Austen',
      narrators: ['Karen Savage', 'Someone Else'],
    },
    duration: 150,
    tracks: [
      {
        index: 2,
        startOffset: 100,
        duration: 50,
        contentUrl: '/api/items/item1/file/2',
        mimeType: 'audio/mpeg',
        title: '20686-02.mp3',
      },
      {
        index: 1,
        startOffset: 0,
        duration: 100,
        contentUrl: '/api/items/item1/file/1',
        mimeType: 'audio/mpeg',
        title: '20686-01.mp3',
      },
    ],
    chapters: [
      { id: 0, start: 0, end: 60, title: 'Ch. 1-2' },
      { id: 1, start: 60, end: 120, title: ' Ch. 3-4 ' },
      { id: 2, start: 120, end: 120, title: 'Empty' },
      { id: 3, start: 120, end: 999, title: '' },
    ],
  },
};

describe('buildAbsPairingSource', () => {
  it('maps the item onto one virtual file with chapters on the global timeline', () => {
    const source = buildAbsPairingSource(item, 'srv1');

    expect(source.title).toBe('Pride and Prejudice');
    expect(source.narrator).toBe('Karen Savage, Someone Else');
    expect(source.files).toEqual([
      {
        id: 'abs',
        name: 'Pride and Prejudice',
        path: makeAbsFilePath('srv1', 'item1'),
        duration: 150,
      },
    ]);
    expect(source.chapters).toEqual([
      { id: 'abs:0', fileId: 'abs', label: 'Ch. 1-2', start: 0, end: 60 },
      { id: 'abs:1', fileId: 'abs', label: 'Ch. 3-4', start: 60, end: 120 },
      // Empty span dropped; blank title named by position; end clamped.
      { id: 'abs:3', fileId: 'abs', label: 'Chapter 4', start: 120, end: 150 },
    ]);
    expect(source.source).toEqual({
      kind: 'audiobookshelf',
      serverId: 'srv1',
      itemId: 'item1',
      tracks: [
        { index: 1, startOffset: 0, duration: 100, contentUrl: '/api/items/item1/file/1' },
        { index: 2, startOffset: 100, duration: 50, contentUrl: '/api/items/item1/file/2' },
      ],
    });
  });

  it('falls back to one chapter per file, named after the file, when the item has none', () => {
    const chapterless: ABSLibraryItem = {
      ...item,
      media: {
        ...item.media,
        metadata: { title: 'Peter Pan', narratorName: 'Narrator' },
        chapters: [],
      },
    };

    const source = buildAbsPairingSource(chapterless, 'srv1');

    expect(source.narrator).toBe('Narrator');
    expect(source.chapters).toEqual([
      { id: 'abs:track:1', fileId: 'abs', label: '20686-01', start: 0, end: 100 },
      { id: 'abs:track:2', fileId: 'abs', label: '20686-02', start: 100, end: 150 },
    ]);
  });

  it('rejects an item without playable tracks', () => {
    const empty: ABSLibraryItem = { ...item, media: { ...item.media, tracks: [] } };

    expect(() => buildAbsPairingSource(empty, 'srv1')).toThrow(/no audio/i);
  });

  it('takes the global endpoint from track offsets, not the sum, when tracks are non-contiguous', () => {
    // A gap between tracks: file/1 ends at 100, file/2 starts at 200. The sum
    // of durations (150) understates the real endpoint (250).
    const gapped: ABSLibraryItem = {
      ...item,
      media: {
        ...item.media,
        tracks: [
          {
            index: 1,
            startOffset: 0,
            duration: 100,
            contentUrl: '/api/items/item1/file/1',
            mimeType: 'audio/mpeg',
          },
          {
            index: 2,
            startOffset: 200,
            duration: 50,
            contentUrl: '/api/items/item1/file/2',
            mimeType: 'audio/mpeg',
          },
        ],
        chapters: [{ id: 0, start: 0, end: 999, title: 'Whole' }],
      },
    };

    const source = buildAbsPairingSource(gapped, 'srv1');

    expect(source.files[0]!.duration).toBe(250);
    expect(source.chapters).toEqual([
      { id: 'abs:0', fileId: 'abs', label: 'Whole', start: 0, end: 250 },
    ]);
  });
});

describe('absPreviewClip', () => {
  beforeEach(() => {
    useABSServerStore.setState({ servers: [{ ...server, accessToken: 'tok' }] });
    useSettingsStore.setState({ settings: { absServers: [] } as unknown as SystemSettings });
  });

  afterEach(() => {
    useABSServerStore.setState({ servers: [] });
  });

  it('points at the file holding a global position, with its in-file offset and track length', () => {
    const { source } = buildAbsPairingSource(item, 'srv1');

    expect(absPreviewClip(source, 120)).toEqual({
      url: 'http://abs.local:13378/api/items/item1/file/2?token=tok',
      start: 20,
      duration: 50,
    });
    expect(absPreviewClip(source, 0)).toEqual({
      url: 'http://abs.local:13378/api/items/item1/file/1?token=tok',
      start: 0,
      duration: 100,
    });
  });

  it('is unavailable once the server row is gone', () => {
    const { source } = buildAbsPairingSource(item, 'srv1');
    useABSServerStore.setState({ servers: [] });

    expect(absPreviewClip(source, 120)).toBeNull();
  });
});

describe('listPairableAbsBooks', () => {
  const make = (overrides: Partial<Book>): Book => ({
    hash: 'h',
    format: 'ABS',
    filePath: makeAbsFilePath('srv1', 'item1'),
    title: 'Book',
    author: 'Author',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  });

  beforeEach(() => {
    useABSServerStore.setState({ servers: [server] });
    useSettingsStore.setState({ settings: { absServers: [] } as unknown as SystemSettings });
  });

  afterEach(() => {
    useABSServerStore.setState({ servers: [] });
  });

  it('keeps live audiobooks from configured servers, sorted by title', () => {
    const library = [
      make({ hash: 'b', title: 'Zeta' }),
      make({ hash: 'epub', format: 'EPUB', filePath: '/books/x.epub', title: 'An EPUB' }),
      make({ hash: 'podcast', absMediaType: 'podcast', title: 'A Show' }),
      make({ hash: 'gone', deletedAt: 1, title: 'Deleted' }),
      make({ hash: 'orphan', filePath: makeAbsFilePath('missing', 'item9'), title: 'Orphan' }),
      make({ hash: 'a', title: 'Alpha' }),
    ];

    expect(listPairableAbsBooks(library).map((book) => book.hash)).toEqual(['a', 'b']);
  });
});
