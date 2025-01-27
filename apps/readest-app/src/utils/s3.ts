import { S3Client } from '@aws-sdk/client-s3';

const S3_ACCOUNT_ID = process.env['R2_ACCOUNT_ID'] || '';
const S3_ACCESS_KEY_ID = process.env['R2_ACCESS_KEY_ID'] || '';
const S3_SECRET_ACCESS_KEY = process.env['R2_SECRET_ACCESS_KEY'] || '';
const S3_REGION = process.env['R2_REGION'] || 'auto';

export const s3Client = new S3Client({
  region: S3_REGION,
  endpoint: `https://${S3_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
  },
});

export const r2Client = s3Client;
