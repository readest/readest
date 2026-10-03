import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { authenticateDevice, parseConfigProgress } from '@/libs/crosspoint';

// GET /api/crosspoint/syncs/progress/:document — the XPointer Readest last
// synced for the book (document = partial MD5 = book_hash).
export async function GET(request: Request, { params }: { params: Promise<{ document: string }> }) {
  const supabase = createSupabaseAdminClient();
  const userId = await authenticateDevice(request, supabase);
  if (typeof userId !== 'string') return userId;

  const { document } = await params;
  const { data, error } = await supabase
    .from('book_configs')
    .select('xpointer, progress, updated_at')
    .eq('user_id', userId)
    .eq('book_hash', document)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) return NextResponse.json({ message: 'Could not read progress' }, { status: 500 });
  // CrossPoint treats 404 as "no remote progress yet".
  if (!data?.xpointer) return NextResponse.json({ message: 'Not found' }, { status: 404 });

  const progress = parseConfigProgress(data.progress);
  return NextResponse.json({
    document,
    progress: data.xpointer,
    percentage: progress ? progress[0] / progress[1] : 0,
    device: 'Readest',
    device_id: 'readest',
    timestamp: Math.floor(Date.parse(data.updated_at) / 1000),
  });
}
