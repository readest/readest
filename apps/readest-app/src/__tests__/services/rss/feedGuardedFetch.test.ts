import { describe, expect, it } from 'vitest';
import { assertFetchAllowed } from '@/services/rss/feedGuardedFetch';

describe('assertFetchAllowed', () => {
  it('allows public https/http hosts', () => {
    expect(() => assertFetchAllowed('https://feeds.feedburner.com/ruanyifeng')).not.toThrow();
    expect(() => assertFetchAllowed('http://www.ruanyifeng.com/blog/x.html')).not.toThrow();
  });
  it('blocks private/loopback/non-http', () => {
    expect(() => assertFetchAllowed('http://127.0.0.1/x')).toThrow();
    expect(() => assertFetchAllowed('http://192.168.1.1/admin')).toThrow();
    expect(() => assertFetchAllowed('file:///etc/passwd')).toThrow();
  });
});
