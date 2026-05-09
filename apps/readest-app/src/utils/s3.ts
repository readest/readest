import { S3Client } from '@aws-sdk/client-s3';
import {
  GetObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const S3_ENDPOINT = process.env['S3_ENDPOINT'] || '';
const S3_REGION = process.env['S3_REGION'] || 'auto';
const S3_ACCESS_KEY_ID = process.env['S3_ACCESS_KEY_ID'] || '';
const S3_SECRET_ACCESS_KEY = process.env['S3_SECRET_ACCESS_KEY'] || '';

export const s3Client = new S3Client({
  forcePathStyle: true,
  region: S3_REGION,
  endpoint: S3_ENDPOINT,
  credentials: {
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
  },
});

export const s3Storage = {
  getClient: () => {
    return new S3Client({
      forcePathStyle: true,
      region: S3_REGION,
      endpoint: S3_ENDPOINT,
      credentials: {
        accessKeyId: S3_ACCESS_KEY_ID,
        secretAccessKey: S3_SECRET_ACCESS_KEY,
      },
    });
  },

  getDownloadSignedUrl: async (bucketName: string, fileKey: string, expiresIn: number) => {
    const getCommand = new GetObjectCommand({
      Bucket: bucketName,
      Key: fileKey,
    });
    const downloadUrl = await getSignedUrl(s3Client, getCommand, {
      expiresIn: expiresIn,
    });
    return downloadUrl;
  },

  getUploadSignedUrl: async (
    bucketName: string,
    fileKey: string,
    contentLength: number,
    expiresIn: number,
  ) => {
    const signableHeaders = new Set<string>();
    signableHeaders.add('content-length');
    const putCommand = new PutObjectCommand({
      Bucket: bucketName,
      Key: fileKey,
      ContentLength: contentLength,
    });

    const uploadUrl = await getSignedUrl(s3Client, putCommand, {
      expiresIn: expiresIn,
      signableHeaders,
    });

    return uploadUrl;
  },

  deleteObject: async (bucketName: string, fileKey: string) => {
    const deleteCommand = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: fileKey,
    });

    return await s3Storage.getClient().send(deleteCommand);
  },

  headObject: async (bucketName: string, fileKey: string) => {
    const headCommand = new HeadObjectCommand({
      Bucket: bucketName,
      Key: fileKey,
    });

    return await s3Storage.getClient().send(headCommand);
  },

  copyObject: async (
    bucketName: string,
    sourceFileKey: string,
    destFileKey: string,
    sourceBucketName?: string,
  ) => {
    const srcBucket = sourceBucketName || bucketName;
    // S3 requires CopySource to be URL-encoded segment-by-segment. file_key
    // is built from the original filename, so spaces and reserved chars
    // (e.g. `My Book.epub`, `A&B.epub`) are common and would otherwise
    // break the copy.
    const encodeKey = (key: string): string => key.split('/').map(encodeURIComponent).join('/');
    const copyCommand = new CopyObjectCommand({
      Bucket: bucketName,
      Key: destFileKey,
      CopySource: `${srcBucket}/${encodeKey(sourceFileKey)}`,
    });

    return await s3Storage.getClient().send(copyCommand);
  },
};
