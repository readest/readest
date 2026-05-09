import type { NextApiRequest, NextApiResponse } from 'next';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { validateUserAndToken } from '@/utils/access';

interface FileRecord {
  file_key: string;
  file_size: number;
  book_hash: string | null;
  replica_kind: string | null;
  replica_id: string | null;
  created_at: string;
  updated_at: string | null;
}

interface ListFilesResponse {
  files: FileRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
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

    const reqQuery = req.query as {
      page?: string;
      pageSize?: string;
      sortBy?: string;
      sortOrder?: string;
      bookHash?: string;
      search?: string;
    };
    const page = parseInt(reqQuery.page as string) || 1;
    const pageSize = Math.min(parseInt(reqQuery.pageSize as string) || 50, 100);
    const sortBy = (reqQuery.sortBy as string) || 'created_at';
    const sortOrder = (reqQuery.sortOrder as string) === 'asc' ? 'asc' : 'desc';
    const bookHash = reqQuery.bookHash as string | undefined;
    const search = reqQuery.search as string | undefined;

    const supabase = createSupabaseAdminClient();

    let query = supabase
      .from('files')
      .select('file_key, file_size, book_hash, replica_kind, replica_id, created_at, updated_at', {
        count: 'exact',
      })
      .eq('user_id', user.id)
      .is('deleted_at', null);

    if (bookHash) {
      query = query.eq('book_hash', bookHash);
    }

    if (search) {
      query = query.ilike('file_key', `%${search}%`);
    }

    const validSortColumns = ['created_at', 'updated_at', 'file_size', 'file_key'];
    const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'created_at';
    query = query.order(sortColumn, { ascending: sortOrder === 'asc' });

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    query = query.range(from, to);

    const { data: files, error: filesError, count } = await query;

    if (filesError) {
      console.error('Error querying files:', filesError);
      return res.status(500).json({ error: 'Failed to retrieve files' });
    }

    const total = count || 0;
    const totalPages = Math.ceil(total / pageSize);

    // Pull every file that shares a group with the paginated results so
    // groups (book or replica) appear complete in the UI — covers, mdds,
    // etc. that wouldn't match a search filter still ride along.
    // IMPORTANT: We don't apply the search filter here.
    const bookHashes = Array.from(
      new Set((files || []).map((f) => f.book_hash).filter((hash): hash is string => !!hash)),
    );
    const replicaIds = Array.from(
      new Set((files || []).map((f) => f.replica_id).filter((id): id is string => !!id)),
    );
    let allRelatedFiles = files || [];
    if (bookHashes.length > 0 || replicaIds.length > 0) {
      const baseQuery = () =>
        supabase
          .from('files')
          .select(
            'file_key, file_size, book_hash, replica_kind, replica_id, created_at, updated_at',
          )
          .eq('user_id', user.id)
          .is('deleted_at', null);

      const fileMap = new Map(allRelatedFiles.map((f) => [f.file_key, f]));
      if (bookHashes.length > 0) {
        const { data, error } = await baseQuery().in('book_hash', bookHashes);
        if (!error && data) data.forEach((f) => fileMap.set(f.file_key, f));
      }
      if (replicaIds.length > 0) {
        const { data, error } = await baseQuery().in('replica_id', replicaIds);
        if (!error && data) data.forEach((f) => fileMap.set(f.file_key, f));
      }
      allRelatedFiles = Array.from(fileMap.values());
    }

    const response: ListFilesResponse = {
      files: allRelatedFiles,
      total,
      page,
      pageSize,
      totalPages,
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Something went wrong' });
  }
}
