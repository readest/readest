import { describe, it, expect } from 'vitest';
import { buildAnnotationUrl, parseWidgetGroupDeepLink } from '../../utils/deeplink';

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

describe('widget group deep link', () => {
  it('parses a group link into its axis and decoded group id', () => {
    expect(parseWidgetGroupDeepLink('readest://widget-group/series/a1b2%20c3')).toEqual({
      groupBy: 'series',
      groupId: 'a1b2 c3',
    });
    expect(parseWidgetGroupDeepLink('readest://widget-group/series')).toBeNull();
    // Malformed percent-encoding is rejected, not thrown.
    expect(parseWidgetGroupDeepLink('readest://widget-group/series/a%')).toBeNull();
  });

  it('only accepts the readest:// scheme, never the web host', () => {
    expect(parseWidgetGroupDeepLink('https://web.readest.com/o/widget-group/series/x')).toBeNull();
  });
});
