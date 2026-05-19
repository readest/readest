import type { NextApiRequest, NextApiResponse } from 'next';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { validateUserAndToken } from '@/utils/access';
import {
  generateSendAddress,
  buildSendAddress,
  sanitizeSlug,
  isReservedSlug,
} from '@/services/send/sendAddress';
import { SEND_EMAIL_DOMAIN } from '@/services/constants';
import type { DBSendAddress } from '@/types/sendRecords';

const MAX_COLLISION_RETRIES = 5;

/** Build the full inbound email address from a stored local part. */
const fullAddress = (localPart: string) => `${localPart}@${SEND_EMAIL_DOMAIN}`;

/**
 * GET  — return the caller's inbound address, lazily creating one on first call.
 * POST — rotate the address (issue a fresh random local part).
 *
 * The address is the local part only in the DB; the `@send.readest.com` host
 * is appended here so the domain can change without a migration.
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
      .from('send_addresses')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle<DBSendAddress>();
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    if (data) {
      return res.status(200).json({ address: fullAddress(data.address), enabled: data.enabled });
    }
    // Lazily create on first access.
    const created = await insertWithRetry(supabase, user.id, user.email ?? user.id);
    if (!created) {
      return res.status(500).json({ error: 'Could not allocate an address' });
    }
    return res.status(200).json({ address: fullAddress(created), enabled: true });
  }

  if (req.method === 'POST') {
    // Optional custom slug; the token suffix is always regenerated. Without a
    // slug this is a plain rotation with an identity-derived slug.
    let customSlug: string | undefined;
    if (req.body?.slug !== undefined) {
      customSlug = sanitizeSlug(String(req.body.slug));
      if (!customSlug) {
        return res.status(400).json({ error: 'Name must contain letters or digits' });
      }
      if (isReservedSlug(customSlug)) {
        return res.status(400).json({ error: 'That name is reserved' });
      }
    }
    // Rotation: overwrite with a fresh local part. PK is user_id, so upsert.
    for (let attempt = 0; attempt < MAX_COLLISION_RETRIES; attempt++) {
      const localPart = customSlug
        ? buildSendAddress(customSlug)
        : generateSendAddress(user.email ?? user.id);
      const { error } = await supabase.from('send_addresses').upsert(
        {
          user_id: user.id,
          address: localPart,
          enabled: true,
          rotated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );
      if (!error) {
        return res.status(200).json({ address: fullAddress(localPart), enabled: true });
      }
      // 23505 = unique_violation on the address column; retry with a new token.
      if (error.code !== '23505') {
        return res.status(500).json({ error: error.message });
      }
    }
    return res.status(500).json({ error: 'Could not allocate an address' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

async function insertWithRetry(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
  identity: string,
): Promise<string | null> {
  for (let attempt = 0; attempt < MAX_COLLISION_RETRIES; attempt++) {
    const localPart = generateSendAddress(identity);
    const { error } = await supabase
      .from('send_addresses')
      .insert({ user_id: userId, address: localPart, enabled: true });
    if (!error) return localPart;
    // Another request created the row first — read it back.
    if (error.code === '23505') {
      const { data } = await supabase
        .from('send_addresses')
        .select('address')
        .eq('user_id', userId)
        .maybeSingle<Pick<DBSendAddress, 'address'>>();
      if (data) return data.address;
    }
  }
  return null;
}
