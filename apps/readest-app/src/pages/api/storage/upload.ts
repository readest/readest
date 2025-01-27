import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase, createSupabaseClient } from '@/utils/supabase';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getPlanData } from '@/utils/access';
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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  await runMiddleware(req, res, corsAllMethods);

  try {
    const { user, token } = await getUserAndToken(req.headers['authorization']);
    if (!user || !token) {
      return res.status(403).json({ error: 'Not authenticated' });
    }

    const { fileName, fileSize, bookHash } = req.body;
    if (!fileName || !fileSize) {
      return res.status(400).json({ error: 'Missing file info' });
    }

    const { usage, quota } = getPlanData(token);
    if (usage + fileSize > quota) {
      return res.status(403).json({ error: 'Insufficient storage quota', usage });
    }

    const objectKey = `${user.id}/${fileName}`;
    const signableHeaders = new Set<string>();
    signableHeaders.add('content-length');
    const putCommand = new PutObjectCommand({
      Bucket: process.env['R2_BUCKET_NAME'] || '',
      Key: objectKey,
      ContentLength: fileSize,
    });

    const supabase = createSupabaseClient(token);
    const { data: inserted, error: insertError } = await supabase
      .from('files')
      .insert([
        {
          user_id: user.id,
          book_hash: bookHash,
          file_key: objectKey,
          file_size: fileSize,
        },
      ])
      .select()
      .single();
    console.log('Inserted record:', inserted);
    if (insertError) return res.status(500).json({ error: insertError.message });

    try {
      const uploadUrl = await getSignedUrl(s3Client, putCommand, {
        expiresIn: 1800,
        signableHeaders,
      });

      res.status(200).json({
        uploadUrl,
        fileKey: objectKey,
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
