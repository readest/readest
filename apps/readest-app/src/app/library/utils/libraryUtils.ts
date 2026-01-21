import { Book } from '@/types/book';
import { formatAuthors, formatTitle } from '@/utils/book';

export const createBookFilter = (queryTerm: string | null) => (item: Book) => {
  if (!queryTerm) return true;
  if (item.deletedAt) return false;
  let searchTerm: RegExp;
  try {
    searchTerm = new RegExp(queryTerm, 'i');
  } catch {
    const lowerQuery = queryTerm.toLowerCase();
    const title = formatTitle(item.title).toLowerCase();
    const authors = formatAuthors(item.author).toLowerCase();

    return (
      title.includes(lowerQuery) ||
      authors.includes(lowerQuery) ||
      item.format.toLowerCase().includes(lowerQuery) ||
      (item.groupName && item.groupName.toLowerCase().includes(lowerQuery)) ||
      (item.metadata?.description && item.metadata.description.toLowerCase().includes(lowerQuery))
    );
  }
  const title = formatTitle(item.title);
  const authors = formatAuthors(item.author);
  return (
    searchTerm.test(title) ||
    searchTerm.test(authors) ||
    searchTerm.test(item.format) ||
    (item.groupName && searchTerm.test(item.groupName)) ||
    (item.metadata?.description && searchTerm.test(item.metadata?.description))
  );
};

export const createBookSorter = (sortBy: string, uiLanguage: string) => (a: Book, b: Book) => {
  switch (sortBy) {
    case 'title':
      const aTitle = formatTitle(a.title);
      const bTitle = formatTitle(b.title);
      return aTitle.localeCompare(bTitle, uiLanguage || navigator.language);
    case 'author':
      const aAuthors = formatAuthors(a.author, a?.primaryLanguage || 'en', true);
      const bAuthors = formatAuthors(b.author, b?.primaryLanguage || 'en', true);
      return aAuthors.localeCompare(bAuthors, uiLanguage || navigator.language);
    case 'updated':
      return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
    case 'created':
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    case 'format':
      return a.format.localeCompare(b.format, uiLanguage || navigator.language);
    case 'published':
      const aPublished = a.metadata?.published || '0001-01-01';
      const bPublished = b.metadata?.published || '0001-01-01';

      // Handle cases where published date might not exist
      if (!aPublished && !bPublished) return 0;
      if (!aPublished) return 1; // Books without published date go to the end
      if (!bPublished) return -1;

      // Try to parse dates - handle various date formats
      const aDate = new Date(aPublished).getTime();
      const bDate = new Date(bPublished).getTime();

      // If dates are invalid (NaN), fall back to string comparison
      if (isNaN(aDate) && isNaN(bDate)) {
        return aPublished.localeCompare(bPublished, uiLanguage || navigator.language);
      }
      if (isNaN(aDate)) return 1;
      if (isNaN(bDate)) return -1;

      return aDate - bDate;
    default:
      return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
  }
};

export const getBreadcrumbs = (currentPath: string) => {
  if (!currentPath) return [];
  const segments = currentPath.split('/');
  return segments.map((segment, index) => ({
    name: segment,
    path: segments.slice(0, index + 1).join('/'),
  }));
};
