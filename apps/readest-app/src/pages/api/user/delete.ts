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

    const supabaseAdmin = createSupabaseAdminClient();
    const { error } = await supabaseAdmin.auth.admin.deleteUser(user.id);
    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Reading-statistics archive objects in R2 do not cascade with the auth
    // user (Postgres rows do). The identity goes first: deleting objects before
    // a failed deleteUser would leave an active account with its history gone.
    // After the identity is gone, the user id is queued in stat_archive_orphans
    // (swept by the compaction job until the prefix lists empty, which also
    // catches an object a concurrent compaction run wrote after this sweep) and
    // the prefix is deleted right away, best-effort.
    const bucket = getStatsArchiveEnv().STATS_ARCHIVE_R2;
    if (bucket) {
      const { error: queueErr } = await supabaseAdmin
        .from('stat_archive_orphans')
        .upsert({ user_id: user.id }, { onConflict: 'user_id' });
      if (queueErr) {
        console.error(
          'user delete: could not queue stats archive cleanup',
          user.id,
          queueErr.message,
        );
      }
      await deleteUserSegments(bucket, user.id).catch((e) =>
        console.error('user delete: stats archive cleanup failed (queued for sweep)', user.id, e),
      );
    }

    res.status(200).json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Something went wrong' });
  }
}
