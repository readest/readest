import { join } from '@tauri-apps/api/path';
import { isContentURI, isFileURI, isValidURL } from './misc';

export const getFilename = (fileOrUri: string) => {
  if (isValidURL(fileOrUri) || isContentURI(fileOrUri) || isFileURI(fileOrUri)) {
    fileOrUri = decodeURI(fileOrUri);
  }
  const normalizedPath = fileOrUri.replace(/\\/g, '/');
  const parts = normalizedPath.split('/');
  const lastPart = parts.pop()!;
  return lastPart.split('?')[0]!;
};

export const getBaseFilename = (filename: string) => {
  const normalizedPath = filename.replace(/\\/g, '/');
  const name = normalizedPath.split('/').pop() || '';

  const parts = name.split('.');
  if (parts.length <= 1) {
    return name;
  }

  return parts.slice(0, -1).join('.');
};

export const getDirPath = (filePath: string) => {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const parts = normalizedPath.split('/');
  parts.pop();
  return parts.join('/');
};

/**
 * Group name a book imported from a folder belongs to: its directory made
 * relative to the *parent* of `basePath`, so the imported folder itself
 * becomes the top-level group ("Books") and every subfolder nests under it
 * ("Books/SciFi"). Books sitting loose in `basePath` get the folder's own
 * group. Backslashes are normalized, so Windows paths derive the same names.
 */
export const getFolderImportGroupName = (filePath: string, basePath: string) => {
  const rootPath = getDirPath(basePath);
  return getDirPath(filePath).replace(rootPath, '').replace(/^\//, '');
};

export const joinPaths = async (...paths: string[]) => {
  return await join(...paths);
};
