// @vitest-environment node
// Calibre-like fielded search in the library search box (readest#7370): the
// reporter asked for "subject:subjectname and author:authorname".
import { describe, expect, it } from 'vitest';

import { createBookFilter } from '@/app/library/utils/libraryUtils';
import { Book } from '@/types/book';
import { BookMetadata } from '@/libs/document';

const makeBook = (
  hash: string,
  fields: Partial<Omit<Book, 'metadata'>>,
  metadata: Partial<BookMetadata> = {},
): Book => ({
  hash,
  format: 'EPUB',
  title: hash,
  author: '',
  createdAt: 0,
  updatedAt: 0,
  ...fields,
  metadata: { title: fields.title ?? hash, author: '', language: 'en', ...metadata },
});

const library: Book[] = [
  makeBook(
    'dune',
    { title: 'Dune', author: 'Frank Herbert', tags: ['Favorite'] },
    {
      subject: ['Science Fiction', 'Classics'],
      series: 'Dune',
      seriesIndex: 1,
      publisher: 'Ace',
      isbn: '9780441013593',
      calibreColumns: [{ label: 'genre', name: 'Genre', datatype: 'text', value: ['Space Opera'] }],
    },
  ),
  makeBook(
    'messiah',
    { title: 'Dune Messiah', author: 'Frank Herbert' },
    { subject: ['Science Fiction'], series: 'Dune', seriesIndex: 2, publisher: 'Putnam' },
  ),
  makeBook(
    'hobbit',
    { title: 'The Hobbit', author: 'J. R. R. Tolkien', format: 'PDF', groupName: 'Childhood' },
    { subject: 'Fantasy', series: 'Middle-earth', publisher: 'Allen & Unwin' },
  ),
  makeBook(
    'threebody',
    { title: 'The Three-Body Problem', author: '刘慈欣' },
    { subject: ['Science Fiction'], language: 'zh', description: '<p>First contact.</p>' },
  ),
  makeBook('rezero', { title: 'Re:Zero', author: 'Tappei Nagatsuki' }),
  makeBook('langbio', { title: 'Language: A Biography', author: 'Ann Writer' }),
];

const search = (query: string): string[] =>
  library.filter(createBookFilter(query)).map((book) => book.hash);

describe('createBookFilter fielded search (#7370)', () => {
  it('matches one field by substring, ignoring case', () => {
    expect(search('author:herbert')).toEqual(['dune', 'messiah']);
    expect(search('Author:HERBERT')).toEqual(['dune', 'messiah']);
    expect(search('title:hobbit')).toEqual(['hobbit']);
  });

  it('runs the query from the issue: subject and author', () => {
    expect(search('subject:"science fiction" and author:herbert')).toEqual(['dune', 'messiah']);
    expect(search('subject:"science fiction" author:herbert')).toEqual(['dune', 'messiah']);
  });

  it('combines terms with or, not and parentheses', () => {
    expect(search('author:tolkien or author:刘慈欣')).toEqual(['hobbit', 'threebody']);
    expect(search('author:herbert and not title:messiah')).toEqual(['dune']);
    expect(search('(author:tolkien or language:zh) and subject:"science fiction"')).toEqual([
      'threebody',
    ]);
  });

  it('matches a whole value with = and a regular expression with ~', () => {
    expect(search('title:=dune')).toEqual(['dune']);
    expect(search('title:"=Dune"')).toEqual(['dune']);
    expect(search('author:"=j. r. r. tolkien"')).toEqual(['hobbit']);
    expect(search('title:~^the')).toEqual(['hobbit', 'threebody']);
    expect(search('series:"~^dune$"')).toEqual(['dune', 'messiah']);
  });

  it('reads tags, subjects, series, publisher, language, format, group, isbn and description', () => {
    expect(search('tags:favorite')).toEqual(['dune']);
    expect(search('tag:fantasy')).toEqual(['hobbit']); // calibre tags arrive as subjects
    expect(search('subject:classics')).toEqual(['dune']);
    expect(search('series:middle')).toEqual(['hobbit']);
    expect(search('publisher:unwin')).toEqual(['hobbit']);
    expect(search('language:zh')).toEqual(['threebody']);
    expect(search('language:中文')).toEqual(['threebody']);
    expect(search('format:pdf')).toEqual(['hobbit']);
    expect(search('group:childhood')).toEqual(['hobbit']);
    expect(search('isbn:9780441013593')).toEqual(['dune']);
    expect(search('description:contact')).toEqual(['threebody']);
  });

  it('reads calibre custom columns by #label', () => {
    expect(search('#genre:"space opera"')).toEqual(['dune']);
    expect(search('#genre:fantasy')).toEqual([]);
    expect(search('#missing:opera')).toEqual([]);
  });

  it('matches bare words next to fields against every field', () => {
    expect(search('author:herbert messiah')).toEqual(['messiah']);
    expect(search('"dune messiah" or title:hobbit')).toEqual(['messiah', 'hobbit']);
  });

  it('tolerates a dangling operator or an unclosed parenthesis', () => {
    expect(search('author:herbert and')).toEqual(['dune', 'messiah']);
    expect(search('(author:herbert or author:tolkien')).toEqual(['dune', 'messiah', 'hobbit']);
    expect(search('author:herbert)')).toEqual(['dune', 'messiah']);
  });

  it('never returns a deleted book', () => {
    const deleted = makeBook('gone', { title: 'Gone', author: 'Frank Herbert', deletedAt: 1 });
    expect(createBookFilter('author:herbert')(deleted)).toBe(false);
  });

  it('keeps the plain search for queries without a known field', () => {
    expect(search('^Dune')).toEqual(['dune', 'messiah']); // a regular expression, as before
    expect(search('re:zero')).toEqual(['rezero']); // "re" is not a field
    expect(search('dune messiah')).toEqual(['messiah']); // a phrase, not two words
    expect(search('language: a biography')).toEqual(['langbio']); // no value after the colon
  });
});
