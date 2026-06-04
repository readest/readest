import { S3Settings } from '@/types/settings';

export interface S3ConnectFormValues {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  rootPath: string;
}

export const buildS3ConnectSettings = (
  previous: Partial<S3Settings> | undefined,
  form: S3ConnectFormValues,
): S3Settings => {
  return {
    ...(previous ?? {}),
    enabled: true,
    endpoint: form.endpoint.trim(),
    region: form.region.trim(),
    accessKeyId: form.accessKeyId,
    secretAccessKey: form.secretAccessKey,
    bucketName: form.bucketName.trim(),
    rootPath: form.rootPath,
  } as S3Settings;
};
