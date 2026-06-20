import { getRuntimeConfig } from '@/services/runtimeConfig';

type ObjectStorageType = 'r2' | 's3';

export const getStorageType = (): ObjectStorageType => {
  // Client: read from runtime config injected via /runtime-config.js at container start.
  // Server: fall back to the OBJECT_STORAGE_TYPE process env var.
  const runtimeType = getRuntimeConfig()?.objectStorageType ?? process.env['OBJECT_STORAGE_TYPE'];
  return (runtimeType as ObjectStorageType) || 'r2';
};
