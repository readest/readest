import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase, createSupabaseClient } from '@/utils/supabase';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Client } from '@/utils/s3';

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
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  await runMiddleware(req, res, corsAllMethods);

  try {
    const { user, token } = await getUserAndToken(req.headers['authorization']);
    if (!user || !token) {
      return res.status(403).json({ error: 'Not authenticated' });
    }

    const { fileKey } = req.query;

    if (!fileKey || typeof fileKey !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid fileKey' });
    }

    // Verify the file belongs to the user
    const supabase = createSupabaseClient(token);
    const { data: fileRecord, error: fileError } = await supabase
      .from('files')
      .select('user_id')
      .eq('user_id', user.id)
      .eq('file_key', fileKey) // index idx_files_file_key_deleted_at on public.files
      .is('deleted_at', null)
      .limit(1)
      .single();

    if (fileError || !fileRecord) {
      return res.status(404).json({ error: 'File not found' });
    }

    if (fileRecord.user_id !== user.id) {
      return res.status(403).json({ error: 'Unauthorized access to the file' });
    }

    const getCommand = new GetObjectCommand({
      Bucket: process.env['R2_BUCKET_NAME'] || '',
      Key: fileKey,
    });

    try {
      const downloadUrl = await getSignedUrl(s3Client, getCommand, {
        expiresIn: 1800,
      });

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
