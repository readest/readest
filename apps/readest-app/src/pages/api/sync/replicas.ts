import type { NextApiRequest, NextApiResponse } from 'next';
import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseClient } from '@/utils/supabase';
import { validateUserAndToken } from '@/utils/access';
import { runMiddleware, corsAllMethods } from '@/utils/cors';
import { validatePullBatch, validatePullParams, validatePushBatch } from '@/libs/replicaSyncServer';
import type { ReplicaRow } from '@/types/replica';

const errorResponse = (status: number, code: string, message: string, offendingIndex?: number) =>
  NextResponse.json(
    {
      error: message,
      code,
      ...(typeof offendingIndex === 'number' ? { offendingIndex } : {}),
    },
    { status },
  );

export async function POST(req: NextRequest) {
  const { user, token } = await validateUserAndToken(req.headers.get('authorization'));
  if (!user || !token) {
    return errorResponse(401, 'AUTH', 'Not authenticated');
  }
  const supabase = createSupabaseClient(token);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, 'VALIDATION', 'Invalid JSON body');
  }

  // Body discriminator: `{ cursors: [...] }` is a batched pull (replaces
  // N parallel `GET ?kind=K&since=…` calls with a single Worker
  // invocation); `{ rows: [...] }` is the existing push.
  if (typeof body === 'object' && body !== null && 'cursors' in body) {
    const validation = validatePullBatch(body);
    if (!validation.ok) {
      return errorResponse(
        validation.status,
        validation.code,
        validation.message,
        validation.offendingIndex,
      );
    }
    const { cursors } = validation.params;
    if (cursors.length === 0) {
      return NextResponse.json({ results: [] }, { status: 200 });
    }
    // Per-kind queries run in parallel: each is the same SELECT the
    // single-kind GET issues, just dispatched together. Supabase calls
    // inside a Worker aren't billed as Cloudflare requests, so this
    // collapses N Worker invocations to 1 without changing DB load.
    try {
      const tasks = cursors.map(async ({ kind, since }) => {
        let query = supabase
          .from('replicas')
          .select('*')
          .eq('user_id', user.id)
          .eq('kind', kind)
          .order('updated_at_ts', { ascending: true })
          .limit(1000);
        if (since) query = query.gt('updated_at_ts', since);
        const { data, error } = await query;
        if (error) throw new Error(`pull replicas (kind=${kind}) failed: ${error.message}`);
        return { kind, rows: (data ?? []) as ReplicaRow[] };
      });
      const results = await Promise.all(tasks);
      return NextResponse.json({ results }, { status: 200 });
    } catch (error) {
      console.error('batch pull replicas failed', { cursors, error });
      const message = error instanceof Error ? error.message : 'unknown error';
      return errorResponse(500, 'SERVER', message);
    }
  }

  const validation = validatePushBatch(body, user.id, Date.now());
  if (!validation.ok) {
    return errorResponse(
      validation.status,
      validation.code,
      validation.message,
      validation.offendingIndex,
    );
  }

  const merged: ReplicaRow[] = [];
  for (const row of validation.rows) {
    const { data, error } = await supabase
      .rpc('crdt_merge_replica', {
        p_user_id: row.user_id,
        p_kind: row.kind,
        p_replica_id: row.replica_id,
        p_fields_jsonb: row.fields_jsonb,
        p_manifest_jsonb: row.manifest_jsonb,
        p_deleted_at_ts: row.deleted_at_ts,
        p_reincarnation: row.reincarnation,
        p_updated_at_ts: row.updated_at_ts,
        p_schema_version: row.schema_version,
      })
      .single<ReplicaRow>();

    if (error) {
      console.error('crdt_merge_replica failed', { row, error });
      return errorResponse(500, 'SERVER', error.message);
    }
    if (data) merged.push(data);
  }

  return NextResponse.json({ rows: merged }, { status: 200 });
}

export async function GET(req: NextRequest) {
  const { user, token } = await validateUserAndToken(req.headers.get('authorization'));
  if (!user || !token) {
    return errorResponse(401, 'AUTH', 'Not authenticated');
  }
  const supabase = createSupabaseClient(token);

  const { searchParams } = new URL(req.url);
  const validation = validatePullParams(searchParams.get('kind'), searchParams.get('since'));
  if (!validation.ok) {
    return errorResponse(validation.status, validation.code, validation.message);
  }
  const { kind, since } = validation.params;

  let query = supabase
    .from('replicas')
    .select('*')
    .eq('user_id', user.id)
    .eq('kind', kind)
    .order('updated_at_ts', { ascending: true })
    .limit(1000);

  if (since) query = query.gt('updated_at_ts', since);

  const { data, error } = await query;
  if (error) {
    console.error('pull replicas failed', { kind, since, error });
    return errorResponse(500, 'SERVER', error.message);
  }

  return NextResponse.json({ rows: data ?? [] }, { status: 200 });
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

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    res.send(buffer);
  } catch (error) {
    console.error('Error processing /api/sync/replicas request:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export default handler;
