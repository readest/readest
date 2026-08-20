import { describe, expect, it } from 'vitest';
import type { Book } from '@/types/book';
import { transformBookToDB, transformBookFromDB } from '@/utils/transform';
import { buildAbsBookMetadata, makeAbsFilePath } from '@/utils/audiobook';

/**
 * An ABS stub is a fileless row whose whole identity is its synthetic
 * `filePath` (`abs://<serverId>/<itemId>`). The cloud `books` table has no
 * column for it — and the push strips `filePath` anyway, because for every
 * other format it is a device-local absolute path. So the identity, and the
 * badge fields that have no columns either (duration / absMediaType /
 * episodeCount), ride across inside the synced `metadata` column, exactly as
 * a feed book carries `metadata.feedUrl`.
 */

const ABS_FILE_PATH = makeAbsFilePath('srv-1', 'item-1');

const makeAbsBook = (over: Partial<Book> = {}): Book => {
  const book: Book = {
    hash: 'abs-hash',
    format: 'ABS',
    filePath: ABS_FILE_PATH,
    title: 'An Audiobook',
    author: 'An Author',
    duration: 3600,
    createdAt: 1000,
    updatedAt: 2000,
    ...over,
  };
  book.metadata = buildAbsBookMetadata(book);
  return book;
};

describe('ABS book sync round-trip', () => {
  it('strips filePath on push but carries it in metadata.absSource', () => {
    const db = transformBookToDB(makeAbsBook(), 'user-1');
    expect('filePath' in db).toBe(false);
    expect('file_path' in db).toBe(false);
    expect(db.format).toBe('ABS');
    expect(JSON.parse(db.metadata!)['absSource']).toBe(ABS_FILE_PATH);
  });

  it('rebuilds filePath and the badge fields from metadata on pull', () => {
    const db = transformBookToDB(makeAbsBook(), 'user-1');
    const restored = transformBookFromDB(db);
    expect(restored.filePath).toBe(ABS_FILE_PATH);
    expect(restored.duration).toBe(3600);
    expect(restored.absMediaType).toBeUndefined();
    expect(restored.episodeCount).toBeUndefined();
  });

  it('rebuilds a podcast show stub with its episode count', () => {
    const show = makeAbsBook({
      hash: 'abs-show',
      absMediaType: 'podcast',
      duration: undefined,
      episodeCount: 12,
    });
    const restored = transformBookFromDB(transformBookToDB(show, 'user-1'));
    expect(restored.filePath).toBe(ABS_FILE_PATH);
    expect(restored.absMediaType).toBe('podcast');
    expect(restored.episodeCount).toBe(12);
    expect(restored.duration).toBeUndefined();
  });

  it('leaves a legacy ABS row without the mirror unresolvable', () => {
    // Rows pushed before the mirror existed carry no absSource: nothing can
    // resolve the server or item they came from, so they must stay
    // filePath-less and be dropped by the pull-side guard.
    const db = transformBookToDB(
      { ...makeAbsBook(), metadata: undefined } as unknown as Book,
      'user-1',
    );
    expect(transformBookFromDB(db).filePath).toBeUndefined();
  });

  it('ignores a garbage absSource that is not an abs:// path', () => {
    const book = makeAbsBook();
    book.metadata = { ...book.metadata!, absSource: '/Users/someone/book.epub' };
    expect(transformBookFromDB(transformBookToDB(book, 'user-1')).filePath).toBeUndefined();
  });

  it('leaves non-ABS books alone', () => {
    const epub: Book = {
      hash: 'epub-1',
      format: 'EPUB',
      filePath: '/Users/someone/book.epub',
      title: 'Plain',
      author: 'Author',
      createdAt: 1,
      updatedAt: 2,
    };
    expect(transformBookFromDB(transformBookToDB(epub, 'user-1')).filePath).toBeUndefined();
  });
});
