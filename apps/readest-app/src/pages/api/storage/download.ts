import type { NextApiRequest, NextApiResponse } from 'next';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { getDownloadSignedUrl } from '@/utils/object';
import { validateUserAndToken } from '@/utils/access';

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

    const { fileKey } = req.query;

    if (!fileKey || typeof fileKey !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid fileKey' });
    }

    // Verify the file belongs to the user
    const supabase = createSupabaseAdminClient();
    const result = await supabase
      .from('files')
      .select('user_id, file_key')
      .eq('user_id', user.id)
      .eq('file_key', fileKey) // index idx_files_file_key_deleted_at on public.files
      .is('deleted_at', null)
      .limit(1)
      .single();

    const { error: fileError } = result;
    let { data: fileRecord } = result;

    if (fileError || !fileRecord) {
      // Fallback for corrupted file names, using book hash and file extension to match fileKey
      if (fileKey.includes('Readest/Book')) {
        const parts = fileKey.split('/');
        if (parts.length === 5) {
          const bookHash = parts[3]!;
          const filename = parts[4]!;
          const fileExtension = filename.split('.').pop() || '';

          const { data: fileRecords, error: fileError } = await supabase
            .from('files')
            .select('user_id, file_key')
            .eq('user_id', user.id)
            .eq('book_hash', bookHash)
            .is('deleted_at', null);

          if (!fileError && fileRecords && fileRecords.length > 0) {
            const matchedFile = fileRecords.find((f) => f.file_key.endsWith(`.${fileExtension}`));
            if (matchedFile) {
              fileRecord = matchedFile;
            }
          } else {
            return res.status(404).json({ error: 'File not found' });
          }
        }
      }
    }

    if (fileRecord?.user_id !== user.id) {
      return res.status(403).json({ error: 'Unauthorized access to the file' });
    }

    try {
      const downloadUrl = await getDownloadSignedUrl(fileRecord.file_key, 1800);

      res.status(200).json({
        downloadUrl,
      });
    } catch (error) {
      console.error('Error creating signed URL for download:', error);
      res.status(500).json({ error: 'Could not create signed URL for download' });
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Something went wrong' });
  }
}
