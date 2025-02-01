import { getAPIBaseUrl, isWebAppPlatform } from '@/services/environment';
import { getAccessToken, getUserID } from '@/utils/access';
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

const fetchWithAuth = async (url: string, options: RequestInit) => {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('Not authenticated');
  }
  const headers = {
    ...options.headers,
    Authorization: `Bearer ${token}`,
  };

  const response = await fetch(url, { ...options, headers });

  if (!response.ok) {
    const errorData = await response.json();
    console.error('Error:', errorData.error || response.statusText);
    throw new Error(errorData.error || 'Request failed');
  }

  return response;
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
    throw new Error('File upload failed');
  }
};

export const downloadFile = async (
  filePath: string,
  fileFullPath: string,
  onProgress?: ProgressHandler,
) => {
  try {
    const userId = await getUserID();
    if (!userId) {
      throw new Error('Not authenticated');
    }

    const fileKey = `${userId}/${filePath}`;
    const response = await fetchWithAuth(
      `${API_ENDPOINTS.download}?fileKey=${encodeURIComponent(fileKey)}`,
      {
        method: 'GET',
      },
    );

    const { downloadUrl } = await response.json();

    if (isWebAppPlatform()) {
      return await webDownload(downloadUrl, onProgress);
    } else {
      await tauriDownload(downloadUrl, fileFullPath, onProgress);
      return;
    }
  } catch (error) {
    console.error('File download failed:', error);
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
