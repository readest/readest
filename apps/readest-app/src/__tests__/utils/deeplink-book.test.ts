import { describe, it, expect } from 'vitest';
import { parseBookDeepLink } from '@/utils/deeplink';

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
  it('does NOT match the annotation form', () => {
    expect(parseBookDeepLink('readest://book/abc123/annotation/n1')).toBeNull();
  });
  it('ignores unrelated urls', () => {
    expect(parseBookDeepLink('readest://share/tok')).toBeNull();
    expect(parseBookDeepLink('not a url')).toBeNull();
  });
});
