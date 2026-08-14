import type { NextApiRequest, NextApiResponse } from 'next';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { validateUserAndToken } from '@/utils/access';
import { deleteObject } from '@/utils/object';

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

    const { fileKey } = req.query;

    if (!fileKey || typeof fileKey !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid fileKey' });
    }

    try {
      // 1. Delete object from R2/S3
      await deleteObject(fileKey);

      // 2. Soft delete in Supabase
      const supabase = createSupabaseAdminClient();
      const { error: supabaseError } = await supabase
        .from('files')
        .update({ deleted_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('file_key', fileKey);

      if (supabaseError) {
        console.error('Error soft-deleting file metadata in Supabase:', supabaseError);
        return res.status(500).json({ error: supabaseError.message });
      }

      res.status(200).json({ message: 'File deleted successfully' });
    } catch (error: any) {
      console.error('Error deleting file metadata or object:', error);
      res.status(500).json({ error: 'Could not delete file' });
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Something went wrong' });
  }
}
