import { AwsClient } from 'aws4fetch';

const R2_ACCOUNT_ID = process.env['R2_ACCOUNT_ID']!;
const R2_ACCESS_KEY_ID = process.env['R2_ACCESS_KEY_ID']!;
const R2_SECRET_ACCESS_KEY = process.env['R2_SECRET_ACCESS_KEY']!;
const R2_REGION = process.env['R2_REGION'] || 'auto';
const R2_URL = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

const client = new AwsClient({
  service: 's3',
  region: R2_REGION,
  accessKeyId: R2_ACCESS_KEY_ID,
  secretAccessKey: R2_SECRET_ACCESS_KEY,
});

export const getDownloadSignedUrl = async (
  bucketName: string,
  fileKey: string,
  expiresIn: number,
) => {
  return (
    await client.sign(
      new Request(`${R2_URL}/${bucketName}/${fileKey}?X-Amz-Expires=${expiresIn}`),
      {
        aws: { signQuery: true },
      },
    )
  ).url.toString();
};

export const getUploadSignedUrl = async (
  bucketName: string,
  fileKey: string,
  contentLength: number,
  expiresIn: number,
) => {
  return (
    await client.sign(
      new Request(
        `${R2_URL}/${bucketName}/${fileKey}?X-Amz-Expires=${expiresIn}&X-Amz-SignedHeaders=content-length`,
        {
          method: 'PUT',
          headers: {
            'Content-Length': contentLength.toString(),
          },
        },
      ),
      {
        aws: { signQuery: true },
      },
    )
  ).url.toString();
};

export const deleteObject = async (bucketName: string, fileKey: string) => {
  return await client.fetch(`${R2_URL}/${bucketName}/${fileKey}`, {
    method: 'DELETE',
  });
};
