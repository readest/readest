import { describe, expect, it } from 'vitest';
import { parseFilenameMetadata } from '../../utils/path';

describe('parseFilenameMetadata', () => {
  it('extracts title from CJK title brackets without author', () => {
    expect(parseFilenameMetadata('《三体》.epub')).toEqual({ title: '三体' });
  });

  it('extracts CJK title and bare author', () => {
    expect(parseFilenameMetadata('《三体》刘慈欣.epub')).toEqual({
      title: '三体',
      author: '刘慈欣',
    });
  });

  it('extracts CJK title and bracketed author', () => {
    expect(parseFilenameMetadata('《三体》[刘慈欣].epub')).toEqual({
      title: '三体',
      author: '刘慈欣',
    });
    expect(parseFilenameMetadata('《三体》(刘慈欣).epub')).toEqual({
      title: '三体',
      author: '刘慈欣',
    });
    expect(parseFilenameMetadata('《三体》【刘慈欣】.epub')).toEqual({
      title: '三体',
      author: '刘慈欣',
    });
  });

  it('extracts author from leading bracket', () => {
    expect(parseFilenameMetadata('[刘慈欣] 三体.epub')).toEqual({
      title: '三体',
      author: '刘慈欣',
    });
    expect(parseFilenameMetadata('(J.K. Rowling) Harry Potter.epub')).toEqual({
      title: 'Harry Potter',
      author: 'J.K. Rowling',
    });
  });

  it('extracts author from trailing bracket', () => {
    expect(parseFilenameMetadata('Harry Potter [J.K. Rowling].epub')).toEqual({
      title: 'Harry Potter',
      author: 'J.K. Rowling',
    });
    expect(parseFilenameMetadata('三体(刘慈欣).epub')).toEqual({
      title: '三体',
      author: '刘慈欣',
    });
  });

  it('returns the base filename as title for plain names', () => {
    expect(parseFilenameMetadata('Harry Potter.epub')).toEqual({ title: 'Harry Potter' });
  });

  it('handles paths with directories', () => {
    expect(parseFilenameMetadata('/some/path/《三体》刘慈欣.epub')).toEqual({
      title: '三体',
      author: '刘慈欣',
    });
  });

  it('returns empty object for empty input', () => {
    expect(parseFilenameMetadata('')).toEqual({});
  });

  it('does not split on plain dash (ambiguous)', () => {
    // We avoid the ambiguous "Title - Author" vs "Author - Title" convention
    // and leave the entire base as the title so the user can decide.
    expect(parseFilenameMetadata('Harry Potter - J.K. Rowling.epub')).toEqual({
      title: 'Harry Potter - J.K. Rowling',
    });
  });

  it('ignores brackets that wrap the entire filename', () => {
    // Don't treat "[Anything]" as an author with empty title
    expect(parseFilenameMetadata('[Harry Potter].epub')).toEqual({
      title: 'Harry Potter',
    });
  });
});
