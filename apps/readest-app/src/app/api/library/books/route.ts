import { NextResponse } from 'next/server';
import { validateUserAndToken } from '@/utils/access';
import { createSupabaseClient } from '@/utils/supabase';
import { CLOUD_BOOKS_SUBDIR } from '@/services/constants';

const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 50;

// GET /api/library/books?page=<1-based>&per_page=<n>&q=<text>
// One page of the caller's uploaded EPUBs for e-reader catalogs that page by
// number (the CrossPoint SD plugin). Up to per_page + 1 items come back: the
// extra row tells the caller another page exists. Each item links to
// /api/storage/download, which resolves the hash-named key to the stored file.
export async function GET(request: Request) {
  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const url = new URL(request.url);
  const page = Math.max(1, Math.floor(Number(url.searchParams.get('page')) || 1));
  const perPage = Math.min(
    MAX_PER_PAGE,
    Math.max(1, Math.floor(Number(url.searchParams.get('per_page')) || DEFAULT_PER_PAGE)),
  );
  // Commas and parentheses are PostgREST or() syntax.
  const q = (url.searchParams.get('q') ?? '').replace(/[,()]/g, '').trim();

  const supabase = createSupabaseClient(token);
  let query = supabase
    .from('books')
    .select('book_hash, title, author')
    .eq('user_id', user.id)
    .eq('format', 'EPUB')
    .is('deleted_at', null)
    .not('uploaded_at', 'is', null);
  if (q) query = query.or(`title.ilike.%${q}%,author.ilike.%${q}%`);
  const { data, error } = await query
    .order('updated_at', { ascending: false })
    .order('book_hash')
    .range((page - 1) * perPage, page * perPage);
  if (error) {
    console.error('library books list failed:', error);
    return NextResponse.json({ error: 'Could not list books' }, { status: 500 });
  }

  return NextResponse.json({
    items: (data ?? []).map((book) => {
      const fileKey = `${user.id}/${CLOUD_BOOKS_SUBDIR}/${book.book_hash}/${book.book_hash}.epub`;
      return {
        id: book.book_hash,
        title: book.title,
        author: book.author,
        url: `${url.origin}/api/storage/download?fileKey=${encodeURIComponent(fileKey)}`,
      };
    }),
  });
}
