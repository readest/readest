import { describe, it, expect } from 'vitest';
import {
  isAudiobook,
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

  it('parseAbsFilePath rejects non-abs paths', () => {
    expect(parseAbsFilePath('/books/x.epub')).toBeNull();
    expect(parseAbsFilePath(undefined)).toBeNull();
    expect(parseAbsFilePath('abs://only-server')).toBeNull();
  });

  it('isAudiobook keys on the ABS format', () => {
    expect(isAudiobook({ format: 'ABS' })).toBe(true);
    expect(isAudiobook({ format: 'EPUB' })).toBe(false);
  });
});

describe('splitLibraryOpenIds', () => {
  const books: Record<string, Pick<Book, 'format'>> = {
    a1: { format: 'ABS' },
    a2: { format: 'ABS' },
    e1: { format: 'EPUB' },
    e2: { format: 'EPUB' },
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
