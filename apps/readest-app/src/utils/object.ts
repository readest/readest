import { s3Storage } from './s3';
import { r2Storage } from './r2';
import { getStorageType } from './storage';

export const getDownloadSignedUrl = async (fileKey: string, expiresIn: number) => {
  const storageType = getStorageType();
  if (storageType === 'r2') {
    const bucketName = process.env['R2_BUCKET_NAME'] || '';
    return await r2Storage.getDownloadSignedUrl(bucketName, fileKey, expiresIn);
  } else {
    const bucketName = process.env['S3_BUCKET_NAME'] || '';
    return await s3Storage.getDownloadSignedUrl(bucketName, fileKey, expiresIn);
  }
};

export const getUploadSignedUrl = async (
  fileKey: string,
  contentLength: number,
  expiresIn: number,
) => {
  const storageType = getStorageType();
  if (storageType === 'r2') {
    const bucketName = process.env['R2_BUCKET_NAME'] || '';
    return await r2Storage.getUploadSignedUrl(bucketName, fileKey, contentLength, expiresIn);
  } else {
    const bucketName = process.env['S3_BUCKET_NAME'] || '';
    return await s3Storage.getUploadSignedUrl(bucketName, fileKey, contentLength, expiresIn);
  }
};

export const deleteObject = async (fileKey: string) => {
  const storageType = getStorageType();
  if (storageType === 'r2') {
    const bucketName = process.env['R2_BUCKET_NAME'] || '';
    return await r2Storage.deleteObject(bucketName, fileKey);
  } else {
    const bucketName = process.env['S3_BUCKET_NAME'] || '';
    return await s3Storage.deleteObject(bucketName, fileKey);
  }
};
