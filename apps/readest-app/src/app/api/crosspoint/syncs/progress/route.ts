import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import {
  authenticateDevice,
  BOOK_HASH,
  linkCopy,
  linkedBook,
  parseConfigProgress,
  PERCENT_PAGES,
} from '@/libs/crosspoint';

// PUT /api/crosspoint/syncs/progress — store a CrossPoint position in the book
// config Readest apps already sync, which apply its XPointer when they open
// the book.
export async function PUT(request: Request) {
  const supabase = createSupabaseAdminClient();
  const userId = await authenticateDevice(request, supabase);
  if (typeof userId !== 'string') return userId;

  const body = await request.json().catch(() => null);
  const { document, progress, percentage, metadata } = (body ?? {}) as Record<string, unknown>;
  if (
    typeof document !== 'string' ||
    !BOOK_HASH.test(document) ||
    typeof progress !== 'string' ||
    !progress.startsWith('/body') ||
    progress.length > 4096 ||
    typeof percentage !== 'number' ||
    !(percentage >= 0 && percentage <= 1)
  ) {
    return NextResponse.json({ message: 'Invalid progress' }, { status: 400 });
  }

  // A rewritten copy syncs as the library book it is (or now gets) linked to.
  const linked = await linkedBook(supabase, userId, document);
  if (linked.error)
    return NextResponse.json({ message: 'Could not save progress' }, { status: 500 });
  let newLink: string | null = null;
  if (!linked.bookHash) {
    const link = await linkCopy(supabase, userId, document, metadata);
    if (link.error)
      return NextResponse.json({ message: 'Could not save progress' }, { status: 500 });
    newLink = link.bookHash;
  }
  const bookHash = linked.bookHash ?? newLink ?? document;

  const { data: existing, error: readError } = await supabase
    .from('book_configs')
    .select('xpointer, progress')
    .eq('user_id', userId)
    .eq('book_hash', bookHash)
    .maybeSingle();
  if (readError) return NextResponse.json({ message: 'Could not save progress' }, { status: 500 });

  const now = new Date().toISOString();
  const response = NextResponse.json({ document, timestamp: Math.floor(Date.parse(now) / 1000) });
  const stored = parseConfigProgress(existing?.progress);
  // Without a stored XPointer, or under the copy's own id before this link,
  // the reader's sync found nothing to pull, so it uploads its own position,
  // usually the start of a fresh download. That must not pull back a position
  // Readest is already past.
  if (stored && (newLink || !existing?.xpointer) && percentage < stored[0] / stored[1]) {
    return response;
  }

  // The percentage in the book's Readest page count, or in whole percents
  // until a Readest app has paginated the book.
  const total = stored?.[1] ?? PERCENT_PAGES;
  const pages: [number, number] = [Math.max(1, Math.round(percentage * total)), total];
  const fields = { xpointer: progress, progress: JSON.stringify(pages), updated_at: now };
  // Never overwrite a newer write, from a Readest app or a racing request.
  const { error } = existing
    ? await supabase
        .from('book_configs')
        .update(fields)
        .eq('user_id', userId)
        .eq('book_hash', bookHash)
        .lt('updated_at', now)
    : await supabase
        .from('book_configs')
        .upsert(
          { user_id: userId, book_hash: bookHash, ...fields },
          { onConflict: 'user_id,book_hash', ignoreDuplicates: true },
        );
  if (error) return NextResponse.json({ message: 'Could not save progress' }, { status: 500 });

  // Like /api/sync: keep the library row's progress current, never
  // overwriting a newer books push.
  const { error: booksError } = await supabase
    .from('books')
    .update({ progress: pages, updated_at: now })
    .eq('user_id', userId)
    .eq('book_hash', bookHash)
    .lt('updated_at', now);
  if (booksError) console.warn('books.progress update failed for', bookHash, booksError.message);

  return response;
}
