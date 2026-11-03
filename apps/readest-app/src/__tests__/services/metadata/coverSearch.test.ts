import { describe, expect, it } from 'vitest';
import {
  BUILTIN_COVER_SEARCH_ENGINES,
  getCoverSearchUrl,
  isValidCoverSearchTemplate,
} from '@/services/metadata/coverSearch';

describe('cover image search engines', () => {
  it('ships Google, Bing and DuckDuckGo image searches with the whole query encoded', () => {
    expect(BUILTIN_COVER_SEARCH_ENGINES.map((engine) => engine.name)).toEqual([
      'Google',
      'Bing',
      'DuckDuckGo',
    ]);
    for (const engine of BUILTIN_COVER_SEARCH_ENGINES) {
      const url = new URL(getCoverSearchUrl(engine, '雪 & Sea #1'));
      expect(url.searchParams.get('q')).toBe('雪 & Sea #1');
      expect(url.hash).toBe('');
      expect(
        url.pathname === '/images/search' ||
          url.searchParams.get('udm') === '2' ||
          (url.searchParams.get('ia') === 'images' && url.searchParams.get('iax') === 'images'),
      ).toBe(true);
    }
  });

  it('supports custom engines and repeated or escaped query placeholders', () => {
    expect(
      getCoverSearchUrl(
        {
          id: 'custom',
          name: 'Custom',
          urlTemplate: 'https://example.com/images?q=%WORD%&again=%25WORD%25',
        },
        'A&B',
      ),
    ).toBe('https://example.com/images?q=A%26B&again=A%26B');
  });

  it.each([
    'https://example.com/images?q=%WORD%',
    'http://localhost:8080/search/%word%',
    'https://example.com/?q=%25WORD%25',
  ])('accepts image-search URL template %s', (template) => {
    expect(isValidCoverSearchTemplate(template)).toBe(true);
  });

  it.each([
    'https://example.com/images',
    'https:///?q=%WORD%',
    'javascript:alert("%WORD%")',
    'file:///tmp/%WORD%',
    'https://user:password@example.com/?q=%WORD%',
  ])('rejects invalid or unsafe URL template %s', (template) => {
    expect(isValidCoverSearchTemplate(template)).toBe(false);
  });
});
