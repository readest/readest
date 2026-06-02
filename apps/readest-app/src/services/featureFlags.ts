export const LOCAL_ONLY_MODE =
  process.env['NEXT_PUBLIC_LOCAL_ONLY_MODE'] === 'true' ||
  process.env['NEXT_PUBLIC_APP_VARIANT'] === 'local';

export const isLocalOnlyMode = () => LOCAL_ONLY_MODE;

export const assertCloudFeatureEnabled = () => {
  if (LOCAL_ONLY_MODE) {
    throw new Error('Cloud features are disabled in Readest Local.');
  }
};
