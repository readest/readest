import { getAPIBaseUrl, isWebAppPlatform } from '@/services/environment';
import { AppService } from '@/types/system';
import { getUserID } from '@/utils/access';
import { fetchWithAuth } from '@/utils/fetch';
import {
  tauriUpload,
  tauriDownload,
  webUpload,
  webDownload,
  ProgressHandler,
  ProgressPayload,
} from '@/utils/transfer';

const API_ENDPOINTS = {
  upload: getAPIBaseUrl() + '/storage/upload',
  download: getAPIBaseUrl() + '/storage/download',
  delete: getAPIBaseUrl() + '/storage/delete',
};

export const createProgressHandler = (
  totalFiles: number,
  completedFilesRef: { count: number },
  onProgress?: ProgressHandler,
) => {
  return (progress: ProgressPayload) => {
    const fileProgress = progress.progress / progress.total;
    const overallProgress = ((completedFilesRef.count + fileProgress) / totalFiles) * 100;

    if (onProgress) {
      onProgress({
        progress: overallProgress,
        total: 100,
        transferSpeed: progress.transferSpeed,
      });
    }
  };
};

export const uploadFile = async (
  file: File,
  fileFullPath: string,
  onProgress?: ProgressHandler,
  bookHash?: string,
) => {
  try {
    const response = await fetchWithAuth(API_ENDPOINTS.upload, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fileName: file.name,
        fileSize: file.size,
        bookHash,
      }),
    });

    const { uploadUrl } = await response.json();
    if (isWebAppPlatform()) {
      await webUpload(file, uploadUrl, onProgress);
    } else {
      await tauriUpload(uploadUrl, fileFullPath, 'PUT', onProgress);
    }
  } catch (error) {
    console.error('File upload failed:', error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('File upload failed');
  }
};

export const batchGetDownloadUrls = async (files: { lfp: string; cfp: string }[]) => {
  try {
    const userId = await getUserID();
    if (!userId) {
      throw new Error('Not authenticated');
    }
    const filePaths = files.map((file) => file.cfp);
    const fileKeys = filePaths.map((path) => `${userId}/${path}`);
    const response = await fetchWithAuth(`${API_ENDPOINTS.download}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fileKeys }),
    });

    const { downloadUrls } = await response.json();
    return files.map((file) => {
      const fileKey = `${userId}/${file.cfp}`;
      return {
        lfp: file.lfp,
        cfp: file.cfp,
        downloadUrl: downloadUrls[fileKey],
      };
    });
  } catch (error) {
    console.error('Batch get download URLs failed:', error);
    throw new Error('Batch get download URLs failed');
  }
};

type DownloadFileParams = {
  appService: AppService;
  dst: string;
  cfp: string;
  url?: string;
  onProgress?: ProgressHandler;
};

export const downloadFile = async ({
  appService,
  dst,
  cfp,
  url,
  onProgress,
}: DownloadFileParams) => {
  try {
    const userId = await getUserID();
    if (!userId) {
      throw new Error('Not authenticated');
    }

    let downloadUrl = url;
    if (!downloadUrl) {
      const fileKey = `${userId}/${cfp}`;
      const response = await fetchWithAuth(
        `${API_ENDPOINTS.download}?fileKey=${encodeURIComponent(fileKey)}`,
        {
          method: 'GET',
        },
      );

      const { downloadUrl: url } = await response.json();
      downloadUrl = url;
    }

    if (!downloadUrl) {
      throw new Error('No download URL available');
    }

    if (isWebAppPlatform()) {
      const file = await webDownload(downloadUrl, onProgress);
      await appService.writeFile(dst, 'None', await file.arrayBuffer());
    } else {
      await tauriDownload(downloadUrl, dst, onProgress);
    }
  } catch (error) {
    console.error(`File '${dst}' download failed:`, error);
    throw new Error('File download failed');
  }
};

export const deleteFile = async (filePath: string) => {
  try {
    const userId = await getUserID();
    if (!userId) {
      throw new Error('Not authenticated');
    }

    const fileKey = `${userId}/${filePath}`;
    await fetchWithAuth(`${API_ENDPOINTS.delete}?fileKey=${encodeURIComponent(fileKey)}`, {
      method: 'DELETE',
    });
  } catch (error) {
    console.error('File deletion failed:', error);
    throw new Error('File deletion failed');
  }
};
