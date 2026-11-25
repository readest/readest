// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildBookAppLink, parseBookDeepLink } from '@/utils/deeplink';

describe('parseBookDeepLink', () => {
  it('parses the custom-scheme book-open form', () => {
    expect(parseBookDeepLink('readest://book/abc123')).toEqual({ bookHash: 'abc123' });
  });
  it('parses the web form', () => {
    expect(parseBookDeepLink('https://web.readest.com/o/book/abc123')).toEqual({
      bookHash: 'abc123',
    });
  });
  it('surfaces the Android Auto autoplay flag', () => {
    expect(parseBookDeepLink('readest://book/abc123?autoplay=tts')).toEqual({
      bookHash: 'abc123',
      autoplay: true,
    });
  });
  it('omits autoplay when absent or not tts', () => {
    expect(parseBookDeepLink('readest://book/abc123?autoplay=foo')).toEqual({ bookHash: 'abc123' });
    expect(parseBookDeepLink('readest://book/abc123')).toEqual({ bookHash: 'abc123' });
  });
  it('opens at the cfi a link carries, as an Anki card links back to a sentence', () => {
    const cfi = 'epubcfi(/6/4!/4/2,/1:0,/1:5)';
    const link = buildBookAppLink('abc123', cfi);
    expect(link).toBe('readest://book/abc123?cfi=epubcfi(%2F6%2F4!%2F4%2F2%2C%2F1%3A0%2C%2F1%3A5)');
    expect(parseBookDeepLink(link)).toEqual({ bookHash: 'abc123', cfi });
    expect(buildBookAppLink('abc123')).toBe('readest://book/abc123');
  });
  it('does NOT match the annotation form', () => {
    expect(parseBookDeepLink('readest://book/abc123/annotation/n1')).toBeNull();
  });
  it('ignores unrelated urls', () => {
    expect(parseBookDeepLink('readest://share/tok')).toBeNull();
    expect(parseBookDeepLink('not a url')).toBeNull();
  });
});
