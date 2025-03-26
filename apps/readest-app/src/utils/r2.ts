import { AwsClient } from 'aws4fetch';

export const r2Storage = {
  getR2Client: () => {
    return new AwsClient({
      service: 's3',
      region: process.env['R2_REGION'] || 'auto',
      accessKeyId: process.env['R2_ACCESS_KEY_ID']!,
      secretAccessKey: process.env['R2_SECRET_ACCESS_KEY']!,
    });
  },

  getR2Url: () => {
    const R2_ACCOUNT_ID = process.env['R2_ACCOUNT_ID']!;
    return `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  },

  getDownloadSignedUrl: async (
    bucketName: string,
    fileKey: string,
    expiresIn: number,
  ) => {
    return (
      await r2Storage.getR2Client().sign(
        new Request(`${r2Storage.getR2Url()}/${bucketName}/${fileKey}?X-Amz-Expires=${expiresIn}`),
        {
          aws: { signQuery: true },
        },
      )
    ).url.toString();
  },

  getUploadSignedUrl: async (
    bucketName: string,
    fileKey: string,
    contentLength: number,
    expiresIn: number,
  ) => {
    return (
      await r2Storage.getR2Client().sign(
        new Request(
          `${r2Storage.getR2Url()}/${bucketName}/${fileKey}?X-Amz-Expires=${expiresIn}&X-Amz-SignedHeaders=content-length`,
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
  },

  deleteObject: async (bucketName: string, fileKey: string) => {
    return await r2Storage.getR2Client().fetch(`${r2Storage.getR2Url()}/${bucketName}/${fileKey}`, {
      method: 'DELETE',
    });
  },
};
