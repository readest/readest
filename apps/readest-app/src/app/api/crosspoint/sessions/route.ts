import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { DEFAULT_STATS_TRACKING_CONFIG } from '@/types/statistics';
import {
  authenticateDevice,
  BOOK_HASH,
  parseConfigProgress,
  PERCENT_PAGES,
} from '@/libs/crosspoint';

const BASIS_POINTS = 10000;

const isCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

// POST /api/crosspoint/sessions {document, start_time, duration, start_bp, end_bp}
// One reading session from the reader (its reader.session event), recorded
// as Readest page statistics: the session's time spread evenly over the pages
// it covered, in the book's Readest page count, like Readest's own page visits.
export async function POST(request: Request) {
  const supabase = createSupabaseAdminClient();
  const userId = await authenticateDevice(request, supabase);
  if (typeof userId !== 'string') return userId;

  const body = await request.json().catch(() => null);
  const { document, start_time, duration, start_bp, end_bp } = (body ?? {}) as Record<
    string,
    unknown
  >;
  if (
    typeof document !== 'string' ||
    !BOOK_HASH.test(document) ||
    !isCount(start_time) ||
    !isCount(duration) ||
    !isCount(start_bp) ||
    !isCount(end_bp) ||
    start_time === 0 ||
    duration === 0
  ) {
    // The reader retries a failed delivery before sending any later event, so
    // a session that can never be recorded is dropped instead of refused.
    return NextResponse.json({ pages: 0 });
  }

  // Readest's page count once a Readest app has paginated the book, else whole percents.
  const { data: config, error } = await supabase
    .from('book_configs')
    .select('progress')
    .eq('user_id', userId)
    .eq('book_hash', document)
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'Could not read the book' }, { status: 500 });
  const total = parseConfigProgress(config?.progress)?.[1] ?? PERCENT_PAGES;

  const pageAt = (bp: number) =>
    Math.min(total, Math.floor((Math.min(bp, BASIS_POINTS) * total) / BASIS_POINTS) + 1);
  const first = pageAt(Math.min(start_bp, end_bp));
  const last = pageAt(Math.max(start_bp, end_bp));
  // Readest drops page visits shorter than this. A session that crossed more
  // pages than its time allows skipped ahead; it read the pages it ended on.
  const count = Math.min(
    last - first + 1,
    Math.max(1, Math.floor(duration / DEFAULT_STATS_TRACKING_CONFIG.minEventSeconds)),
  );
  const rows = Array.from({ length: count }, (_, i) => {
    const from = Math.floor((i * duration) / count);
    const to = Math.floor(((i + 1) * duration) / count);
    return {
      user_id: userId,
      book_hash: document,
      page: last - count + 1 + i,
      start_time: start_time + from,
      duration: to - from,
      total_pages: total,
    };
  });

  // The same event delivered again yields the same rows and adds nothing.
  const { error: upsertError } = await supabase
    .from('stat_pages')
    .upsert(rows, { onConflict: 'user_id,book_hash,page,start_time', ignoreDuplicates: true });
  if (upsertError) {
    return NextResponse.json({ error: 'Could not record the session' }, { status: 500 });
  }
  return NextResponse.json({ pages: rows.length });
}
