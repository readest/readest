import { s3Storage } from './s3';
import { r2Storage } from './r2';
import { getStorageType } from './storage';

/**
 * Whether a client-supplied `fileName` is safe to interpolate into a storage
 * object key (`${userId}/${fileName}`). The R2 signer builds the key into
 * `new Request(url)`, whose WHATWG URL parser collapses `../` segments before
 * the request is signed — so an unsanitized name can escape the caller's
 * `${userId}/` prefix and write into another tenant's namespace
 * (GHSA-mfmj-2frf-vhgw).
 *
 * Legitimate names DO contain `/` (e.g. `Readest/Books/<hash>.epub`,
 * `Readest/Replicas/<kind>/<id>/<file>`), so we reject traversal rather than
 * separators: no `.`/`..`/empty path segments, no leading slash (absolute), no
 * backslash or NUL, checked on both the raw and percent-decoded forms.
 */
export const isSafeObjectKeyName = (fileName: string): boolean => {
  if (typeof fileName !== 'string' || fileName.length === 0) return false;

  const forms = [fileName];
  try {
    const decoded = decodeURIComponent(fileName);
    if (decoded !== fileName) forms.push(decoded);
  } catch {
    return false; // malformed percent-encoding
  }

  for (const form of forms) {
    if (form.includes('\\') || form.includes('\0')) return false;
    if (form.startsWith('/')) return false;
    if (form.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) return false;
  }
  return true;
};

export const getDownloadSignedUrl = async (
  fileKey: string,
  expiresIn: number,
  bucketName?: string,
) => {
  const storageType = getStorageType();
  if (storageType === 'r2') {
    bucketName = bucketName || process.env['R2_BUCKET_NAME'] || '';
    return await r2Storage.getDownloadSignedUrl(bucketName, fileKey, expiresIn);
  } else {
    bucketName = bucketName || process.env['S3_BUCKET_NAME'] || '';
    return await s3Storage.getDownloadSignedUrl(bucketName, fileKey, expiresIn);
  }
};

export const getUploadSignedUrl = async (
  fileKey: string,
  contentLength: number,
  expiresIn: number,
  bucketName?: string,
) => {
  const storageType = getStorageType();
  if (storageType === 'r2') {
    bucketName = bucketName || process.env['R2_BUCKET_NAME'] || '';
    return await r2Storage.getUploadSignedUrl(bucketName, fileKey, contentLength, expiresIn);
  } else {
    bucketName = bucketName || process.env['S3_BUCKET_NAME'] || '';
    return await s3Storage.getUploadSignedUrl(bucketName, fileKey, contentLength, expiresIn);
  }
};

export const putObject = async (
  fileKey: string,
  body: ArrayBuffer | string,
  contentType: string,
  bucketName?: string,
) => {
  const storageType = getStorageType();
  if (storageType === 'r2') {
    bucketName = bucketName || process.env['R2_BUCKET_NAME'] || '';
    return await r2Storage.putObject(bucketName, fileKey, body, contentType);
  } else {
    bucketName = bucketName || process.env['S3_BUCKET_NAME'] || '';
    return await s3Storage.putObject(bucketName, fileKey, body, contentType);
  }
};

export const deleteObject = async (fileKey: string, bucketName?: string) => {
  const storageType = getStorageType();
  if (storageType === 'r2') {
    bucketName = bucketName || process.env['R2_BUCKET_NAME'] || '';
    return await r2Storage.deleteObject(bucketName, fileKey);
  } else {
    bucketName = bucketName || process.env['S3_BUCKET_NAME'] || '';
    return await s3Storage.deleteObject(bucketName, fileKey);
  }
};

// Returns true if the object exists in storage. Used to verify uploads completed
// before treating a `files` row as shareable.
export const objectExists = async (fileKey: string, bucketName?: string): Promise<boolean> => {
  const storageType = getStorageType();
  try {
    if (storageType === 'r2') {
      bucketName = bucketName || process.env['R2_BUCKET_NAME'] || '';
      const response = await r2Storage.headObject(bucketName, fileKey);
      return response.ok;
    } else {
      bucketName = bucketName || process.env['S3_BUCKET_NAME'] || '';
      await s3Storage.headObject(bucketName, fileKey);
      return true;
    }
  } catch {
    return false;
  }
};

// Server-side byte copy used by /api/share/[token]/import to clone a shared
// book into the recipient's namespace without egress.
export const copyObject = async (
  sourceFileKey: string,
  destFileKey: string,
  bucketName?: string,
) => {
  const storageType = getStorageType();
  if (storageType === 'r2') {
    bucketName = bucketName || process.env['R2_BUCKET_NAME'] || '';
    return await r2Storage.copyObject(bucketName, sourceFileKey, destFileKey);
  } else {
    bucketName = bucketName || process.env['S3_BUCKET_NAME'] || '';
    return await s3Storage.copyObject(bucketName, sourceFileKey, destFileKey);
  }
};
