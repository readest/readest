// Regression test for readest/readest issue #4594.
//
// In fulltext search, a match that falls inside inline-styled text (e.g. a word
// wrapped in <i>/<em>/<b>) lands in its own text node. `textWalker` maps each
// text node to one entry of the `strs` array, so such a word becomes a
// standalone entry with no surrounding text inside it. The excerpt builder used
// to read the surrounding context only from *within* the start/end node
// (`start.slice(0, startOffset)` / `end.slice(endOffset)`), which is empty for
// these standalone nodes — so the search result showed only the word with no
// context. Context must be gathered across neighbouring text nodes instead.
import { describe, expect, it } from 'vitest';

import { search } from 'foliate-js/search.js';

// Forces the deterministic substring path (simpleSearch): default granularity is
// 'grapheme', and 'variant' sensitivity routes search() to simpleSearch.
const SUBSTRING_OPTS = { sensitivity: 'variant' as const };

const first = (strs: string[], query: string, opts: Record<string, unknown> = {}) => {
  const results = [...search(strs, query, opts)] as Array<{
    excerpt: { pre: string; match: string; post: string };
  }>;
  expect(results.length).toBeGreaterThan(0);
  return results[0]!.excerpt;
};

describe('foliate-js search excerpt context (#4594)', () => {
  it('shows surrounding context when the match is in its own (styled) text node', () => {
    // `<p>The quick <i>brown</i> fox jumps over the lazy dog.</p>`
    const styled = ['The quick ', 'brown', ' fox jumps over the lazy dog.'];

    const excerpt = first(styled, 'brown', SUBSTRING_OPTS);

    expect(excerpt.match).toBe('brown');
    expect(excerpt.pre).toContain('The quick');
    expect(excerpt.post).toContain('fox jumps over the lazy dog');
  });

  it('produces the same excerpt whether or not the word is wrapped in a tag', () => {
    const plain = ['The quick brown fox jumps over the lazy dog.'];
    const styled = ['The quick ', 'brown', ' fox jumps over the lazy dog.'];

    expect(first(styled, 'brown', SUBSTRING_OPTS)).toEqual(first(plain, 'brown', SUBSTRING_OPTS));
  });

  it('also gathers context on the default (segmenter) search path', () => {
    const styled = ['The quick ', 'brown', ' fox jumps over the lazy dog.'];

    const excerpt = first(styled, 'brown');

    expect(excerpt.match).toBe('brown');
    expect(excerpt.pre).toContain('The quick');
    expect(excerpt.post).toContain('fox jumps');
  });

  it('keeps the full match text when a phrase spans a styling boundary', () => {
    // Searching across the <i> boundary: "quick brown fox" spans three nodes.
    const styled = ['The quick ', 'brown', ' fox jumps over the lazy dog.'];

    const excerpt = first(styled, 'quick brown fox', SUBSTRING_OPTS);

    expect(excerpt.match).toBe('quick brown fox');
  });
});
