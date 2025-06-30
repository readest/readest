import packageJson from '../../package.json';

export const getAppVersion = () => {
  return packageJson.version;
};
