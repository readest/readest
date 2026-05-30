import type { NextApiRequest, NextApiResponse } from 'next';
import { createSupabaseClient } from '@/utils/supabase';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { validateUserAndToken } from '@/utils/access';

/**
 * Drainer state transitions for a claimed inbox item — `renew` the lease,
 * `complete`, or `fail`. Wraps the renew/complete/fail RPCs so the drainer
 * routes through the API rather than calling Supabase directly. The RPCs
 * self-scope to `auth.uid()`, so a user-scoped Supabase client is used.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await runMiddleware(req, res, corsAllMethods);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user, token } = await validateUserAndToken(req.headers['authorization']);
  if (!user || !token) {
    return res.status(403).json({ error: 'Not authenticated' });
  }

  const id = String(req.query['id'] ?? '');
  const action = String(req.body?.action ?? '');
  const device = String(req.body?.device ?? '').slice(0, 100);
  if (!id || !device) {
    return res.status(400).json({ error: 'Missing item id or device' });
  }

  const supabase = createSupabaseClient(token);
  let result;
  if (action === 'renew') {
    result = await supabase.rpc('renew_inbox_claim', { p_id: id, p_device: device });
  } else if (action === 'complete') {
    result = await supabase.rpc('complete_inbox_item', { p_id: id, p_device: device });
  } else if (action === 'fail') {
    const error = String(req.body?.error ?? '').slice(0, 500);
    result = await supabase.rpc('fail_inbox_item', { p_id: id, p_device: device, p_error: error });
  } else {
    return res.status(400).json({ error: 'Unknown action' });
  }

  if (result.error) {
    return res.status(500).json({ error: result.error.message });
  }
  return res.status(200).json({ ok: Boolean(result.data) });
}
