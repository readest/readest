import type { NextApiRequest, NextApiResponse } from 'next';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { validateUserAndToken } from '@/utils/access';
import { deleteObject } from '@/utils/object';
import { parseBookFileKey } from '@/utils/bookFileKey';

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
    let { data: fileRecord } = await supabase
      .from('files')
      .select('user_id, id, file_key')
      .eq('user_id', user.id)
      .eq('file_key', fileKey)
      .limit(1)
      .single();

    // Same fallback as the download API: a book file uploaded under another
    // name (the calibre plugin and koplugin use `{hash}.{ext}`) is found by its
    // book hash and extension.
    const bookFile = !fileRecord && parseBookFileKey(fileKey);
    if (bookFile) {
      const { data: candidates } = await supabase
        .from('files')
        .select('user_id, id, file_key')
        .eq('user_id', user.id)
        .eq('book_hash', bookFile.bookHash)
        .is('deleted_at', null);
      fileRecord =
        candidates?.find((f) => f.file_key.endsWith(`.${bookFile.fileExtension}`)) ?? null;
    }

    if (!fileRecord) {
      return res.status(404).json({ error: 'File not found' });
    }

    if (fileRecord.user_id !== user.id) {
      return res.status(403).json({ error: 'Unauthorized access to the file' });
    }

    try {
      await deleteObject(fileRecord.file_key);
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
