import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import SearchResults from '@/app/reader/components/sidebar/SearchResults';
import type { BookSearchMatch } from '@/types/book';

const cjk = (length: number, seed: string) => seed.repeat(length).slice(0, length);

describe('SearchResults', () => {
  it('clips long leading context so the match stays within the clamped excerpt', () => {
    const results: BookSearchMatch[] = [
      {
        cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:3)',
        excerpt: {
          pre: `…${cjk(49, '前文内容很长的上下文字符串')}`,
          match: '黄仁勋',
          post: '从宿舍床上起身',
        },
      },
    ];

    render(<SearchResults bookKey='book-key' results={results} onSelectResult={() => {}} />);

    const match = screen.getByText('黄仁勋');
    expect(match.className).toContain('search-term-highlight');
    const pre = match.previousElementSibling!;
    // The stored excerpt keeps ~50 chars of context, but the sidebar row clamps
    // to three lines — the displayed lead-in must be short enough that the
    // match is always visible.
    expect(Array.from(pre.textContent ?? '').length).toBeLessThanOrEqual(21);
    expect(pre.textContent!.startsWith('…')).toBe(true);
  });
});
