import type { NextApiRequest, NextApiResponse } from 'next';
import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseClient } from '@/utils/supabase';
import { validateUserAndToken } from '@/utils/access';
import { runMiddleware, corsAllMethods } from '@/utils/cors';
import { mergeEntries } from '@/services/vocabulary/entry';
import {
  MAX_PULL_ROWS,
  MAX_PUSH_ROWS,
  entryToRow,
  rowToEntry,
  validateRow,
  type VocabularyRow,
} from '@/services/vocabulary/wire';

// Vocabulary builder sync (#789). One row per word in `public.vocabulary`
// (migration 032). The pull is keyset-paged on the server-stamped
// (updated_at, id), so a page cut inside a run of rows sharing one timestamp
// can't skip any. The push merges each row with the stored one (state and hint
// from the newer edit, sentences unioned) instead of overwriting it.

const errorResponse = (status: number, message: string) =>
  NextResponse.json({ error: message }, { status });

// PostgREST filter values: quote so ids holding commas or parentheses, and
// timestamps holding `+`, can't break the `or=(…)` grammar.
const quote = (v: string) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

export async function GET(req: NextRequest) {
  const { user, token } = await validateUserAndToken(req.headers.get('authorization'));
  if (!user || !token) return errorResponse(401, 'Not authenticated');
  const supabase = createSupabaseClient(token);

  const params = new URL(req.url).searchParams;
  const sinceTs = params.get('since_ts');
  const sinceId = params.get('since_id') ?? '';
  const requested = Math.floor(Number(params.get('limit')));
  const limit = requested > 0 ? Math.min(requested, MAX_PULL_ROWS) : MAX_PULL_ROWS;

  let query = supabase.from('vocabulary').select('*').eq('user_id', user.id);
  if (sinceTs) {
    const ts = quote(sinceTs);
    query = query.or(`updated_at.gt.${ts},and(updated_at.eq.${ts},id.gt.${quote(sinceId)})`);
  }
  const { data, error } = await query
    .order('updated_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(limit);
  if (error) {
    console.error('pull vocabulary failed', error);
    return errorResponse(500, error.message);
  }
  return NextResponse.json({ rows: data ?? [] }, { status: 200 });
}

export async function POST(req: NextRequest) {
  const { user, token } = await validateUserAndToken(req.headers.get('authorization'));
  if (!user || !token) return errorResponse(401, 'Not authenticated');

  let rows: unknown;
  try {
    rows = ((await req.json()) as { rows?: unknown }).rows;
  } catch {
    return errorResponse(400, 'Invalid JSON body');
  }
  if (!Array.isArray(rows)) return errorResponse(400, '"rows" must be an array');
  if (rows.length > MAX_PUSH_ROWS) return errorResponse(413, `at most ${MAX_PUSH_ROWS} rows`);
  // A malformed row is skipped and reported rather than failing the batch:
  // otherwise one bad word would block every later push from that device.
  const incoming: VocabularyRow[] = [];
  const rejected: string[] = [];
  for (const r of rows) {
    if (validateRow(r)) rejected.push(String((r as { id?: unknown })?.id ?? ''));
    else incoming.push(r as VocabularyRow);
  }
  if (!incoming.length) return NextResponse.json({ rows: [], rejected }, { status: 200 });

  const supabase = createSupabaseClient(token);
  const { data: existing, error: readError } = await supabase
    .from('vocabulary')
    .select('*')
    .eq('user_id', user.id)
    .in(
      'id',
      incoming.map((r) => r.id),
    );
  if (readError) {
    console.error('read vocabulary failed', readError);
    return errorResponse(500, readError.message);
  }

  const stored = new Map((existing as VocabularyRow[] | null)?.map((r) => [r.id, r]) ?? []);
  const updatedAt = new Date().toISOString();
  const merged = new Map<string, VocabularyRow & { user_id: string; updated_at: string }>();
  for (const r of incoming) {
    const prior = merged.get(r.id) ?? stored.get(r.id);
    const entry = prior ? mergeEntries(rowToEntry(prior), rowToEntry(r)) : rowToEntry(r);
    merged.set(r.id, { ...entryToRow(entry), user_id: user.id, updated_at: updatedAt });
  }

  const { data, error } = await supabase
    .from('vocabulary')
    .upsert([...merged.values()], { onConflict: 'user_id,id' })
    .select('*');
  if (error) {
    console.error('upsert vocabulary failed', error);
    return errorResponse(500, error.message);
  }
  return NextResponse.json({ rows: data ?? [], rejected }, { status: 200 });
}

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (!req.url) {
    return res.status(400).json({ error: 'Invalid request URL' });
  }
  const protocol = process.env['PROTOCOL'] || 'http';
  const host = process.env['HOST'] || 'localhost:3000';
  const url = new URL(req.url, `${protocol}://${host}`);

  await runMiddleware(req, res, corsAllMethods);

  try {
    let response: Response;
    if (req.method === 'GET') {
      const nextReq = new NextRequest(url.toString(), {
        headers: new Headers(req.headers as Record<string, string>),
        method: 'GET',
      });
      response = await GET(nextReq);
    } else if (req.method === 'POST') {
      const nextReq = new NextRequest(url.toString(), {
        headers: new Headers(req.headers as Record<string, string>),
        method: 'POST',
        body: JSON.stringify(req.body),
      });
      response = await POST(nextReq);
    } else {
      res.setHeader('Allow', ['GET', 'POST']);
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    res.status(response.status);
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });
    res.send(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error('Error processing /api/sync/vocabulary request:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export default handler;
