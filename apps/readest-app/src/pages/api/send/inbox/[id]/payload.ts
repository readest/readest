import type { NextApiRequest, NextApiResponse } from 'next';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { validateUserAndToken } from '@/utils/access';
import { getDownloadSignedUrl } from '@/utils/object';
import { SEND_INBOX_BUCKET } from '@/services/constants';
import type { DBSendInboxItem } from '@/types/sendRecords';

const DOWNLOAD_TTL_SECONDS = 600;

/**
 * Signed-download URL for an inbox payload. Authorizes against `send_inbox`
 * ownership — a separate path from `storage/download`, which checks the
 * `files` table (inbox payloads are not `files` rows).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await runMiddleware(req, res, corsAllMethods);

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user } = await validateUserAndToken(req.headers['authorization']);
  if (!user) {
    return res.status(403).json({ error: 'Not authenticated' });
  }

  const id = String(req.query['id'] ?? '');
  if (!id) {
    return res.status(400).json({ error: 'Missing inbox item id' });
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('send_inbox')
    .select('user_id, payload_key')
    .eq('id', id)
    .maybeSingle<Pick<DBSendInboxItem, 'user_id' | 'payload_key'>>();
  if (error) {
    return res.status(500).json({ error: error.message });
  }
  if (!data || data.user_id !== user.id) {
    return res.status(404).json({ error: 'Inbox item not found' });
  }
  if (!data.payload_key) {
    return res.status(409).json({ error: 'Inbox item has no file payload' });
  }

  try {
    // Inbox payloads live in their own bucket, separate from the books bucket
    // that getDownloadSignedUrl defaults to.
    const downloadUrl = await getDownloadSignedUrl(
      data.payload_key,
      DOWNLOAD_TTL_SECONDS,
      SEND_INBOX_BUCKET,
    );
    return res.status(200).json({ downloadUrl });
  } catch (err) {
    console.error('Inbox payload sign failed:', err);
    return res.status(500).json({ error: 'Could not sign payload URL' });
  }
}
