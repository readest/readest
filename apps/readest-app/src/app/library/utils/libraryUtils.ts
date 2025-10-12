import { Book } from '@/types/book';
import { formatAuthors, formatTitle } from '@/utils/book';

export const createBookFilter = (queryTerm: string | null) => (item: Book) => {
  if (!queryTerm) return true;
  if (item.deletedAt) return false;
  const searchTerm = new RegExp(queryTerm, 'i');
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
    default:
      return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
  }
};
