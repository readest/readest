import type { NextApiRequest, NextApiResponse } from 'next';
import { createSupabaseClient } from '@/utils/supabase';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { validateUserAndToken } from '@/utils/access';
import type { DBSendInboxItem } from '@/types/sendRecords';

/**
 * Claim the oldest drainable inbox item for the caller, via the
 * `claim_inbox_item` RPC. Clients route through here instead of calling
 * Supabase directly. The RPC self-scopes to `auth.uid()`, so a user-scoped
 * Supabase client (carrying the caller's JWT) is used.
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

  const device = String(req.body?.device ?? '').slice(0, 100);
  if (!device) {
    return res.status(400).json({ error: 'Missing device id' });
  }

  const supabase = createSupabaseClient(token);
  const { data, error } = await supabase.rpc('claim_inbox_item', { p_device: device });
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  // The RPC yields null (or a NULL-filled row) when nothing was claimable.
  const item = data && data.id ? (data as DBSendInboxItem) : null;
  return res.status(200).json({ item });
}
