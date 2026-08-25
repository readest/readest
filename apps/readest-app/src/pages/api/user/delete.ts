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
    // user (Postgres rows do), and the immediate prefix delete below is
    // best-effort. The durable tombstone is a stat_archive_orphans row written
    // BEFORE the identity is touched: if even that fails, stop with 500 while a
    // retry is still possible. A stale row for a user whose deleteUser then
    // fails is harmless: the compaction sweep skips users that still exist, and
    // the failure path removes the row again, best-effort.
    const supabaseAdmin = createSupabaseAdminClient();
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
        return res.status(500).json({ error: 'stats archive cleanup could not be prepared' });
      }
    }

    // The identity goes second: deleting objects before a failed deleteUser
    // would leave an active account with its history gone.
    const { error } = await supabaseAdmin.auth.admin.deleteUser(user.id);
    if (error) {
      if (bucket) {
        await supabaseAdmin
          .from('stat_archive_orphans')
          .delete()
          .eq('user_id', user.id)
          .then(({ error: e }) => {
            if (e) console.warn('user delete: could not unqueue after failure', user.id, e.message);
          });
      }
      return res.status(500).json({ error: error.message });
    }

    // Immediate cleanup, best-effort: the queued row keeps it reliable (the
    // compaction sweep deletes the prefix until it lists empty, which also
    // catches an object a concurrent compaction run wrote after this sweep).
    if (bucket) {
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
