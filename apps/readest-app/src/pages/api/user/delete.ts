import type { NextApiRequest, NextApiResponse } from 'next';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { validateUserAndToken } from '@/utils/access';
import { deleteUserSegments, getStatsArchiveEnv } from '@/libs/statsArchive';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await runMiddleware(req, res, corsAllMethods);

  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { user, token } = await validateUserAndToken(req.headers['authorization']);
    if (!user || !token) {
      return res.status(403).json({ error: 'Not authenticated' });
    }

    // Reading-statistics archive objects in R2 do not cascade with the auth
    // user (Postgres rows do). Delete them first and refuse to delete the user
    // when that fails, so an account never disappears while its history stays.
    const bucket = getStatsArchiveEnv().STATS_ARCHIVE_R2;
    if (bucket) {
      try {
        await deleteUserSegments(bucket, user.id);
      } catch (e) {
        console.error('user delete: stats archive cleanup failed', user.id, e);
        return res.status(500).json({ error: 'stats archive cleanup failed' });
      }
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const { error } = await supabaseAdmin.auth.admin.deleteUser(user.id);
    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Best-effort second sweep: a compaction run that was between its object
    // put and its (now failing) commit during the first sweep may have left
    // one more object behind.
    if (bucket) {
      await deleteUserSegments(bucket, user.id).catch((e) =>
        console.warn('user delete: post-delete stats archive sweep failed', user.id, e),
      );
    }

    res.status(200).json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Something went wrong' });
  }
}
