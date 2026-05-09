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

// Pull title/author hints from common filename conventions used when
// importing books that have no embedded metadata. Only patterns whose
// title/author roles are unambiguous are recognized; ambiguous shapes
// like "A - B" are left as a single title for the user to edit.
export const parseFilenameMetadata = (filename: string): { title?: string; author?: string } => {
  const base = getBaseFilename(filename).trim();
  if (!base) return {};

  // 1. CJK title brackets, optionally followed by an author (bare or bracketed):
  //    《Title》, 《Title》Author, 《Title》[Author], 《Title》(Author), 《Title》【Author】
  const cjkMatch = base.match(
    /^《([^》]+)》\s*(?:[[(（【]\s*([^\])）】]+?)\s*[\])）】]|([^[(（【].*?))?\s*$/u,
  );
  if (cjkMatch) {
    const title = cjkMatch[1]!.trim();
    const author = (cjkMatch[2] ?? cjkMatch[3] ?? '').trim();
    if (title) return author ? { title, author } : { title };
  }

  // 2. Bracketed author at the start: "[Author] Title", "(Author) Title"
  const bracketStart = base.match(/^[[(（【]([^\])）】]+)[\])）】]\s*(.+)$/u);
  if (bracketStart) {
    const author = bracketStart[1]!.trim();
    const title = bracketStart[2]!.trim();
    if (title && author) return { title, author };
  }

  // 3. Bracketed author at the end: "Title [Author]", "Title (Author)"
  const bracketEnd = base.match(/^(.+?)\s*[[(（【]([^\])）】]+)[\])）】]\s*$/u);
  if (bracketEnd) {
    const title = bracketEnd[1]!.trim();
    const author = bracketEnd[2]!.trim();
    if (title && author) return { title, author };
  }

  // 4. Whole-filename brackets with no surrounding text: "[Title]" → Title
  const wholeBracket = base.match(/^[[(（【]([^\])）】]+)[\])）】]$/u);
  if (wholeBracket) {
    const title = wholeBracket[1]!.trim();
    if (title) return { title };
  }

  return { title: base };
};

export const getDirPath = (filePath: string) => {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const parts = normalizedPath.split('/');
  parts.pop();
  return parts.join('/');
};

export const joinPaths = async (...paths: string[]) => {
  return await join(...paths);
};
