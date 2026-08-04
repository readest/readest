import type { NextApiRequest, NextApiResponse } from 'next';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import {
  getStoragePlanData,
  validateUserAndToken,
  STORAGE_QUOTA_GRACE_BYTES,
} from '@/utils/access';
import { getDownloadSignedUrl, getUploadSignedUrl, isSafeObjectKeyName } from '@/utils/object';
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

  const { fileName, fileSize, bookHash, replicaKind, replicaId, temp = false } = req.body;

  // Reject object-key path traversal before building any key. `fileName` is
  // fully client-controlled and is interpolated into `${user.id}/${fileName}`;
  // without this an attacker escapes their own prefix into another user's
  // namespace (GHSA-mfmj-2frf-vhgw).
  if (!isSafeObjectKeyName(fileName)) {
    return res.status(400).json({ error: 'Invalid fileName' });
  }

  if (temp) {
    try {
      // The key carries no timestamp: `fileName` is content-addressed by the
      // caller, so the same image always resolves to the same public URL. It
      // used to embed the wall-clock hour, which handed Discord Rich Presence
      // a brand-new external asset to fetch every hour — and every failed
      // fetch dropped the cover back to the app icon (issue #5352). A stable
      // URL lets Discord's media proxy reuse what it already resolved.
      // Re-uploads overwrite in place, so bucket retention still applies.
      const userStr = user.id.slice(0, 8);
      const fileKey = `temp/img/${userStr}/${fileName}`;
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
    const apiUrl = process.env.NEXT_PUBLIC_BIBLO_API_URL || 'http://localhost:3001/api/v0';

    let objSize = fileSize;
    try {
      const response = await fetch(`${apiUrl}/storage/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: req.headers.authorization || `Bearer ${token}`,
        },
        body: JSON.stringify({
          fileName,
          fileSize,
          bookHash,
          replicaKind,
          replicaId,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        return res
          .status(response.status)
          .json({ error: errData.error || 'Failed to save metadata' });
      }

      const fileMetadata = await response.json();
      if (fileMetadata && fileMetadata.size) {
        objSize = fileMetadata.size;
      }
    } catch (error: any) {
      console.error('Error saving file metadata to backend:', error);
      return res.status(500).json({ error: 'Could not connect to storage metadata server' });
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
