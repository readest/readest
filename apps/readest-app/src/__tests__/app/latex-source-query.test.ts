import { describe, expect, it } from 'vitest';

import {
  buildLatexSourceWindowUrl,
  parseLatexSourceWindowQuery,
} from '@/app/latex-source/sourceWindowQuery';

const request = {
  id: 'selection-1',
  bookKey: 'abc123-0',
  text: 'Selected theorem',
  page: 3,
  index: 2,
  cfi: 'epubcfi(/6/2!/4/2:1)',
  href: 'page-3',
};

describe('LaTeX source window query', () => {
  it('round-trips the first location request without relying on an event', () => {
    const url = buildLatexSourceWindowUrl(request, 'reader-2');
    const parsed = parseLatexSourceWindowQuery(url.split('?')[1]!);

    expect(parsed).toEqual({ request, readerWindowLabel: 'reader-2' });
  });

  it('rejects incomplete query state', () => {
    expect(parseLatexSourceWindowQuery('bookKey=abc123-0&page=3')).toBeNull();
  });
});
