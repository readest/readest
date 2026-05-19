import type { NextApiRequest, NextApiResponse } from 'next';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { validateUserAndToken } from '@/utils/access';
import { parseSubjectTag } from '@/services/send/sendAddress';
import { SEND_INBOX_PENDING_LIMIT } from '@/services/constants';
import type { DBSendInboxItem } from '@/types/sendRecords';

const RECENT_LIMIT = 20;

/**
 * Inbox endpoint — clients route through here instead of querying Supabase
 * directly.
 *  GET  — list the caller's recent inbox items (the "Recent activity" list).
 *  POST — authenticated producer (browser extension): drop a captured URL in.
 *         (The email channel writes `send_inbox` from the email Worker.)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await runMiddleware(req, res, corsAllMethods);

  const { user } = await validateUserAndToken(req.headers['authorization']);
  if (!user) {
    return res.status(403).json({ error: 'Not authenticated' });
  }

  const supabase = createSupabaseAdminClient();

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('send_inbox')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(RECENT_LIMIT)
      .returns<DBSendInboxItem[]>();
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ items: data ?? [] });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const url = String(req.body?.url ?? '').trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'A valid http(s) URL is required' });
  }
  const title = req.body?.title ? String(req.body.title) : null;

  // Anti-abuse: cap undrained items so a leaked address/token can't flood R2
  // or the user's library. Count claimed items too — a crashed drainer can
  // leave items stuck in `claimed` until the lease expires.
  const { count, error: countError } = await supabase
    .from('send_inbox')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .in('status', ['pending', 'claimed']);
  if (countError) {
    return res.status(500).json({ error: countError.message });
  }
  if ((count ?? 0) >= SEND_INBOX_PENDING_LIMIT) {
    return res.status(429).json({ error: 'Inbox is full — open Readest to process pending items' });
  }

  const { data, error } = await supabase
    .from('send_inbox')
    .insert({
      user_id: user.id,
      kind: 'url',
      source: 'extension',
      url,
      filename: title,
      subject_tag: parseSubjectTag(title) ?? null,
    })
    .select('id')
    .single<{ id: string }>();
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ id: data.id });
}
