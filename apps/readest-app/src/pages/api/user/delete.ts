import type { NextApiRequest, NextApiResponse } from 'next';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { validateUserAndToken } from '@/utils/access';
import { deleteObject } from '@/utils/object';
import { deleteUserSegments, getStatsArchiveEnv } from '@/libs/statsArchive';

// How many `files` rows to read per page, and how many R2 deletes to run at
// once, when cleaning up a deleted account's objects.
const FILES_PAGE_SIZE = 1000;
const DELETE_CONCURRENCY = 50;

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

    // Collect the user's object keys BEFORE touching the identity. Deleting the
    // auth user cascades the `files` rows (FK ON DELETE CASCADE), and those rows
    // are the only index of the `${user.id}/…` objects in R2 — so once the user
    // is gone there is nothing left to enumerate and the books/covers/replicas
    // orphan in the bucket forever. This read is side-effect-free, so a failure
    // here stops before any state changes.
    const fileKeys: string[] = [];
    for (let from = 0; ; from += FILES_PAGE_SIZE) {
      const { data, error: listErr } = await supabaseAdmin
        .from('files')
        .select('file_key')
        .eq('user_id', user.id)
        .range(from, from + FILES_PAGE_SIZE - 1);
      if (listErr) {
        console.error('user delete: could not list storage objects', user.id, listErr.message);
        return res.status(500).json({ error: 'storage cleanup could not be prepared' });
      }
      if (!data || data.length === 0) break;
      for (const row of data as { file_key: string | null }[]) {
        if (row.file_key) fileKeys.push(row.file_key);
      }
      if (data.length < FILES_PAGE_SIZE) break;
    }

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

    // Best-effort delete of the user's storage objects now that the identity is
    // gone. Batched to bound concurrency inside the Worker; a failed delete only
    // leaves that single object behind (logged) rather than aborting the rest.
    for (let i = 0; i < fileKeys.length; i += DELETE_CONCURRENCY) {
      const batch = fileKeys.slice(i, i + DELETE_CONCURRENCY);
      const results = await Promise.allSettled(batch.map((key) => deleteObject(key)));
      results.forEach((r, j) => {
        if (r.status === 'rejected') {
          console.error(
            'user delete: failed to delete storage object (orphaned)',
            batch[j],
            r.reason,
          );
        }
      });
    }

    res.status(200).json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Something went wrong' });
  }
}
