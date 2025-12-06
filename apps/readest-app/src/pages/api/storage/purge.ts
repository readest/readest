import type { NextApiRequest, NextApiResponse } from 'next';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { validateUserAndToken } from '@/utils/access';
import { deleteObject } from '@/utils/object';

interface BulkDeleteResult {
  success: string[];
  failed: Array<{ fileKey: string; error: string }>;
  deletedCount: number;
  failedCount: number;
}

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

    const { fileKeys } = req.body;

    if (!fileKeys || !Array.isArray(fileKeys)) {
      return res.status(400).json({ error: 'Missing or invalid fileKeys array' });
    }

    if (fileKeys.length === 0) {
      return res.status(400).json({ error: 'fileKeys array cannot be empty' });
    }

    if (fileKeys.length > 100) {
      return res.status(400).json({ error: 'Cannot delete more than 100 files at once' });
    }

    if (!fileKeys.every((key) => typeof key === 'string')) {
      return res.status(400).json({ error: 'All fileKeys must be strings' });
    }

    const supabase = createSupabaseAdminClient();

    // Fetch all files that match the provided keys and belong to the user
    const { data: fileRecords, error: fileError } = await supabase
      .from('files')
      .select('id, user_id, file_key')
      .eq('user_id', user.id)
      .in('file_key', fileKeys)
      .is('deleted_at', null);

    if (fileError) {
      console.error('Error querying files:', fileError);
      return res.status(500).json({ error: 'Failed to retrieve files for deletion' });
    }

    if (!fileRecords || fileRecords.length === 0) {
      return res.status(404).json({ error: 'No matching files found' });
    }

    // Verify all files belong to the user
    const unauthorizedFiles = fileRecords.filter((record) => record.user_id !== user.id);
    if (unauthorizedFiles.length > 0) {
      return res.status(403).json({ error: 'Unauthorized access to one or more files' });
    }

    // Process deletions
    const results = await Promise.allSettled(
      fileRecords.map(async (fileRecord) => {
        try {
          // Delete from storage
          await deleteObject(fileRecord.file_key);

          // Delete from database
          const { error: deleteError } = await supabase
            .from('files')
            .delete()
            .eq('id', fileRecord.id);

          if (deleteError) {
            throw new Error(`Database deletion failed: ${deleteError.message}`);
          }

          return { fileKey: fileRecord.file_key, success: true };
        } catch (error) {
          console.error(`Error deleting file ${fileRecord.file_key}:`, error);
          return {
            fileKey: fileRecord.file_key,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      }),
    );

    const success: string[] = [];
    const failed: Array<{ fileKey: string; error: string }> = [];

    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        if (result.value.success) {
          success.push(result.value.fileKey);
        } else {
          failed.push({
            fileKey: result.value.fileKey,
            error: result.value.error || 'Unknown error',
          });
        }
      } else {
        failed.push({
          fileKey: 'unknown',
          error: result.reason?.message || 'Promise rejected',
        });
      }
    });

    // Handle files that weren't found in the database
    const foundFileKeys = new Set(fileRecords.map((record) => record.file_key));
    const notFoundKeys = fileKeys.filter((key) => !foundFileKeys.has(key));
    notFoundKeys.forEach((key) => {
      failed.push({
        fileKey: key,
        error: 'File not found or already deleted',
      });
    });

    const response: BulkDeleteResult = {
      success,
      failed,
      deletedCount: success.length,
      failedCount: failed.length,
    };

    // Return 207 Multi-Status if there are partial failures
    const statusCode =
      failed.length > 0 && success.length > 0 ? 207 : failed.length > 0 ? 500 : 200;

    return res.status(statusCode).json(response);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Something went wrong' });
  }
}
