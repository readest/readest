import { getAPIBaseUrl } from '@/services/environment';
import { getAccessToken, getUserID } from '@/utils/access';

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

export const uploadFile = async (file: File, bookHash?: string) => {
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

    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      body: file,
    });

    if (!uploadResponse.ok) {
      console.error('File upload failed:', await uploadResponse.text());
      throw new Error('File upload failed');
    }
  } catch (error) {
    console.error('File upload failed:', error);
    throw new Error('File upload failed');
  }
};

export const downloadFile = async (filePath: string) => {
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

    const downloadResponse = await fetch(downloadUrl);
    if (!downloadResponse.ok) {
      console.error('Error downloading file:', await downloadResponse.text());
      throw new Error('File download failed');
    }

    return await downloadResponse.blob();
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
