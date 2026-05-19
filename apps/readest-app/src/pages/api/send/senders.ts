import type { NextApiRequest, NextApiResponse } from 'next';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { validateUserAndToken } from '@/utils/access';
import { normalizeSenderEmail } from '@/services/send/sendAddress';
import type { DBSendAllowedSender } from '@/types/sendRecords';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The approved-sender allowlist.
 *  GET    — list the caller's senders (approved + pending).
 *  POST   — add an approved sender `{ email }`.
 *  PATCH  — approve a pending sender `{ id }`.
 *  DELETE — remove a sender `{ id }`.
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
      .from('send_allowed_senders')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
      .returns<DBSendAllowedSender[]>();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ senders: data ?? [] });
  }

  if (req.method === 'POST') {
    const email = normalizeSenderEmail(String(req.body?.email ?? ''));
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }
    const { data, error } = await supabase
      .from('send_allowed_senders')
      .upsert({ user_id: user.id, email, status: 'approved' }, { onConflict: 'user_id,email' })
      .select()
      .single<DBSendAllowedSender>();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ sender: data });
  }

  if (req.method === 'PATCH') {
    const id = String(req.body?.id ?? '');
    if (!id) return res.status(400).json({ error: 'Missing sender id' });
    const { data, error } = await supabase
      .from('send_allowed_senders')
      .update({ status: 'approved' })
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .maybeSingle<DBSendAllowedSender>();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Sender not found' });
    return res.status(200).json({ sender: data });
  }

  if (req.method === 'DELETE') {
    const id = String(req.body?.id ?? req.query['id'] ?? '');
    if (!id) return res.status(400).json({ error: 'Missing sender id' });
    const { error } = await supabase
      .from('send_allowed_senders')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
