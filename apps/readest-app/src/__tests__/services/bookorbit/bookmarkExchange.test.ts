import { describe, expect, it } from 'vitest';
import {
  applyBookmarkResult,
  buildBookmarkExchangeBook,
} from '@/services/bookorbit/bookmarkExchange';
import { bookOrbitKey, bookOrbitNoteId, formatKoDatetime } from '@/services/bookorbit/noteMapping';
import type { BookmarkExchangeBookResult } from '@/services/bookorbit/types';
import type { BookNote } from '@/types/book';

const HASH = 'b'.repeat(32);

const makeBookmark = (overrides: Partial<BookNote>): BookNote => ({
  id: 'bm1',
  type: 'bookmark',
  cfi: 'epubcfi(/6/8!/4/2/1:0)',
  xpointer0: '/body/DocFragment[4]/body/p[1]/text().0',
  text: 'page text',
  note: '',
  createdAt: Date.UTC(2026, 7, 1, 8, 0, 0),
  updatedAt: Date.UTC(2026, 7, 1, 8, 0, 0),
  ...overrides,
});

const identityOf = (note: BookNote) => formatKoDatetime(note.createdAt);

const emptyResult = (
  overrides: Partial<BookmarkExchangeBookResult> = {},
): BookmarkExchangeBookResult => ({
  hash: HASH,
  bookId: 1,
  toApply: { add: [], delete: [] },
  more: false,
  ...overrides,
});

describe('buildBookmarkExchangeBook', () => {
  it('includes only live bookmarks and uses pos-based keys', () => {
    const live = makeBookmark({ id: 'live' });
    const annotation = makeBookmark({ id: 'ann', type: 'annotation' });
    const tombstoned = makeBookmark({ id: 'gone', deletedAt: Date.now() });

    const { request, keyToNote } = buildBookmarkExchangeBook(
      HASH,
      [live, annotation, tombstoned],
      identityOf,
      0,
    );

    expect(request.keysComplete).toBe(true);
    expect(request.keys).toEqual([
      { k: bookOrbitKey(identityOf(live), live.xpointer0!), dt: identityOf(live) },
    ]);
    expect(request.changes).toEqual([
      { datetime: identityOf(live), pos: live.xpointer0, note: 'page text' },
    ]);
    expect(keyToNote.get(request.keys[0]!.k)).toBe(live);
  });

  it('caps changes past the watermark', () => {
    const old = makeBookmark({ id: 'old' });
    const fresh = makeBookmark({
      id: 'fresh',
      createdAt: Date.UTC(2026, 7, 3),
      updatedAt: Date.UTC(2026, 7, 3),
    });
    const { request } = buildBookmarkExchangeBook(
      HASH,
      [old, fresh],
      identityOf,
      Date.UTC(2026, 7, 2),
    );
    expect(request.changes).toHaveLength(1);
    expect(request.changes[0]!.datetime).toBe(identityOf(fresh));
  });
});

describe('applyBookmarkResult', () => {
  const NOW = Date.UTC(2026, 7, 5, 12, 0, 0);

  it('creates a bookmark note from an add and acks with the device identity', async () => {
    const add = {
      serverId: 3,
      pos: '/body/DocFragment[6]/body/p[1]/text().0',
      pageno: 9,
      title: 'Chapter 2',
    };
    const plan = await applyBookmarkResult(
      HASH,
      emptyResult({ toApply: { add: [add], delete: [] } }),
      new Map(),
      async () => ({ cfi: 'epubcfi(/6/12!/4/2/1:0)', page: 9, verified: true }),
      NOW,
    );

    expect(plan.upserts).toHaveLength(1);
    const note = plan.upserts[0]!;
    expect(note.id).toBe(bookOrbitNoteId(HASH, 'bookmark', add.pos));
    expect(note.type).toBe('bookmark');
    expect(note.cfi).toBe('epubcfi(/6/12!/4/2/1:0)');
    expect(note.xpointer0).toBe(add.pos);
    expect(note.text).toBe('Chapter 2');
    expect(note.page).toBe(9);
    expect(note.createdAt).toBe(NOW);

    const identityDatetime = formatKoDatetime(NOW);
    expect(plan.ack.applied).toEqual([
      {
        serverId: 3,
        status: 'applied',
        key: bookOrbitKey(identityDatetime, add.pos),
        datetime: identityDatetime,
        pos: add.pos,
      },
    ]);
    expect(plan.identities).toEqual([{ noteId: note.id, datetime: identityDatetime, serverId: 3 }]);
  });

  it('acks failed for unresolvable adds and applied for deletes', async () => {
    const local = makeBookmark({ id: 'gone-soon' });
    const key = bookOrbitKey(identityOf(local), local.xpointer0!);
    const plan = await applyBookmarkResult(
      HASH,
      emptyResult({
        toApply: {
          add: [{ serverId: 8, pos: '/nowhere', pageno: null, title: 'x' }],
          delete: [
            { serverId: 5, key, datetime: identityOf(local) },
            { serverId: 6, key: 'c'.repeat(32), datetime: null },
          ],
        },
      }),
      new Map([[key, local]]),
      async () => null,
      NOW,
    );

    expect(plan.upserts).toHaveLength(0);
    expect(plan.ack.applied).toEqual([{ serverId: 8, status: 'failed' }]);
    expect(plan.deleteNoteIds).toEqual(['gone-soon']);
    expect(plan.ack.deleted).toEqual([
      { serverId: 5, status: 'applied' },
      { serverId: 6, status: 'applied' },
    ]);
  });
});
