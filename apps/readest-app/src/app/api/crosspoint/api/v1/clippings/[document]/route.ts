import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { authenticateDevice, BOOK_HASH, resolveDocument } from '@/libs/crosspoint';

// CrossPoint 2.0 syncs a book's clippings (highlights) before its progress,
// through crosspoint-sync's clippings API (sync_version 2) under the KOSync
// server, and a failure stops the whole sync. A clipping is a Readest
// highlight in book_notes whose `crosspoint` column anchors it for the reader,
// the way xpointer0/xpointer1 anchor KOReader's: Readest apps turn it into a
// CFI when they open the book, and anchor their own EPUB highlights.

const MAX_TEXT_BYTES = 4096;
// CLIPPING_MAX_PER_BOOK on the X3/X4 (ESP32-C3). A new clipping past it stops
// the reader's sync for good, as every sync restarts at the first item.
const MAX_ITEMS = 256;
const MAX_BATCH = 50;
const ITEM_ID = /^[!-~]{1,64}$/;
const LAYOUT_HINTS = ['start_page', 'end_page', 'pages', 'start_word', 'end_word', 'words'];
const ANCHOR_NUMBERS = [
  'spine',
  ...LAYOUT_HINTS,
  'para',
  'layout_signature',
  'start_offset',
  'end_offset',
];
const MAX_CHAPTER = 64;

const isUint = (value: unknown, max: number): value is number =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) <= max;
const u16 = (value: unknown) => (isUint(value, 0xffff) ? value : 0);
const u32 = (value: unknown) => (isUint(value, 0xffffffff) ? value : 0);

const utf8Length = (text: string) => new TextEncoder().encode(text).length;

const truncateUtf8 = (text: string, maxBytes: number) => {
  let bytes = 0;
  let end = 0;
  for (const char of text) {
    bytes += utf8Length(char);
    if (bytes > maxBytes) break;
    end += char.length;
  }
  return text.slice(0, end);
};

/** Where the reader says the clipping is, and nothing else it sent. */
const pickAnchor = (item: Record<string, unknown>): Record<string, unknown> => ({
  ...Object.fromEntries(
    ANCHOR_NUMBERS.filter((field) => typeof item[field] === 'number').map((f) => [f, item[f]]),
  ),
  ...(typeof item['chapter'] === 'string'
    ? { chapter: item['chapter'].slice(0, MAX_CHAPTER) }
    : {}),
});

const hasOffsets = (anchor: Record<string, unknown>) =>
  isUint(anchor['start_offset'], 0xfffffffe) &&
  isUint(anchor['end_offset'], 0xfffffffe) &&
  anchor['start_offset'] < anchor['end_offset'];

interface NoteRow {
  id: string;
  text: string | null;
  crosspoint: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** The note as CrossPoint decodes a clipping (ClippingSync.cpp), or null if it can't. */
const toItem = (row: NoteRow) => {
  const revision = Date.parse(row.updated_at) || 0;
  if (!ITEM_ID.test(row.id)) return null;
  if (row.deleted_at) return { id: row.id, deleted: 1, revision };
  const anchor = row.crosspoint ?? {};
  if (!isUint(anchor['spine'], 0xffff) || !row.text) return null;
  return {
    id: row.id,
    deleted: 0,
    revision,
    spine: anchor['spine'],
    ...Object.fromEntries(LAYOUT_HINTS.map((hint) => [hint, u16(anchor[hint])])),
    ...(isUint(anchor['para'], 0xfffe) ? { para: anchor['para'] } : {}),
    chapter: typeof anchor['chapter'] === 'string' ? anchor['chapter'] : '',
    text: truncateUtf8(row.text, MAX_TEXT_BYTES),
    created_at: u32(Math.floor(Date.parse(row.created_at) / 1000)),
    layout_signature: u32(anchor['layout_signature']),
    ...(hasOffsets(anchor)
      ? { start_offset: anchor['start_offset'], end_offset: anchor['end_offset'] }
      : {}),
  };
};

/** The library book a reader's document is: its own hash, or the book a copy is linked to. */
const resolveBook = async (
  request: Request,
  params: Promise<{ document: string }>,
): Promise<NextResponse | { userId: string; document: string; bookHash: string }> => {
  const supabase = createSupabaseAdminClient();
  const userId = await authenticateDevice(request, supabase);
  if (typeof userId !== 'string') return userId;
  const { document } = await params;
  if (!BOOK_HASH.test(document))
    return NextResponse.json({ message: 'Invalid document' }, { status: 400 });
  const link = await resolveDocument(supabase, userId, document);
  if (link.error)
    return NextResponse.json({ message: 'Could not sync clippings' }, { status: 500 });
  return { userId, document, bookHash: link.bookHash ?? document };
};

// GET ...?cursor=N&limit=1&format=reader — the book's highlights from the
// N-th on. The reader asks for one at a time from 0 on every sync, so the
// cursor is a position in a list ordered by creation.
export async function GET(request: Request, { params }: { params: Promise<{ document: string }> }) {
  const book = await resolveBook(request, params);
  if (book instanceof NextResponse) return book;
  const query = new URL(request.url).searchParams;
  const cursor = Number(query.get('cursor') ?? 0);
  const limit = Math.min(Math.max(Number(query.get('limit')) || 50, 1), 100);
  if (!Number.isSafeInteger(cursor) || cursor < 0)
    return NextResponse.json({ message: 'Invalid cursor' }, { status: 400 });

  const { data, error } = await createSupabaseAdminClient()
    .from('book_notes')
    .select('id, text, crosspoint, created_at, updated_at, deleted_at')
    .eq('user_id', book.userId)
    .eq('book_hash', book.bookHash)
    .eq('type', 'annotation')
    .not('crosspoint', 'is', null)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) return NextResponse.json({ message: 'Could not sync clippings' }, { status: 500 });

  let live = 0;
  const items = ((data ?? []) as NoteRow[])
    .map(toItem)
    .filter((item) => item && (item.deleted || ++live <= MAX_ITEMS));
  const page = items.slice(cursor, cursor + limit);
  return NextResponse.json({
    document: book.document,
    sync_version: 2,
    cursor: cursor + page.length,
    more: cursor + page.length < items.length,
    items: page,
  });
}

// PUT { items: [...] } — clippings the reader saved or deleted. A new one is
// a highlight with no CFI yet; a retried upload, or one deleted meanwhile, is
// left as it is.
export async function PUT(request: Request, { params }: { params: Promise<{ document: string }> }) {
  const book = await resolveBook(request, params);
  if (book instanceof NextResponse) return book;
  const body = await request.json().catch(() => null);
  const items = (body as { items?: unknown } | null)?.items;
  const invalid = NextResponse.json({ message: 'Invalid clippings' }, { status: 400 });
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_BATCH) return invalid;

  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const writes: Array<() => PromiseLike<{ error: unknown }>> = [];
  const supabase = createSupabaseAdminClient();
  const notes = () => supabase.from('book_notes');
  for (const item of items as Record<string, unknown>[]) {
    const { id, deleted, text, created_at: createdAt } = item ?? {};
    const anchor = pickAnchor(item ?? {});
    if (typeof id !== 'string' || !ITEM_ID.test(id)) return invalid;
    if (deleted === 1 || deleted === true) {
      writes.push(() =>
        notes()
          .update({ deleted_at: now, updated_at: now })
          .eq('user_id', book.userId)
          .eq('book_hash', book.bookHash)
          .eq('id', id)
          .is('deleted_at', null),
      );
      continue;
    }
    const offsets = [anchor['start_offset'], anchor['end_offset']];
    if (
      typeof text !== 'string' ||
      !text ||
      utf8Length(text) > MAX_TEXT_BYTES ||
      !isUint(anchor['spine'], 0xffff) ||
      (offsets.some((v) => v !== undefined) && !hasOffsets(anchor))
    ) {
      return invalid;
    }
    const created = isUint(createdAt, 0xffffffff) && createdAt > 0 ? createdAt * 1000 : nowMs;
    writes.push(() =>
      notes().upsert(
        {
          user_id: book.userId,
          book_hash: book.bookHash,
          id,
          type: 'annotation',
          style: 'highlight',
          color: 'yellow',
          text,
          note: '',
          crosspoint: anchor,
          created_at: new Date(created).toISOString(),
          updated_at: now,
        },
        { onConflict: 'user_id,book_hash,id', ignoreDuplicates: true },
      ),
    );
  }
  for (const write of writes) {
    const { error } = await write();
    if (error) return NextResponse.json({ message: 'Could not sync clippings' }, { status: 500 });
  }
  return NextResponse.json({ until: Math.floor(nowMs / 1000), accepted: items.length });
}
