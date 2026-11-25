import { TOCItem } from '@/libs/document';
import { findParentPath } from '@/services/nav';

export interface CitationParts {
  author: string;
  title: string;
  year?: string;
  // The TOC entries the passage is in, from the chapter down.
  chapters: string[];
  page?: string;
}

// The line Copy with Citation puts after the passage (#7926):
// "— Author, Title (Year), Chapter › Section, p. 12".
export const formatCitation = ({ author, title, year, chapters, page }: CitationParts) => {
  const source = year ? `${title} (${year})` : title;
  return `— ${[author, source, chapters.join(' › '), page].filter(Boolean).join(', ')}`;
};

// Only a plausible year: calibre writes 0101-01-01 for a book with no date.
export const getPublishedYear = (published?: string) => published?.match(/\b[12]\d{3}\b/)?.[0];

// The labels from the chapter down to the TOC entry at `href`.
export const getTocPathLabels = (toc: TOCItem[], href: string) =>
  findParentPath(toc, href)
    .map(({ label }) => label.trim())
    .filter(Boolean);
