import type { NextApiRequest, NextApiResponse } from 'next';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import {
  getStoragePlanData,
  validateUserAndToken,
  STORAGE_QUOTA_GRACE_BYTES,
} from '@/utils/access';
import { getDownloadSignedUrl, getUploadSignedUrl, isSafeObjectKeyName } from '@/utils/object';
import {
  READEST_PUBLIC_ASSETS_BASE_URL,
  READEST_PUBLIC_STORAGE_BASE_URL,
} from '@/services/constants';

// Public media prefixes that may be uploaded into the public bucket. Keys are
// content-addressed by the caller (media/<kind>/<user-seg>/<hash>.<ext>), so
// unlike `temp/` objects they are durable and their URLs never rotate.
const PUBLIC_MEDIA_KINDS = ['book_covers'];

// Media and temp uploads are book cover images in the public bucket; they are
// not metered, so cap them well above any real cover instead.
const MAX_PUBLIC_IMAGE_BYTES = 20 * 1024 * 1024;

const isValidFileSize = (size: unknown): size is number =>
  Number.isSafeInteger(size) && (size as number) > 0;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await runMiddleware(req, res, corsAllMethods);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user, token } = await validateUserAndToken(req.headers['authorization']);
  if (!user || !token) {
    return res.status(403).json({ error: 'Not authenticated' });
  }

  const { fileName, fileSize, bookHash, replicaKind, replicaId, temp = false, media } = req.body;

  // Reject object-key path traversal before building any key. `fileName` is
  // fully client-controlled and is interpolated into `${user.id}/${fileName}`;
  // without this an attacker escapes their own prefix into another user's
  // namespace (GHSA-mfmj-2frf-vhgw).
  if (!isSafeObjectKeyName(fileName)) {
    return res.status(400).json({ error: 'Invalid fileName' });
  }

  if (!isValidFileSize(fileSize)) {
    return res.status(400).json({ error: 'Invalid fileSize' });
  }
  if ((media || temp) && fileSize > MAX_PUBLIC_IMAGE_BYTES) {
    return res.status(413).json({ error: 'File too large' });
  }

  if (media) {
    if (!PUBLIC_MEDIA_KINDS.includes(media)) {
      return res.status(400).json({ error: 'Invalid media' });
    }
    try {
      const userStr = user.id.split('-')[0];
      const fileKey = `media/${media}/${userStr}/${fileName}`;
      const bucketName = process.env['TEMP_STORAGE_PUBLIC_BUCKET_NAME'] || '';
      const uploadUrl = await getUploadSignedUrl(fileKey, fileSize, 1800, bucketName);
      return res.status(200).json({
        uploadUrl,
        downloadUrl: `${READEST_PUBLIC_ASSETS_BASE_URL}/${fileKey}`,
      });
    } catch (error) {
      console.error('Error creating presigned post for media file:', error);
      return res.status(500).json({ error: 'Could not create presigned post' });
    }
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
    const { usage: claimUsage, quota } = getStoragePlanData(token);
    const fileKey = `${user.id}/${fileName}`;
    const supabase = createSupabaseAdminClient();
    const { data: existingRecord, error: fetchError } = await supabase
      .from('files')
      .select('file_size')
      .eq('user_id', user.id)
      .eq('file_key', fileKey)
      .limit(1)
      .maybeSingle();
    if (fetchError) return res.status(500).json({ error: fetchError.message });

    // A re-upload is signed with the recorded size and adds nothing to usage.
    // A new file's row is its reservation: insert it first, then check the
    // quota. The trigger on `files` has already added the row to
    // `plans.storage_usage_bytes`, so the counter includes this upload and
    // every one committed before it; checking before the insert let
    // concurrent requests all pass against the same usage. The token's usage
    // claim is frozen when the token is minted, so it is only the fallback
    // where there is no `plans` row.
    let objSize = fileSize;
    let insertedId: string | null = null;
    if (existingRecord) {
      objSize = existingRecord.file_size;
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from('files')
        .insert([
          {
            user_id: user.id,
            book_hash: bookHash ?? null,
            replica_kind: replicaKind ?? null,
            replica_id: replicaId ?? null,
            file_key: fileKey,
            file_size: fileSize,
          },
        ])
        .select('id')
        .single();
      if (insertError) return res.status(500).json({ error: insertError.message });
      insertedId = inserted.id;
    }

    const dropReservation = async () => {
      if (insertedId) await supabase.from('files').delete().eq('id', insertedId);
    };
    const { data: planRow, error: planError } = await supabase
      .from('plans')
      .select('storage_usage_bytes')
      .eq('id', user.id)
      .single();
    // Only a missing row or a missing `plans` table (self-hosted) falls back;
    // any other failure must not pass the check on the stale claim.
    if (planError && !['PGRST116', 'PGRST205', '42P01'].includes(planError.code)) {
      await dropReservation();
      return res.status(500).json({ error: 'Could not read storage usage' });
    }
    const usage = planRow?.storage_usage_bytes ?? claimUsage + (insertedId ? fileSize : 0);

    if (insertedId && usage > quota + STORAGE_QUOTA_GRACE_BYTES) {
      await dropReservation();
      return res.status(403).json({ error: 'Insufficient storage quota', usage: usage - fileSize });
    }

    try {
      const uploadUrl = await getUploadSignedUrl(fileKey, objSize, 1800);

      res.status(200).json({ uploadUrl, fileKey, usage, quota });
    } catch (error) {
      console.error('Error creating presigned post:', error);
      // Don't leave a row behind for an upload that can never happen.
      await dropReservation();
      res.status(500).json({ error: 'Could not create presigned post' });
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Something went wrong' });
  }
}
