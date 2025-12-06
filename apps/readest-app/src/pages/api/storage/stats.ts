import type { NextApiRequest, NextApiResponse } from 'next';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { validateUserAndToken, getStoragePlanData } from '@/utils/access';

interface StorageStats {
  totalFiles: number;
  totalSize: number;
  usage: number;
  quota: number;
  usagePercentage: number;
  byBookHash: Array<{
    bookHash: string | null;
    fileCount: number;
    totalSize: number;
  }>;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await runMiddleware(req, res, corsAllMethods);

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { user, token } = await validateUserAndToken(req.headers['authorization']);
    if (!user || !token) {
      return res.status(403).json({ error: 'Not authenticated' });
    }

    const supabase = createSupabaseAdminClient();

    // Get total file count and size
    const { data: totalStats, error: totalError } = await supabase
      .from('files')
      .select('file_size')
      .eq('user_id', user.id)
      .is('deleted_at', null);

    if (totalError) {
      console.error('Error querying total stats:', totalError);
      return res.status(500).json({ error: 'Failed to retrieve storage statistics' });
    }

    const totalFiles = totalStats?.length || 0;
    const totalSize = totalStats?.reduce((sum, file) => sum + (file.file_size || 0), 0) || 0;

    // Get storage plan data
    const { usage, quota } = getStoragePlanData(token);
    const usagePercentage = quota > 0 ? Math.round((usage / quota) * 100) : 0;

    // Get stats grouped by book_hash
    const { data: bookHashStats, error: bookHashError } = await supabase.rpc(
      'get_storage_by_book_hash',
      { p_user_id: user.id },
    );

    // Fallback if RPC function doesn't exist - manual aggregation
    let byBookHash: Array<{ bookHash: string | null; fileCount: number; totalSize: number }> = [];

    if (bookHashError) {
      console.warn('RPC function not available, using fallback aggregation:', bookHashError);

      const { data: allFiles, error: filesError } = await supabase
        .from('files')
        .select('book_hash, file_size')
        .eq('user_id', user.id)
        .is('deleted_at', null);

      if (!filesError && allFiles) {
        const grouped = new Map<string | null, { count: number; size: number }>();

        allFiles.forEach((file) => {
          const key = file.book_hash;
          const current = grouped.get(key) || { count: 0, size: 0 };
          grouped.set(key, {
            count: current.count + 1,
            size: current.size + file.file_size,
          });
        });

        byBookHash = Array.from(grouped.entries())
          .map(([bookHash, stats]) => ({
            bookHash,
            fileCount: stats.count,
            totalSize: stats.size,
          }))
          .sort((a, b) => b.totalSize - a.totalSize);
      }
    } else if (bookHashStats) {
      byBookHash = bookHashStats;
    }

    const response: StorageStats = {
      totalFiles,
      totalSize,
      usage,
      quota,
      usagePercentage,
      byBookHash,
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Something went wrong' });
  }
}
