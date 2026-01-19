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
  stats: getAPIBaseUrl() + '/storage/stats',
  list: getAPIBaseUrl() + '/storage/list',
  purge: getAPIBaseUrl() + '/storage/purge',
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
  temp = false,
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
        temp,
      }),
    });

    const { uploadUrl, downloadUrl }: { uploadUrl: string; downloadUrl?: string } =
      await response.json();
    if (isWebAppPlatform()) {
      await webUpload(file, uploadUrl, onProgress);
    } else {
      await tauriUpload(uploadUrl, fileFullPath, 'PUT', onProgress);
    }
    return temp ? downloadUrl : undefined;
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
  headers?: Record<string, string>;
  singleThreaded?: boolean;
  skipSslVerification?: boolean;
  onProgress?: ProgressHandler;
};

export const downloadFile = async ({
  appService,
  dst,
  cfp,
  url,
  headers,
  singleThreaded,
  skipSslVerification,
  onProgress,
}: DownloadFileParams) => {
  try {
    let downloadUrl = url;
    if (!downloadUrl) {
      const userId = await getUserID();
      if (!userId) {
        throw new Error('Not authenticated');
      }
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
      const { headers: responseHeaders, blob } = await webDownload(
        downloadUrl,
        onProgress,
        headers,
      );
      await appService.writeFile(dst, 'None', await blob.arrayBuffer());
      return responseHeaders;
    } else {
      return await tauriDownload(
        downloadUrl,
        dst,
        onProgress,
        headers,
        undefined,
        singleThreaded,
        skipSslVerification,
      );
    }
  } catch (error) {
    console.error(`File '${dst}' download failed:`, error);
    throw error;
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

export interface StorageStats {
  totalFiles: number;
  totalSize: number;
  usage: number;
  quota: number;
  usagePercentage: number;
  byBookHash: Array<{
    bookHash: string | null;
    fileCount: number;
    totalSize: number;
  }>;
}

export const getStorageStats = async (): Promise<StorageStats> => {
  try {
    const response = await fetchWithAuth(API_ENDPOINTS.stats, {
      method: 'GET',
    });

    return await response.json();
  } catch (error) {
    console.error('Get storage stats failed:', error);
    throw new Error('Get storage stats failed');
  }
};

export interface FileRecord {
  file_key: string;
  file_size: number;
  book_hash: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface ListFilesParams {
  page?: number;
  pageSize?: number;
  sortBy?: 'created_at' | 'updated_at' | 'file_size' | 'file_key';
  sortOrder?: 'asc' | 'desc';
  bookHash?: string;
  search?: string;
}

interface ListFilesResponse {
  files: FileRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export const listFiles = async (params?: ListFilesParams): Promise<ListFilesResponse> => {
  try {
    const queryParams = new URLSearchParams();

    if (params?.page) queryParams.set('page', params.page.toString());
    if (params?.pageSize) queryParams.set('pageSize', params.pageSize.toString());
    if (params?.sortBy) queryParams.set('sortBy', params.sortBy);
    if (params?.sortOrder) queryParams.set('sortOrder', params.sortOrder);
    if (params?.bookHash) queryParams.set('bookHash', params.bookHash);
    if (params?.search) queryParams.set('search', params.search);

    const url = queryParams.toString()
      ? `${API_ENDPOINTS.list}?${queryParams.toString()}`
      : API_ENDPOINTS.list;

    const response = await fetchWithAuth(url, {
      method: 'GET',
    });

    return await response.json();
  } catch (error) {
    console.error('List files failed:', error);
    throw new Error('List files failed');
  }
};

interface PurgeFilesResult {
  success: string[];
  failed: Array<{ fileKey: string; error: string }>;
  deletedCount: number;
  failedCount: number;
}

export const purgeFiles = async (
  filePathsOrKeys: string[],
  isFileKeys = false,
): Promise<PurgeFilesResult> => {
  try {
    let fileKeys: string[];

    if (isFileKeys) {
      fileKeys = filePathsOrKeys;
    } else {
      const userId = await getUserID();
      if (!userId) {
        throw new Error('Not authenticated');
      }
      fileKeys = filePathsOrKeys.map((path) => `${userId}/${path}`);
    }

    const response = await fetchWithAuth(API_ENDPOINTS.purge, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fileKeys }),
    });

    return await response.json();
  } catch (error) {
    console.error('Purge files failed:', error);
    throw new Error('Purge files failed');
  }
};
