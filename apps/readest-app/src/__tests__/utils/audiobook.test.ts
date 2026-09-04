import { describe, it, expect } from 'vitest';
import {
  isAudiobook,
  buildAbsEbookUrl,
  makeAbsFilePath,
  parseAbsFilePath,
  splitLibraryOpenIds,
} from '@/utils/audiobook';
import type { Book } from '@/types/book';

describe('audiobook helpers', () => {
  it('builds and parses abs:// file paths round-trip', () => {
    const path = makeAbsFilePath('server-1', 'item-abc');
    expect(path).toBe('abs://server-1/item-abc');
    expect(parseAbsFilePath(path)).toEqual({ serverId: 'server-1', itemId: 'item-abc' });
  });

  it('builds an authenticated ABS ebook URL', () => {
    expect(buildAbsEbookUrl({ url: 'https://abs.example/', accessToken: 'a+b&c' }, 'item/1')).toBe(
      'https://abs.example/api/items/item%2F1/ebook?token=a%2Bb%26c',
    );
  });

  it('parseAbsFilePath rejects non-abs paths', () => {
    expect(parseAbsFilePath('/books/x.epub')).toBeNull();
    expect(parseAbsFilePath(undefined)).toBeNull();
    expect(parseAbsFilePath('abs://only-server')).toBeNull();
  });

  it('isAudiobook keys on the ABS format', () => {
    expect(isAudiobook({ format: 'ABS' })).toBe(true);
    expect(isAudiobook({ format: 'EPUB' })).toBe(false);
    expect(
      isAudiobook({
        format: 'ABS',
        metadata: { title: 'Ebook', author: 'A', language: '', absMediaType: 'ebook' },
      }),
    ).toBe(false);
  });
});

describe('splitLibraryOpenIds', () => {
  const books: Record<string, Pick<Book, 'format' | 'metadata'>> = {
    a1: { format: 'ABS' },
    a2: { format: 'ABS' },
    e1: { format: 'EPUB', metadata: undefined },
    e2: { format: 'EPUB', metadata: undefined },
    absEbook: {
      format: 'ABS',
      metadata: { title: 'E', author: 'A', language: '', absMediaType: 'ebook' },
    },
  };
  const lookup = (hash: string) => books[hash];

  it('routes a single audiobook straight to the player', () => {
    expect(splitLibraryOpenIds(['a1'], lookup)).toEqual({
      audiobookHash: 'a1',
      readerIds: [],
      droppedAudiobooks: false,
    });
  });

  it('leaves a single reader book untouched', () => {
    expect(splitLibraryOpenIds(['e1'], lookup)).toEqual({
      audiobookHash: null,
      readerIds: ['e1'],
      droppedAudiobooks: false,
    });
  });

  it('leaves a streamed ABS ebook in the reader ids', () => {
    expect(splitLibraryOpenIds(['absEbook'], lookup)).toEqual({
      audiobookHash: null,
      readerIds: ['absEbook'],
      droppedAudiobooks: false,
    });
  });

  it('drops audiobooks out of a mixed multi-open and flags the drop', () => {
    expect(splitLibraryOpenIds(['e1', 'a1', 'e2'], lookup)).toEqual({
      audiobookHash: null,
      readerIds: ['e1', 'e2'],
      droppedAudiobooks: true,
    });
  });

  it('drops every id when a multi-open is all audiobooks', () => {
    expect(splitLibraryOpenIds(['a1', 'a2'], lookup)).toEqual({
      audiobookHash: null,
      readerIds: [],
      droppedAudiobooks: true,
    });
  });

  it('does not flag a drop when a multi-open has no audiobooks', () => {
    expect(splitLibraryOpenIds(['e1', 'e2'], lookup)).toEqual({
      audiobookHash: null,
      readerIds: ['e1', 'e2'],
      droppedAudiobooks: false,
    });
  });
});
