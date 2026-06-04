import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import type { S3Settings } from '@/types/settings';

export class S3RequestError extends Error {
  status?: number;
  code?: 'NOT_FOUND' | 'AUTH_FAILED' | 'NETWORK';

  constructor(message: string, status?: number, code?: S3RequestError['code']) {
    super(message);
    this.name = 'S3RequestError';
    this.status = status;
    this.code = code;
  }
}

export type S3ConnectResult = {
  success: boolean;
  code?: 'AUTH_FAILED' | 'BUCKET_NOT_FOUND' | 'UNEXPECTED_STATUS' | 'NETWORK';
  message?: string;
  status?: number;
};

const getClient = (settings: S3Settings) => {
  return new S3Client({
    forcePathStyle: true,
    region: settings.region || 'auto',
    endpoint: settings.endpoint,
    credentials: {
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
    },
  });
};

export const checkConnection = async (settings: S3Settings): Promise<S3ConnectResult> => {
  if (
    !settings.endpoint ||
    !settings.accessKeyId ||
    !settings.secretAccessKey ||
    !settings.bucketName
  ) {
    return { success: false, code: 'AUTH_FAILED', message: 'Missing required fields' };
  }
  try {
    const client = getClient(settings);
    await client.send(new HeadObjectCommand({ Bucket: settings.bucketName, Key: '' }));
  } catch (e: any) {
    if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) {
      // Bucket not found or empty key HEAD might 404, try ListObjectsV2
      try {
        const client = getClient(settings);
        await client.send(new ListObjectsV2Command({ Bucket: settings.bucketName, MaxKeys: 1 }));
      } catch (err: any) {
        if (err.name === 'AccessDenied' || err.$metadata?.httpStatusCode === 403) {
          return { success: false, code: 'AUTH_FAILED', status: err.$metadata?.httpStatusCode };
        } else if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
          return {
            success: false,
            code: 'BUCKET_NOT_FOUND',
            status: err.$metadata?.httpStatusCode,
          };
        }
        return {
          success: false,
          code: 'UNEXPECTED_STATUS',
          status: err.$metadata?.httpStatusCode,
          message: err.message,
        };
      }
    } else if (e.name === 'AccessDenied' || e.$metadata?.httpStatusCode === 403) {
      return { success: false, code: 'AUTH_FAILED', status: e.$metadata?.httpStatusCode };
    } else {
      return {
        success: false,
        code: 'NETWORK',
        message: e.message,
      };
    }
  }
  return { success: true };
};

export const getFile = async (settings: S3Settings, key: string): Promise<string | null> => {
  try {
    const client = getClient(settings);
    const response = await client.send(
      new GetObjectCommand({ Bucket: settings.bucketName, Key: key }),
    );
    if (!response.Body) return null;
    // For Node.js or browser, get the string from the stream
    return await new Response(response.Body as any).text();
  } catch (e: any) {
    if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) {
      return null;
    }
    if (e.name === 'AccessDenied' || e.$metadata?.httpStatusCode === 403) {
      throw new S3RequestError('Authentication failed', e.$metadata?.httpStatusCode, 'AUTH_FAILED');
    }
    throw new S3RequestError('Get failed', e.$metadata?.httpStatusCode, 'NETWORK');
  }
};

export const getFileBinary = async (
  settings: S3Settings,
  key: string,
): Promise<ArrayBuffer | null> => {
  try {
    const client = getClient(settings);
    const response = await client.send(
      new GetObjectCommand({ Bucket: settings.bucketName, Key: key }),
    );
    if (!response.Body) return null;
    // For Node.js or browser, get the array buffer from the stream
    return await new Response(response.Body as any).arrayBuffer();
  } catch (e: any) {
    if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) {
      return null;
    }
    if (e.name === 'AccessDenied' || e.$metadata?.httpStatusCode === 403) {
      throw new S3RequestError('Authentication failed', e.$metadata?.httpStatusCode, 'AUTH_FAILED');
    }
    throw new S3RequestError('Get failed', e.$metadata?.httpStatusCode, 'NETWORK');
  }
};

export const putFile = async (
  settings: S3Settings,
  key: string,
  body: string | ArrayBuffer,
  contentType: string = 'application/json; charset=utf-8',
): Promise<void> => {
  try {
    const client = getClient(settings);
    await client.send(
      new PutObjectCommand({
        Bucket: settings.bucketName,
        Key: key,
        Body: typeof body === 'string' ? body : new Uint8Array(body),
        ContentType: contentType,
      }),
    );
  } catch (e: any) {
    if (e.name === 'AccessDenied' || e.$metadata?.httpStatusCode === 403) {
      throw new S3RequestError('Authentication failed', e.$metadata?.httpStatusCode, 'AUTH_FAILED');
    }
    throw new S3RequestError('Put failed', e.$metadata?.httpStatusCode, 'NETWORK');
  }
};

export const headFile = async (
  settings: S3Settings,
  key: string,
): Promise<{ size?: number; etag?: string } | null> => {
  try {
    const client = getClient(settings);
    const response = await client.send(
      new HeadObjectCommand({ Bucket: settings.bucketName, Key: key }),
    );
    return {
      size: response.ContentLength,
      etag: response.ETag,
    };
  } catch (e: any) {
    if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) {
      return null;
    }
    if (e.name === 'AccessDenied' || e.$metadata?.httpStatusCode === 403) {
      throw new S3RequestError('Authentication failed', e.$metadata?.httpStatusCode, 'AUTH_FAILED');
    }
    throw new S3RequestError('Head failed', e.$metadata?.httpStatusCode, 'NETWORK');
  }
};

export const deleteFile = async (settings: S3Settings, key: string): Promise<void> => {
  try {
    const client = getClient(settings);
    await client.send(new DeleteObjectCommand({ Bucket: settings.bucketName, Key: key }));
  } catch (e: any) {
    if (e.name === 'AccessDenied' || e.$metadata?.httpStatusCode === 403) {
      throw new S3RequestError('Authentication failed', e.$metadata?.httpStatusCode, 'AUTH_FAILED');
    }
    throw new S3RequestError('Delete failed', e.$metadata?.httpStatusCode, 'NETWORK');
  }
};

export const listDirectory = async (settings: S3Settings, prefix: string) => {
  const client = getClient(settings);
  const response = await client.send(
    new ListObjectsV2Command({
      Bucket: settings.bucketName,
      Prefix: prefix.endsWith('/') ? prefix : `${prefix}/`,
      Delimiter: '/',
    }),
  );

  const directories: string[] = [];
  const files: { name: string; path: string; size?: number; lastModified?: string }[] = [];

  if (response.CommonPrefixes) {
    for (const cp of response.CommonPrefixes) {
      if (cp.Prefix) {
        const parts = cp.Prefix.split('/').filter(Boolean);
        if (parts.length > 0) {
          directories.push(parts[parts.length - 1] as string);
        }
      }
    }
  }

  if (response.Contents) {
    for (const obj of response.Contents) {
      if (obj.Key) {
        const parts = obj.Key.split('/').filter(Boolean);
        if (parts.length > 0) {
          files.push({
            name: parts[parts.length - 1] as string,
            path: obj.Key,
            size: obj.Size,
            lastModified: obj.LastModified?.toISOString(),
          });
        }
      }
    }
  }

  return { directories, files };
};

export const deleteDirectory = async (settings: S3Settings, prefix: string) => {
  const client = getClient(settings);
  const listResponse = await client.send(
    new ListObjectsV2Command({
      Bucket: settings.bucketName,
      Prefix: prefix.endsWith('/') ? prefix : `${prefix}/`,
    }),
  );

  if (listResponse.Contents && listResponse.Contents.length > 0) {
    const deleteCommands = listResponse.Contents.map((obj) =>
      client.send(new DeleteObjectCommand({ Bucket: settings.bucketName, Key: obj.Key })),
    );
    await Promise.all(deleteCommands);
  }
};
