import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase, createSupabaseClient } from '@/utils/supabase';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { getStoragePlanData } from '@/utils/access';
import { getUploadSignedUrl } from '@/utils/object';

const getUserAndToken = async (authHeader: string | undefined) => {
  if (!authHeader) return {};

  const token = authHeader.replace('Bearer ', '');
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) return {};
  return { user, token };
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await runMiddleware(req, res, corsAllMethods);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { user, token } = await getUserAndToken(req.headers['authorization']);
    if (!user || !token) {
      return res.status(403).json({ error: 'Not authenticated' });
    }

    const { fileName, fileSize, bookHash } = req.body;
    if (!fileName || !fileSize) {
      return res.status(400).json({ error: 'Missing file info' });
    }

    const { usage, quota } = getStoragePlanData(token);
    if (usage + fileSize > quota) {
      return res.status(403).json({ error: 'Insufficient storage quota', usage });
    }

    const fileKey = `${user.id}/${fileName}`;
    const supabase = createSupabaseClient(token);
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
      const uploadUrl = await getUploadSignedUrl(
        fileKey,
        objSize,
        1800,
      );

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
