import { describe, expect, it } from 'vitest';
import type { Book } from '@/types/book';
import { mergeUnifiedSourceVariants } from '@/app/library/utils/libraryUtils';
import { findUnifiedSourceVariants } from '@/services/foundation/localReadingMode';

const sourceBook = (hash: string, format: Book['format']): Book => ({
  hash,
  format,
  title: '三种格式的同一篇文章',
  author: '',
  createdAt: 1,
  updatedAt: 1,
});

describe('unified source variants', () => {
  it('presents matching TXT, HTML, and EPUB sources as one library item', () => {
    const books = [
      sourceBook('txt', 'TXT'),
      sourceBook('html', 'HTML'),
      sourceBook('epub', 'EPUB'),
    ];
    const merged = mergeUnifiedSourceVariants(books);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.sourceVariants).toEqual([
      { hash: 'epub', format: 'EPUB' },
      { hash: 'html', format: 'HTML' },
      { hash: 'txt', format: 'TXT' },
    ]);
    expect(findUnifiedSourceVariants(books, books[0]!)).toEqual(
      books.slice().sort((left, right) => left.format.localeCompare(right.format)),
    );
  });

  it('does not merge unrelated books that only share a title', () => {
    const first = { ...sourceBook('first', 'TXT'), author: '作者甲' };
    const second = { ...sourceBook('second', 'HTML'), author: '作者乙' };

    expect(mergeUnifiedSourceVariants([first, second])).toHaveLength(2);
  });

  it('matches the same source filename stem even when per-format metadata hashes differ', () => {
    const txt = {
      ...sourceBook('txt', 'TXT'),
      sourceTitle: '10-same-content.txt',
      metaHash: 'txt-metadata',
    };
    const epub = {
      ...sourceBook('epub', 'EPUB'),
      sourceTitle: '10-same-content.epub',
      metaHash: 'epub-metadata',
    };

    expect(findUnifiedSourceVariants([txt, epub], txt)).toHaveLength(2);
  });

  it('keeps a paired PDF in the same unified workspace family', () => {
    const pdf = { ...sourceBook('pdf', 'PDF'), sourceTitle: 'compactness.pdf' };
    const md = { ...sourceBook('md', 'MD'), sourceTitle: 'compactness.md' };

    expect(findUnifiedSourceVariants([pdf, md], pdf)).toEqual([md, pdf]);
  });
});
