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

    const apiUrl = process.env['NEXT_PUBLIC_BIBLO_API_URL'] || 'http://localhost:3001/api/v0';

    try {
      const response = await fetch(
        `${apiUrl}/storage/delete?fileKey=${encodeURIComponent(fileKey)}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: req.headers.authorization || `Bearer ${token}`,
          },
        },
      );

      if (!response.ok) {
        const errData = await response.json();
        return res
          .status(response.status)
          .json({ error: errData.error || 'Failed to delete metadata' });
      }

      // Now delete S3/R2 object
      await deleteObject(fileKey);

      // Soft delete in Supabase
      try {
        const supabase = createSupabaseAdminClient();
        const { error: supabaseError } = await supabase
          .from('files')
          .update({ deleted_at: new Date().toISOString() })
          .eq('user_id', user.id)
          .eq('file_key', fileKey);

        if (supabaseError) {
          console.error('Error soft-deleting file metadata in Supabase:', supabaseError);
        }
      } catch (subError) {
        console.error('Exception soft-deleting file metadata in Supabase:', subError);
      }

      res.status(200).json({ message: 'File deleted successfully' });
    } catch (error: any) {
      console.error('Error deleting file metadata or object:', error);
      res.status(500).json({ error: 'Could not delete file from storage backend' });
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Something went wrong' });
  }
}
