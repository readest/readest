import { getAPIBaseUrl } from '@/services/environment';
import { getAccessToken, getUserID } from '@/utils/access';

const UPLOAD_API_ENDPOINT = getAPIBaseUrl() + '/storage/upload';
const DOWNLOAD_API_ENDPOINT = getAPIBaseUrl() + '/storage/download';

export const uploadFile = async (file: File, bookHash?: string) => {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('Not authenticated');
  }
  try {
    const response = await fetch(UPLOAD_API_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fileName: file.name,
        fileSize: file.size,
        bookHash,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.log('Error generating presigned post:', errorData.error);
      throw new Error('File upload failed');
    }

    const urlResponse = await response.json();
    const { uploadUrl } = urlResponse;
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

export const downloadFile = async (fp: string) => {
  const token = await getAccessToken();
  const userId = await getUserID();
  if (!token || !userId) {
    throw new Error('Not authenticated');
  }
  try {
    const fileKey = `${userId}/${fp}`;
    const response = await fetch(
      `${DOWNLOAD_API_ENDPOINT}?fileKey=${encodeURIComponent(fileKey)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Error generating download URL:', errorData.error);
      throw new Error('File download failed');
    }

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
