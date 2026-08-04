import { describe, expect, it } from 'vitest';
import {
  applyAnnotationResult,
  buildAnnotationExchangeBook,
} from '@/services/bookorbit/annotationExchange';
import { bookOrbitKey, bookOrbitNoteId, formatKoDatetime } from '@/services/bookorbit/noteMapping';
import type {
  ExchangeAddEntry,
  ExchangeBookResult,
  ExchangeDeleteEntry,
  ExchangeEditEntry,
} from '@/services/bookorbit/types';
import type { BookNote } from '@/types/book';

const HASH = 'a'.repeat(32);

const makeNote = (overrides: Partial<BookNote>): BookNote => ({
  id: 'n1',
  type: 'annotation',
  cfi: 'epubcfi(/6/8!/4/2/1:0)',
  xpointer0: '/body/DocFragment[4]/body/p[1]/text().0',
  xpointer1: '/body/DocFragment[4]/body/p[1]/text().5',
  text: 'quote',
  style: 'highlight',
  color: 'yellow',
  note: '',
  createdAt: Date.UTC(2026, 7, 1, 8, 0, 0),
  updatedAt: Date.UTC(2026, 7, 1, 8, 0, 0),
  ...overrides,
});

const identityOf = (note: BookNote) => formatKoDatetime(note.createdAt);

const emptyResult = (overrides: Partial<ExchangeBookResult> = {}): ExchangeBookResult => ({
  hash: HASH,
  bookId: 1,
  toApply: { add: [], edit: [], delete: [] },
  more: false,
  skippedNoPosition: 0,
  ...overrides,
});

describe('buildAnnotationExchangeBook', () => {
  it('keys live annotations only and marks the key list complete', () => {
    const live = makeNote({ id: 'live' });
    const tombstoned = makeNote({ id: 'gone', deletedAt: Date.now() });
    const bookmark = makeNote({ id: 'bm', type: 'bookmark' });
    const noPointer = makeNote({ id: 'nx', xpointer0: undefined });

    const { request, keyToNote } = buildAnnotationExchangeBook(
      HASH,
      [live, tombstoned, bookmark, noPointer],
      identityOf,
      Date.UTC(2026, 7, 2),
    );

    expect(request.hash).toBe(HASH);
    expect(request.keysComplete).toBe(true);
    expect(request.keys).toEqual([
      { k: bookOrbitKey(identityOf(live), live.xpointer0!), dt: identityOf(live) },
    ]);
    expect(keyToNote.get(request.keys[0]!.k)).toBe(live);
  });

  it('sends only notes past the watermark as changes, capped', () => {
    const old = makeNote({ id: 'old' });
    const fresh = makeNote({
      id: 'fresh',
      createdAt: Date.UTC(2026, 7, 3),
      updatedAt: Date.UTC(2026, 7, 3),
    });
    const edited = makeNote({ id: 'edited', updatedAt: Date.UTC(2026, 7, 4) });

    const { request } = buildAnnotationExchangeBook(
      HASH,
      [old, fresh, edited],
      identityOf,
      Date.UTC(2026, 7, 2),
    );
    expect(request.changes.map((c) => c.datetime)).toEqual([identityOf(fresh), identityOf(edited)]);

    const capped = buildAnnotationExchangeBook(HASH, [old, fresh, edited], identityOf, 0, 1);
    expect(capped.request.changes).toHaveLength(1);
  });
});

describe('applyAnnotationResult', () => {
  const NOW = Date.UTC(2026, 7, 5, 12, 0, 0);

  const addEntry = (overrides: Partial<ExchangeAddEntry> = {}): ExchangeAddEntry => ({
    serverId: 7,
    version: 2,
    datetime: '2026-08-01 09:00:00',
    datetimeUpdated: null,
    drawer: 'underscore',
    color: 'purple',
    text: 'server text',
    note: 'server note',
    chapter: null,
    posFormat: 'xpointer',
    pos0: '/body/DocFragment[5]/body/p[2]/text().0',
    pos1: '/body/DocFragment[5]/body/p[2]/text().9',
    pageno: 12,
    ...overrides,
  });

  it('creates a note from a resolvable add and acks applied with identity recorded', async () => {
    const add = addEntry();
    const plan = await applyAnnotationResult(
      HASH,
      emptyResult({ toApply: { add: [add], edit: [], delete: [] } }),
      new Map(),
      async () => ({ cfi: 'epubcfi(/6/10!/4/4/1:0)', page: 3, verified: true }),
      NOW,
    );

    expect(plan.upserts).toHaveLength(1);
    const note = plan.upserts[0]!;
    expect(note.id).toBe(bookOrbitNoteId(HASH, 'annotation', add.pos0, add.pos1 ?? undefined));
    expect(note.type).toBe('annotation');
    expect(note.cfi).toBe('epubcfi(/6/10!/4/4/1:0)');
    expect(note.xpointer0).toBe(add.pos0);
    expect(note.style).toBe('underline');
    expect(note.color).toBe('violet');
    expect(note.text).toBe('server text');
    expect(note.note).toBe('server note');
    expect(note.page).toBe(3);
    expect(note.createdAt).toBe(Date.UTC(2026, 7, 1, 9, 0, 0));
    expect(note.updatedAt).toBe(NOW);
    expect(plan.ack.applied).toEqual([
      { serverId: 7, version: 2, status: 'applied', verified: true },
    ]);
    expect(plan.identities).toEqual([{ noteId: note.id, datetime: add.datetime, serverId: 7 }]);
  });

  it('acks failed when the position does not resolve', async () => {
    const plan = await applyAnnotationResult(
      HASH,
      emptyResult({ toApply: { add: [addEntry()], edit: [], delete: [] } }),
      new Map(),
      async () => null,
      NOW,
    );
    expect(plan.upserts).toHaveLength(0);
    expect(plan.ack.applied).toEqual([{ serverId: 7, version: 2, status: 'failed' }]);
    expect(plan.identities).toHaveLength(0);
  });

  it('acks corrected positions when the resolver re-derives them', async () => {
    const plan = await applyAnnotationResult(
      HASH,
      emptyResult({ toApply: { add: [addEntry()], edit: [], delete: [] } }),
      new Map(),
      async () => ({
        cfi: 'epubcfi(/6/10!/4/4/1:0)',
        verified: true,
        correctedPos0: '/corrected0',
        correctedPos1: '/corrected1',
      }),
      NOW,
    );
    expect(plan.ack.applied[0]).toEqual({
      serverId: 7,
      version: 2,
      status: 'applied',
      verified: true,
      corrected: true,
      pos0: '/corrected0',
      pos1: '/corrected1',
    });
  });

  it('applies edits by key and acks failed for unknown keys', async () => {
    const local = makeNote({ id: 'local' });
    const key = bookOrbitKey(identityOf(local), local.xpointer0!);
    const edit: ExchangeEditEntry = {
      serverId: 9,
      version: 3,
      key,
      datetime: identityOf(local),
      datetimeUpdated: '2026-08-04 10:00:00',
      drawer: 'strikeout',
      color: 'red',
      text: 'quote',
      note: 'edited note',
      chapter: null,
    };
    const unknown: ExchangeEditEntry = { ...edit, serverId: 10, key: 'f'.repeat(32) };

    const plan = await applyAnnotationResult(
      HASH,
      emptyResult({ toApply: { add: [], edit: [edit, unknown], delete: [] } }),
      new Map([[key, local]]),
      async () => null,
      NOW,
    );

    expect(plan.upserts).toHaveLength(1);
    expect(plan.upserts[0]).toMatchObject({
      id: 'local',
      style: 'squiggly',
      color: 'red',
      note: 'edited note',
      updatedAt: NOW,
    });
    expect(plan.ack.applied).toEqual([
      { serverId: 9, version: 3, status: 'applied' },
      { serverId: 10, version: 3, status: 'failed' },
    ]);
  });

  it('collects deletes by key and acks applied even for unknown keys', async () => {
    const local = makeNote({ id: 'byebye' });
    const key = bookOrbitKey(identityOf(local), local.xpointer0!);
    const del: ExchangeDeleteEntry = { serverId: 4, key, datetime: identityOf(local) };
    const unknownDel: ExchangeDeleteEntry = { serverId: 5, key: 'e'.repeat(32), datetime: null };

    const plan = await applyAnnotationResult(
      HASH,
      emptyResult({ toApply: { add: [], edit: [], delete: [del, unknownDel] } }),
      new Map([[key, local]]),
      async () => null,
      NOW,
    );

    expect(plan.deleteNoteIds).toEqual(['byebye']);
    expect(plan.ack.deleted).toEqual([
      { serverId: 4, status: 'applied' },
      { serverId: 5, status: 'applied' },
    ]);
  });
});
