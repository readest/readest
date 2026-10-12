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

    const supabase = createSupabaseAdminClient();
    const { data: fileRecord, error: fileError } = await supabase
      .from('files')
      .select('user_id, id')
      .eq('user_id', user.id)
      .eq('file_key', fileKey)
      .limit(1)
      .single();

    if (fileError || !fileRecord) {
      return res.status(404).json({ error: 'File not found' });
    }

    if (fileRecord.user_id !== user.id) {
      return res.status(403).json({ error: 'Unauthorized access to the file' });
    }

    try {
      // Delete the object FIRST and confirm it succeeded. supabase/R2 fetch
      // returns a Response whose `.ok` must be checked: dropping the `files`
      // row after a failed R2 delete orphans the object in the bucket with no
      // index pointing at it. (`.ok === undefined` on the S3 path is tolerated
      // so non-R2 deployments keep working.)
      const r2Res = (await deleteObject(fileKey)) as { ok?: boolean; status?: number } | undefined;
      if (r2Res && r2Res.ok === false) {
        console.error('Error deleting file from storage: status', r2Res.status, fileKey);
        return res.status(502).json({ error: 'Could not delete file from storage' });
      }
      const { error: deleteError } = await supabase.from('files').delete().eq('id', fileRecord.id);

      if (deleteError) {
        console.error('Error updating file record:', deleteError);
        return res.status(500).json({ error: 'Could not update file record' });
      }

      res.status(200).json({ message: 'File deleted successfully' });
    } catch (error) {
      console.error('Error deleting file from S3:', error);
      res.status(500).json({ error: 'Could not delete file from storage' });
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Something went wrong' });
  }
}
