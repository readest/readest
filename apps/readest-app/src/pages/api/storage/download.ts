import type { NextApiRequest, NextApiResponse } from 'next';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { getDownloadSignedUrl } from '@/utils/object';
import { validateUserAndToken } from '@/utils/access';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await runMiddleware(req, res, corsAllMethods);

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { user, token } = await validateUserAndToken(req.headers['authorization']);
    if (!user || !token) {
      return res.status(403).json({ error: 'Not authenticated' });
    }

    if (req.method === 'GET') {
      const { fileKey } = req.query;
      if (!fileKey || typeof fileKey !== 'string') {
        return res.status(400).json({ error: 'Missing or invalid fileKey' });
      }

      const downloadUrlsMap = await processFileKeys([fileKey], user.id);
      const downloadUrl = downloadUrlsMap[fileKey];

      if (!downloadUrl) {
        return res.status(404).json({ error: 'File not found' });
      }

      return res.status(200).json({ downloadUrl });
    }

    if (req.method === 'POST') {
      const { fileKeys } = req.body;

      if (!fileKeys || !Array.isArray(fileKeys)) {
        return res.status(400).json({ error: 'Missing or invalid fileKeys array' });
      }

      if (fileKeys.length === 0) {
        return res.status(400).json({ error: 'fileKeys array cannot be empty' });
      }

      if (!fileKeys.every((key) => typeof key === 'string')) {
        return res.status(400).json({ error: 'All fileKeys must be strings' });
      }

      const downloadUrls = await processFileKeys(fileKeys, user.id);

      return res.status(200).json({ downloadUrls });
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Something went wrong' });
  }
}

async function processFileKeys(
  fileKeys: string[],
  userId: string,
): Promise<Record<string, string | undefined>> {
  const supabase = createSupabaseAdminClient();

  const { data: fileRecords, error: fileError } = await supabase
    .from('files')
    .select('user_id, file_key, book_hash')
    .eq('user_id', userId)
    .in('file_key', fileKeys)
    .is('deleted_at', null);

  if (fileError) {
    console.error('Error querying files:', fileError);
    return Object.fromEntries(fileKeys.map((key) => [key, undefined]));
  }

  const fileRecordMap = new Map((fileRecords || []).map((record) => [record.file_key, record]));

  const missingFileKeys = fileKeys.filter((key) => !fileRecordMap.has(key));

  if (missingFileKeys.length > 0) {
    const fallbackCandidates = missingFileKeys
      .filter((key) => key.includes('Readest/Book'))
      .map((key) => {
        const parts = key.split('/');
        if (parts.length === 5) {
          const bookHash = parts[3]!;
          const filename = parts[4]!;
          const fileExtension = filename.split('.').pop() || '';
          return { originalKey: key, bookHash, fileExtension };
        }
        return null;
      })
      .filter(Boolean) as Array<{ originalKey: string; bookHash: string; fileExtension: string }>;

    if (fallbackCandidates.length > 0) {
      const bookHashes = [...new Set(fallbackCandidates.map((c) => c.bookHash))];

      const { data: fallbackRecords, error: fallbackError } = await supabase
        .from('files')
        .select('user_id, file_key, book_hash')
        .eq('user_id', userId)
        .in('book_hash', bookHashes)
        .is('deleted_at', null);

      if (!fallbackError && fallbackRecords) {
        for (const candidate of fallbackCandidates) {
          const matchedFile = fallbackRecords.find(
            (f) =>
              f.book_hash === candidate.bookHash &&
              f.file_key.endsWith(`.${candidate.fileExtension}`),
          );
          if (matchedFile) {
            fileRecordMap.set(candidate.originalKey, matchedFile);
          }
        }
      }
    }
  }

  const results = await Promise.allSettled(
    fileKeys.map(async (fileKey) => {
      const fileRecord = fileRecordMap.get(fileKey);

      if (!fileRecord) {
        return { fileKey, downloadUrl: undefined };
      }

      if (fileRecord.user_id !== userId) {
        return { fileKey, downloadUrl: undefined };
      }

      try {
        const downloadUrl = await getDownloadSignedUrl(fileRecord.file_key, 1800);
        return { fileKey, downloadUrl };
      } catch (error) {
        console.error(`Error creating signed URL for ${fileKey}:`, error);
        return { fileKey, downloadUrl: undefined };
      }
    }),
  );

  const downloadUrls: Record<string, string | undefined> = {};

  results.forEach((result, index) => {
    const fileKey = fileKeys[index]!;
    if (result.status === 'fulfilled') {
      downloadUrls[fileKey] = result.value.downloadUrl;
    } else {
      downloadUrls[fileKey] = undefined;
    }
  });

  return downloadUrls;
}
