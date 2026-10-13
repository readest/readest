import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { getDownloadSignedUrl } from '@/utils/object';
import { authenticateDevice, BOOK_HASH } from '@/libs/crosspoint';

// GET /api/crosspoint/books/:hash — a short-lived link to one EPUB in the
// owner's cloud library, the catalog's download hop.
export async function GET(request: Request, { params }: { params: Promise<{ hash: string }> }) {
  const supabase = createSupabaseAdminClient();
  const userId = await authenticateDevice(request, supabase);
  if (typeof userId !== 'string') return userId;

  const { hash } = await params;
  if (!BOOK_HASH.test(hash)) return NextResponse.json({ error: 'Invalid book' }, { status: 400 });

  const { data, error } = await supabase
    .from('files')
    .select('file_key')
    .eq('user_id', userId)
    .eq('book_hash', hash)
    .is('deleted_at', null);
  if (error) return NextResponse.json({ error: 'Could not find the book' }, { status: 500 });
  const file = (data ?? []).find((f) => (f.file_key as string).toLowerCase().endsWith('.epub'));
  if (!file) return NextResponse.json({ error: 'Book not found' }, { status: 404 });

  try {
    return NextResponse.json({ downloadUrl: await getDownloadSignedUrl(file.file_key, 1800) });
  } catch (e) {
    console.error('crosspoint book download link failed:', e);
    return NextResponse.json({ error: 'Could not link the book' }, { status: 500 });
  }
}
