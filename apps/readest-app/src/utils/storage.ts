type ObjectStorageType = 'r2' | 's3';

export const getStorageType = (): ObjectStorageType => {
  // TODO: do not expose storage type to client
  if (process.env['NEXT_PUBLIC_OBJECT_STORAGE_TYPE']) {
    return process.env['NEXT_PUBLIC_OBJECT_STORAGE_TYPE'] as ObjectStorageType;
  } else {
    return 'r2';
  }
};
