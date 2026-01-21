import type { NextApiRequest, NextApiResponse } from 'next';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import {
  getStoragePlanData,
  validateUserAndToken,
  STORAGE_QUOTA_GRACE_BYTES,
} from '@/utils/access';
import { getDownloadSignedUrl, getUploadSignedUrl } from '@/utils/object';
import { READEST_PUBLIC_STORAGE_BASE_URL } from '@/services/constants';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await runMiddleware(req, res, corsAllMethods);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user, token } = await validateUserAndToken(req.headers['authorization']);
  if (!user || !token) {
    return res.status(403).json({ error: 'Not authenticated' });
  }

  const { fileName, fileSize, bookHash, temp = false } = req.body;
  if (temp) {
    try {
      const datetime = new Date();
      const timeStr = datetime.toISOString().replace(/[-:]/g, '').replace('T', '').slice(0, 10);
      const userStr = user.id.slice(0, 8);
      const fileKey = `temp/img/${timeStr}/${userStr}/${fileName}`;
      const bucketName = process.env['TEMP_STORAGE_PUBLIC_BUCKET_NAME'] || '';
      const uploadUrl = await getUploadSignedUrl(fileKey, fileSize, 1800, bucketName);
      const downloadUrl = await getDownloadSignedUrl(fileKey, 3 * 86400, bucketName);
      const pathname = new URL(downloadUrl).pathname;
      const publicBaseUrl = READEST_PUBLIC_STORAGE_BASE_URL;
      const publicDownloadUrl = `${publicBaseUrl}${pathname.replace(`/${bucketName}`, '')}`;
      return res.status(200).json({
        uploadUrl,
        downloadUrl: publicDownloadUrl,
      });
    } catch (error) {
      console.error('Error creating presigned post for temp file:', error);
      return res.status(500).json({ error: 'Could not create presigned post' });
    }
  }

  try {
    if (!fileName || !fileSize) {
      return res.status(400).json({ error: 'Missing file info' });
    }

    const { usage, quota } = getStoragePlanData(token);
    if (usage + fileSize > quota + STORAGE_QUOTA_GRACE_BYTES) {
      return res.status(403).json({ error: 'Insufficient storage quota', usage });
    }

    const fileKey = `${user.id}/${fileName}`;
    const supabase = createSupabaseAdminClient();
    const { data: existingRecord, error: fetchError } = await supabase
      .from('files')
      .select('*')
      .eq('user_id', user.id)
      .eq('file_key', fileKey)
      .limit(1)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      return res.status(500).json({ error: fetchError.message });
    }
    let objSize = fileSize;
    if (existingRecord) {
      objSize = existingRecord.file_size;
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from('files')
        .insert([
          {
            user_id: user.id,
            book_hash: bookHash,
            file_key: fileKey,
            file_size: fileSize,
          },
        ])
        .select()
        .single();
      console.log('Inserted record:', inserted);
      if (insertError) return res.status(500).json({ error: insertError.message });
    }

    try {
      const uploadUrl = await getUploadSignedUrl(fileKey, objSize, 1800);

      res.status(200).json({
        uploadUrl,
        fileKey,
        usage: usage + fileSize,
        quota,
      });
    } catch (error) {
      console.error('Error creating presigned post:', error);
      res.status(500).json({ error: 'Could not create presigned post' });
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Something went wrong' });
  }
}
