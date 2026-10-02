import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { authenticateDevice } from '@/libs/crosspoint';

const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 50;
const MAX_PAGE = 10000;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// GET /api/crosspoint/books?page=<1-based>&per_page=<n>&q=<text>
// One page of the owner's uploaded EPUBs for the reader's catalog. Up to
// per_page + 1 items come back: the extra row tells the reader another page
// exists. Each item links to /api/crosspoint/books/:hash for the download.
export async function GET(request: Request) {
  const supabase = createSupabaseAdminClient();
  const userId = await authenticateDevice(request, supabase);
  if (typeof userId !== 'string') return userId;

  const url = new URL(request.url);
  const page = clamp(Math.floor(Number(url.searchParams.get('page'))) || 1, 1, MAX_PAGE);
  const perPage = clamp(
    Math.floor(Number(url.searchParams.get('per_page'))) || DEFAULT_PER_PAGE,
    1,
    MAX_PER_PAGE,
  );
  // Commas and parentheses are PostgREST or() syntax; %, _ and * are wildcards.
  const q = (url.searchParams.get('q') ?? '')
    .replace(/[,()%_*\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let query = supabase
    .from('books')
    .select('book_hash, title, author')
    .eq('user_id', userId)
    .eq('format', 'EPUB')
    .is('deleted_at', null)
    .not('uploaded_at', 'is', null);
  if (q) query = query.or(`title.ilike.%${q}%,author.ilike.%${q}%`);
  // Most recently read first, like Readest's library: opening a book in Readest
  // (or syncing progress from the reader) bumps updated_at, so the user picks
  // the book that leads the list without searching for it on the reader.
  const { data, error } = await query
    .order('updated_at', { ascending: false })
    .order('book_hash')
    .range((page - 1) * perPage, page * perPage);
  if (error) {
    console.error('crosspoint books list failed:', error);
    return NextResponse.json({ error: 'Could not list books' }, { status: 500 });
  }

  return NextResponse.json({
    items: (data ?? []).map((book) => ({
      id: book.book_hash,
      // The reader drops rows without a title, and the title also names the
      // downloaded file, which the reader refuses when it contains "..".
      title: String(book.title || book.book_hash).replace(/\.{2,}/g, '…'),
      author: book.author,
      url: `${url.origin}/api/crosspoint/books/${book.book_hash}`,
    })),
  });
}
