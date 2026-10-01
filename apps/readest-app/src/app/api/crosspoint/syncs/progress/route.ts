import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { authenticateKosync, parseConfigProgress } from '@/libs/kosyncServer';

// PUT /api/crosspoint/syncs/progress — store a CrossPoint position in the book
// config Readest apps already sync, which apply its XPointer when they open
// the book.
export async function PUT(request: Request) {
  const supabase = createSupabaseAdminClient();
  const userId = await authenticateKosync(request, supabase);
  if (!userId) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const { document, progress, percentage } = (body ?? {}) as Record<string, unknown>;
  if (
    typeof document !== 'string' ||
    !/^[0-9a-f]{32}$/.test(document) ||
    typeof progress !== 'string' ||
    !progress.startsWith('/body') ||
    progress.length > 4096 ||
    typeof percentage !== 'number' ||
    !(percentage >= 0 && percentage <= 1)
  ) {
    return NextResponse.json({ message: 'Invalid progress' }, { status: 400 });
  }

  // Express the percentage in the book's Readest page count, when Readest has one.
  const { data: existing } = await supabase
    .from('book_configs')
    .select('progress')
    .eq('user_id', userId)
    .eq('book_hash', document)
    .maybeSingle();
  const total = parseConfigProgress(existing?.progress)?.[1];
  const pages: [number, number] | null = total
    ? [Math.max(1, Math.round(percentage * total)), total]
    : null;

  const now = new Date().toISOString();
  const { error } = await supabase.from('book_configs').upsert(
    {
      user_id: userId,
      book_hash: document,
      xpointer: progress,
      ...(pages && { progress: JSON.stringify(pages) }),
      updated_at: now,
    },
    { onConflict: 'user_id,book_hash' },
  );
  if (error) return NextResponse.json({ message: 'Could not save progress' }, { status: 500 });

  if (pages) {
    // Like /api/sync: keep the library row's progress current, never
    // overwriting a newer books push.
    const { error: booksError } = await supabase
      .from('books')
      .update({ progress: pages, updated_at: now })
      .eq('user_id', userId)
      .eq('book_hash', document)
      .lt('updated_at', now);
    if (booksError) console.warn('books.progress update failed for', document, booksError.message);
  }

  return NextResponse.json({ document, timestamp: Math.floor(Date.parse(now) / 1000) });
}
