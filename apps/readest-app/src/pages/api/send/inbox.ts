import type { NextApiRequest, NextApiResponse } from 'next';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { validateUserAndToken } from '@/utils/access';
import { putObject } from '@/utils/object';
import { parseSubjectTag } from '@/services/send/sendAddress';
import { SEND_INBOX_BUCKET, SEND_INBOX_PENDING_LIMIT } from '@/services/constants';
import type { DBSendInboxItem } from '@/types/sendRecords';

const RECENT_LIMIT = 20;
const MAX_CLIP_HTML_BYTES = 5 * 1024 * 1024;

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

  // Anti-abuse: cap undrained items so a leaked token can't flood R2 or the
  // user's library. Count claimed items too — a crashed drainer can leave
  // items stuck in `claimed` until the lease expires.
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

  const kind = String(req.body?.kind ?? 'url');

  if (kind === 'html') {
    // Bookmarklet / extension path: caller posts the page's rendered HTML.
    // This bypasses bot-protection that would defeat a server-side fetch
    // (CAPTCHAs, login walls, JS-rendered content). The HTML lands in R2 and
    // the drainer converts it identically to the email-attachment flow.
    const html = String(req.body?.html ?? '');
    if (!html) return res.status(400).json({ error: 'html is required' });
    const bytes = new TextEncoder().encode(html);
    if (bytes.byteLength > MAX_CLIP_HTML_BYTES) {
      return res.status(413).json({ error: 'Page is too large to send' });
    }
    const title = req.body?.title ? String(req.body.title).slice(0, 500) : null;
    const sourceUrl = req.body?.url ? String(req.body.url).slice(0, 2000) : null;

    const { data: row, error: rowError } = await supabase
      .from('send_inbox')
      .insert({
        user_id: user.id,
        kind: 'html',
        source: 'extension',
        url: sourceUrl,
        filename: title,
        byte_size: bytes.byteLength,
        subject_tag: parseSubjectTag(title) ?? null,
      })
      .select('id')
      .single<{ id: string }>();
    if (rowError) return res.status(500).json({ error: rowError.message });

    const payloadKey = `inbox/${user.id}/${row.id}/page.html`;
    try {
      await putObject(payloadKey, bytes.buffer, 'text/html; charset=utf-8', SEND_INBOX_BUCKET);
    } catch (err) {
      // Roll back the inbox row so we never leave a `pending` item the
      // drainer would only fail on.
      await supabase.from('send_inbox').delete().eq('id', row.id);
      console.error('Inbox clip upload failed:', err);
      return res.status(500).json({ error: 'Could not store page' });
    }

    const { error: updateError } = await supabase
      .from('send_inbox')
      .update({ payload_key: payloadKey })
      .eq('id', row.id);
    if (updateError) return res.status(500).json({ error: updateError.message });

    return res.status(200).json({ id: row.id });
  }

  // kind === 'url' (legacy extension path)
  const url = String(req.body?.url ?? '').trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'A valid http(s) URL is required' });
  }
  const title = req.body?.title ? String(req.body.title) : null;

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
