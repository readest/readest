import { invoke, Channel } from '@tauri-apps/api/core';

export type UploadMethod = 'POST' | 'PUT';

export interface ProgressPayload {
  progress: number;
  total: number;
  transferSpeed: number;
}

export type ProgressHandler = (progress: ProgressPayload) => void;

export const webUpload = (file: File, uploadUrl: string, onProgress?: ProgressHandler) => {
  return new Promise<void>((resolve, reject) => {
    const startTime = Date.now();
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl, true);

    xhr.upload.onprogress = (event) => {
      if (onProgress && event.lengthComputable) {
        onProgress({
          progress: event.loaded,
          total: event.total,
          transferSpeed: event.loaded / ((Date.now() - startTime) / 1000),
        });
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error('Upload failed'));

    xhr.send(file);
  });
};

export const webDownload = async (downloadUrl: string, onProgress?: ProgressHandler) => {
  const response = await fetch(downloadUrl);
  if (!response.ok) throw new Error('File download failed');

  const contentLength = response.headers.get('Content-Length');
  if (!contentLength) throw new Error('Cannot track progress: Content-Length missing');

  const totalSize = parseInt(contentLength, 10);
  let receivedSize = 0;
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];

  const startTime = Date.now();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    chunks.push(value);
    receivedSize += value.length;

    if (onProgress) {
      onProgress({
        progress: receivedSize,
        total: totalSize,
        transferSpeed: receivedSize / ((Date.now() - startTime) / 1000),
      });
    }
  }

  return new Blob(chunks);
};

export const tauriUpload = async (
  url: string,
  filePath: string,
  method: UploadMethod,
  progressHandler?: ProgressHandler,
  headers?: Map<string, string>,
): Promise<string> => {
  const ids = new Uint32Array(1);
  window.crypto.getRandomValues(ids);
  const id = ids[0];

  const onProgress = new Channel<ProgressPayload>();
  if (progressHandler) {
    onProgress.onmessage = progressHandler;
  }

  return await invoke('upload_file', {
    id,
    url,
    filePath,
    method,
    headers: headers ?? {},
    onProgress,
  });
};

export const tauriDownload = async (
  url: string,
  filePath: string,
  progressHandler?: ProgressHandler,
  headers?: Map<string, string>,
  body?: string,
): Promise<void> => {
  const ids = new Uint32Array(1);
  window.crypto.getRandomValues(ids);
  const id = ids[0];

  const onProgress = new Channel<ProgressPayload>();
  if (progressHandler) {
    onProgress.onmessage = progressHandler;
  }

  await invoke('download_file', {
    id,
    url,
    filePath,
    headers: headers ?? {},
    onProgress,
    body,
  });
};
