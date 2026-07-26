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

// A listing request costs about a second almost regardless of how many rows it
// returns, so a client walking the whole account (the calibre plugin) pays per
// page. 1000 turns ~16 requests into 2. The in-app Storage Manager asks for 20
// and is unaffected.
export const MAX_PAGE_SIZE = 1000;

// Supabase renders `.in()` into the request's query string, so a whole page of
// hashes at MAX_PAGE_SIZE would be tens of kilobytes of URL. Send the group
// expansion in batches instead.
export const IN_CHUNK_SIZE = 100;

export const resolvePageSize = (raw: string | undefined) =>
  Math.max(1, Math.min(parseInt(raw as string) || 50, MAX_PAGE_SIZE));

export const chunkIds = <T>(ids: T[], size = IN_CHUNK_SIZE): T[][] => {
  const batches: T[][] = [];
  for (let index = 0; index < ids.length; index += size) {
    batches.push(ids.slice(index, index + size));
  }
  return batches;
};

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
    const pageSize = resolvePageSize(reqQuery.pageSize);
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
      const absorb = async (column: 'book_hash' | 'replica_id', ids: string[]) => {
        const results = await Promise.all(
          chunkIds(ids).map((batch) => baseQuery().in(column, batch)),
        );
        results.forEach(({ data, error }) => {
          if (!error && data) data.forEach((f) => fileMap.set(f.file_key, f));
        });
      };
      if (bookHashes.length > 0) await absorb('book_hash', bookHashes);
      if (replicaIds.length > 0) await absorb('replica_id', replicaIds);
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
