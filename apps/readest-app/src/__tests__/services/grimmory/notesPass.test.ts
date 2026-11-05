import { describe, expect, test, vi } from 'vitest';
import type { BookNote } from '@/types/book';
import { md5, partialMD5Ranges } from '@/utils/md5';
import { findGrimmoryBook } from '@/services/grimmory/bookMatch';
import { GrimmoryRequestError } from '@/services/grimmory/GrimmoryClient';
import type { GrimmoryBookMatch } from '@/services/grimmory/GrimmorySyncStore';
import type { GrimmoryNoteKind, GrimmoryNoteLink } from '@/services/grimmory/notesSync';
import { runGrimmoryPass, type GrimmoryPassDeps } from '@/services/grimmory/notesPass';
import type { GrimmoryAnnotation, GrimmoryBook, GrimmoryBookmark } from '@/services/grimmory/types';

const makeFile = (size: number, seed: number) => {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 31 + seed) & 0xff;
  return bytes;
};

const hashOf = (bytes: Uint8Array) => {
  const hasher = md5.create();
  for (const [start, end] of partialMD5Ranges(bytes.length)) hasher.update(bytes.slice(start, end));
  return hasher.hex();
};

const LOCAL = makeFile(414_345, 1);
const OTHER = makeFile(414_345, 2); // same size, different bytes
const HASH = hashOf(LOCAL);

class FakeServer {
  files = new Map<number, Uint8Array>([
    [1, OTHER],
    [2, LOCAL],
  ]);
  books: GrimmoryBook[] = [
    {
      id: 1,
      primaryFile: { id: 1, fileSizeKb: Math.floor(OTHER.length / 1024), bookType: 'EPUB' },
    },
    {
      id: 2,
      primaryFile: { id: 5, fileSizeKb: 10, bookType: 'PDF' },
      alternativeFormats: [
        { id: 2, fileSizeKb: Math.floor(LOCAL.length / 1024), bookType: 'EPUB' },
      ],
    },
  ];
  annotations: GrimmoryAnnotation[] = [];
  bookmarks: GrimmoryBookmark[] = [];
  nextId = 100;
  statuses: string[] = [];

  listBooks = vi.fn(async () => this.books);
  readContent = vi.fn(async (bookId: number, _type: unknown, start: number, end: number) =>
    this.files.get(bookId)!.slice(start, end),
  );
  getAnnotations = vi.fn(async (bookId: number) =>
    this.annotations.filter((a) => a.bookId === bookId),
  );
  createAnnotation = vi.fn(async (body: Omit<GrimmoryAnnotation, 'id'>) => {
    if (this.annotations.some((a) => a.cfi === body.cfi)) {
      throw new GrimmoryRequestError(409, 'duplicate');
    }
    const created = { ...body, id: this.nextId++ };
    this.annotations.push(created);
    return created;
  });
  updateAnnotation = vi.fn(async (id: number, body: Partial<GrimmoryAnnotation>) => {
    const annotation = this.annotations.find((a) => a.id === id)!;
    Object.assign(annotation, body);
    return annotation;
  });
  deleteAnnotation = vi.fn(async (id: number) => {
    this.annotations = this.annotations.filter((a) => a.id !== id);
  });
  getBookmarks = vi.fn(async (bookId: number) => this.bookmarks.filter((b) => b.bookId === bookId));
  createBookmark = vi.fn(async (body: { bookId: number; cfi: string; title?: string }) => {
    const created = { ...body, id: this.nextId++ };
    this.bookmarks.push(created);
    return created;
  });
  updateBookmark = vi.fn(async (id: number, body: Partial<GrimmoryBookmark>) => {
    const bookmark = this.bookmarks.find((b) => b.id === id)!;
    Object.assign(bookmark, body);
    return bookmark;
  });
  deleteBookmark = vi.fn(async (id: number) => {
    this.bookmarks = this.bookmarks.filter((b) => b.id !== id);
  });
  updateReadStatus = vi.fn(async (_bookId: number, status: string) => {
    this.statuses.push(status);
  });
}

class MemoryStore {
  books = new Map<string, GrimmoryBookMatch>();
  links: GrimmoryNoteLink[] = [];
  getBook = vi.fn(async (_account: string, hash: string) => this.books.get(hash) ?? null);
  setBook = vi.fn(async (_account: string, hash: string, match: GrimmoryBookMatch) => {
    this.books.set(hash, match);
  });
  deleteBook = vi.fn(async (_account: string, hash: string) => {
    this.books.delete(hash);
    this.links = [];
  });
  getLinks = vi.fn(async () => [...this.links]);
  setLinks = vi.fn(
    async (_account: string, _hash: string, kind: GrimmoryNoteKind, links: GrimmoryNoteLink[]) => {
      this.links = [...this.links.filter((l) => l.kind !== kind), ...links];
    },
  );
}

const setup = (notes: BookNote[] = []) => {
  const server = new FakeServer();
  const store = new MemoryStore();
  const state = { notes };
  let next = 0;
  const deps: GrimmoryPassDeps = {
    client: server,
    store,
    account: 'http://grimmory|admin',
    book: { hash: HASH, fileSize: LOCAL.length },
    syncNotes: true,
    syncBookStates: true,
    getNotes: () => state.notes,
    mergeNotes: (upserts, deleteIds) => {
      const byId = new Map(state.notes.map((n) => [n.id, n]));
      for (const note of upserts) byId.set(note.id, { ...byId.get(note.id), ...note });
      for (const id of deleteIds) {
        const note = byId.get(id);
        if (note) byId.set(id, { ...note, deletedAt: 9999, updatedAt: 9999 });
      }
      state.notes = [...byId.values()];
    },
    chapterForNote: () => 'Chapter 1',
    palette: { yellow: '#facc15' },
    now: () => 5000,
    newId: () => `new-${++next}`,
    onUnmatched: vi.fn(),
  };
  return { server, store, state, deps };
};

const highlight: BookNote = {
  id: 'n1',
  type: 'annotation',
  cfi: 'epubcfi(/6/8!/4/2/10,/1:0,/1:20)',
  text: 'Down the Rabbit-Hole',
  note: '',
  style: 'highlight',
  color: 'yellow',
  createdAt: 1000,
  updatedAt: 1000,
};

describe('findGrimmoryBook', () => {
  test('matches by partial MD5 among files of the same size, alternative formats included', async () => {
    const server = new FakeServer();
    const match = await findGrimmoryBook(server, { hash: HASH, fileSize: LOCAL.length });
    expect(match).toEqual({
      bookId: 2,
      bookFileId: 2,
      bookType: 'EPUB',
      isPrimary: false,
      statusPushedAt: 0,
    });
    // The PDF primary file is a different size and is never read.
    expect(server.readContent.mock.calls.some(([, type]) => type === 'PDF')).toBe(false);
  });

  test('finds nothing for a book not on the server', async () => {
    const server = new FakeServer();
    server.files.set(2, makeFile(LOCAL.length, 3));
    expect(await findGrimmoryBook(server, { hash: HASH, fileSize: LOCAL.length })).toBeNull();
  });
});

describe('runGrimmoryPass', () => {
  test('a book not on the server is reported, nothing is sent', async () => {
    const { server, deps } = setup([highlight]);
    server.files.set(2, makeFile(LOCAL.length, 3));
    await runGrimmoryPass({ ...deps, book: { ...deps.book, hash: 'f'.repeat(32) } });
    expect(deps.onUnmatched).toHaveBeenCalled();
    expect(server.createAnnotation).not.toHaveBeenCalled();
  });

  test('returns how many notes went each way', async () => {
    const { server, state, deps } = setup([highlight]);

    expect(await runGrimmoryPass(deps)).toEqual({ pushed: 1, pulled: 0 });
    expect(await runGrimmoryPass(deps)).toEqual({ pushed: 0, pulled: 0 });

    state.notes = [{ ...highlight, note: 'a note', updatedAt: 2000 }];
    expect(await runGrimmoryPass(deps)).toEqual({ pushed: 1, pulled: 0 });

    server.annotations.push({
      ...server.annotations[0]!,
      id: 99,
      cfi: 'epubcfi(/6/8!/4/2/14,/1:0,/1:9)',
    });
    expect((await runGrimmoryPass(deps)).pulled).toBe(1);
  });

  test('keeps what moved before a pass failed, in counts the caller holds', async () => {
    const { server, deps } = setup([highlight]);
    server.getBookmarks.mockRejectedValueOnce(new GrimmoryRequestError(503, 'down'));
    const counts = { pushed: 0, pulled: 0 };

    await expect(runGrimmoryPass(deps, counts)).rejects.toThrow();

    expect(counts).toEqual({ pushed: 1, pulled: 0 });
  });

  test('counts nothing for a book Grimmory does not have', async () => {
    const { server, deps } = setup([highlight]);
    server.files.set(2, makeFile(LOCAL.length, 3));

    const counts = await runGrimmoryPass({
      ...deps,
      book: { ...deps.book, hash: 'f'.repeat(32) },
    });

    expect(counts).toEqual({ pushed: 0, pulled: 0 });
  });

  test('creates, edits and deletes a highlight on the server across passes', async () => {
    const { server, state, deps } = setup([highlight]);

    await runGrimmoryPass(deps);
    expect(server.annotations).toEqual([
      expect.objectContaining({
        bookId: 2,
        cfi: highlight.cfi,
        text: highlight.text,
        color: '#FACC15',
        style: 'highlight',
        chapterTitle: 'Chapter 1',
      }),
    ]);

    state.notes = [{ ...highlight, note: 'a note', updatedAt: 2000 }];
    await runGrimmoryPass(deps);
    expect(server.annotations[0]!.note).toBe('a note');

    state.notes = [{ ...state.notes[0]!, deletedAt: 3000, updatedAt: 3000 }];
    await runGrimmoryPass(deps);
    expect(server.annotations).toEqual([]);
  });

  test('an edit not yet sent when a pass fails is sent by the next pass, not overwritten', async () => {
    const other: BookNote = { ...highlight, id: 'n2', cfi: 'epubcfi(/6/8!/4/2/12,/1:0,/1:9)' };
    const { server, state, deps } = setup([highlight, other]);
    await runGrimmoryPass(deps);
    expect(server.annotations).toHaveLength(2);

    state.notes = [
      { ...highlight, note: 'edited here', updatedAt: 2000 },
      { ...other, deletedAt: 2000, updatedAt: 2000 },
    ];
    server.deleteAnnotation.mockRejectedValueOnce(new GrimmoryRequestError(503, 'down'));
    await expect(runGrimmoryPass(deps)).rejects.toThrow();

    await runGrimmoryPass(deps);
    expect(state.notes.find((n) => n.id === 'n1')!.note).toBe('edited here');
    expect(server.annotations).toEqual([expect.objectContaining({ note: 'edited here' })]);
  });

  test('brings in, updates and removes a server highlight across passes', async () => {
    const { server, state, deps } = setup();
    server.annotations = [
      { id: 7, bookId: 2, cfi: highlight.cfi, text: highlight.text!, color: '#FACC15', note: 'x' },
    ];

    await runGrimmoryPass(deps);
    expect(state.notes).toEqual([
      expect.objectContaining({ id: 'new-1', cfi: highlight.cfi, note: 'x', color: 'yellow' }),
    ]);
    expect(server.createAnnotation).not.toHaveBeenCalled();

    server.annotations[0]!.note = 'edited on the web';
    await runGrimmoryPass(deps);
    expect(state.notes[0]!.note).toBe('edited on the web');
    expect(server.updateAnnotation).not.toHaveBeenCalled();

    server.annotations = [];
    await runGrimmoryPass(deps);
    expect(state.notes[0]!.deletedAt).toBeTruthy();
  });

  test('a bookmark with a note is created, then given its note', async () => {
    const { server, deps } = setup([
      {
        id: 'b1',
        type: 'bookmark',
        cfi: 'epubcfi(/6/8!/4/2/10)',
        text: 'Chapter I',
        note: 'remember',
        createdAt: 1000,
        updatedAt: 1000,
      },
    ]);
    await runGrimmoryPass(deps);
    expect(server.bookmarks).toEqual([
      expect.objectContaining({
        cfi: 'epubcfi(/6/8!/4/2/10)',
        title: 'Chapter I',
        notes: 'remember',
      }),
    ]);
  });

  test('a duplicate CFI (409) is left for the next pass to pair', async () => {
    const { server, store, deps } = setup([highlight]);
    // Created at this CFI by another client between the list and the create.
    server.getAnnotations.mockResolvedValueOnce([]);
    server.annotations = [{ id: 7, bookId: 2, cfi: highlight.cfi, text: highlight.text! }];

    await runGrimmoryPass(deps);
    expect(store.links).toEqual([]);

    await runGrimmoryPass(deps);
    expect(store.links).toEqual([
      { noteId: 'n1', kind: 'annotation', serverId: 7, localUpdatedAt: 1000 },
    ]);
  });

  test('sends a reading status once per change', async () => {
    const { server, deps } = setup();
    const book = { ...deps.book, readingStatus: 'finished' as const, readingStatusUpdatedAt: 10 };
    await runGrimmoryPass({ ...deps, book });
    await runGrimmoryPass({ ...deps, book });
    expect(server.statuses).toEqual(['READ']);

    await runGrimmoryPass({
      ...deps,
      book: { ...book, readingStatus: 'abandoned', readingStatusUpdatedAt: 20 },
    });
    // Readest shows 'abandoned' as On hold, which is Grimmory's Paused.
    expect(server.statuses).toEqual(['READ', 'PAUSED']);
  });

  test('forgets the match when the book is gone from the server', async () => {
    const { server, store, deps } = setup();
    await runGrimmoryPass(deps);
    expect(store.books.size).toBe(1);

    server.getAnnotations.mockRejectedValueOnce(new GrimmoryRequestError(404, 'Book not found'));
    await expect(runGrimmoryPass(deps)).rejects.toThrow('Book not found');
    expect(store.books.size).toBe(0);
  });
});
