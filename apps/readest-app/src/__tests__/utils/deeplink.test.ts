import { describe, it, expect } from 'vitest';
import { buildAnnotationUrl, parseAnnotationDeepLink } from '../../utils/deeplink';

describe('buildAnnotationUrl', () => {
  const link = { bookHash: 'abc', noteId: 'n1', cfi: '/6/4!/4/2' };

  it('builds the custom-scheme app URL when linkType is "app"', () => {
    const url = buildAnnotationUrl(link, 'app');
    expect(url.startsWith('readest://book/abc/annotation/n1')).toBe(true);
  });

  it('builds the HTTPS web URL when linkType is "web"', () => {
    const url = buildAnnotationUrl(link, 'web');
    expect(url.startsWith('https://')).toBe(true);
    expect(url).toContain('/o/book/abc/annotation/n1');
  });

  it('preserves the cfi query for both link types', () => {
    const encoded = encodeURIComponent(link.cfi);
    expect(buildAnnotationUrl(link, 'app')).toContain(`cfi=${encoded}`);
    expect(buildAnnotationUrl(link, 'web')).toContain(`cfi=${encoded}`);
  });

  it('omits the cfi query when no cfi is provided', () => {
    const url = buildAnnotationUrl({ bookHash: 'abc', noteId: 'n1' }, 'app');
    expect(url).toBe('readest://book/abc/annotation/n1');
  });
});

describe('parseAnnotationDeepLink', () => {
  it('parses custom-scheme annotation URL', () => {
    const parsed = parseAnnotationDeepLink('readest://book/abc/annotation/n1?cfi=%2F6%2F4');
    expect(parsed).toEqual({
      bookHash: 'abc',
      noteId: 'n1',
      cfi: '/6/4',
    });
  });

  it('parses biblophile.com/yomi web annotation URL', () => {
    const parsed = parseAnnotationDeepLink(
      'https://biblophile.com/yomi/o/book/abc/annotation/n1?cfi=%2F6%2F4',
    );
    expect(parsed).toEqual({
      bookHash: 'abc',
      noteId: 'n1',
      cfi: '/6/4',
    });
  });

  it('parses web.readest.com legacy web annotation URL', () => {
    const parsed = parseAnnotationDeepLink('https://web.readest.com/o/book/abc/annotation/n1');
    expect(parsed).toEqual({
      bookHash: 'abc',
      noteId: 'n1',
      cfi: undefined,
    });
  });
});
