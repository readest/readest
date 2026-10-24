/**
 * A book file is stored at `{userId}/Readest/Books/{hash}/{name}.{ext}`, but
 * `{name}` depends on the uploader: the app uses the book title on R2, while
 * the calibre plugin and the koplugin use the hash. The storage APIs resolve a
 * key they can't find by its book hash and extension instead.
 */
export const parseBookFileKey = (
  fileKey: string,
): { bookHash: string; fileExtension: string } | null => {
  if (!fileKey.includes('Readest/Book')) return null;
  const parts = fileKey.split('/');
  if (parts.length !== 5) return null;
  return { bookHash: parts[3]!, fileExtension: parts[4]!.split('.').pop() || '' };
};
