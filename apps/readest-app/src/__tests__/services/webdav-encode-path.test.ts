import { describe, test, expect } from 'vitest';
import { buildRequestUrl } from '@/services/webdav/WebDAVClient';

describe('buildRequestUrl (encodePath)', () => {
  test('escapes spaces and unicode in each segment', () => {
    expect(buildRequestUrl('https://dav.example.com', '/Readest/My Books/小说.epub')).toBe(
      'https://dav.example.com/Readest/My%20Books/%E5%B0%8F%E8%AF%B4.epub',
    );
  });

  test("preserves existing %-escapes — the comment's promise that we don't double-encode", () => {
    // Caller pre-encoded the literal space; encodePath used to turn the
    // %20 into %2520, silently breaking the request URL for any path
    // that came in already escaped.
    expect(buildRequestUrl('https://dav.example.com', '/Readest/My%20Books/file.epub')).toBe(
      'https://dav.example.com/Readest/My%20Books/file.epub',
    );
  });

  test('mixes raw and pre-escaped characters in the same segment', () => {
    // `a b%20c d` → the `b%20c` triplet survives, the bare spaces around
    // it get escaped, and the segment as a whole stays roundtrip-clean.
    expect(buildRequestUrl('https://dav.example.com', '/dir/a b%20c d/file')).toBe(
      'https://dav.example.com/dir/a%20b%20c%20d/file',
    );
  });

  test('keeps the path separator unchanged and trims server trailing slash', () => {
    expect(buildRequestUrl('https://dav.example.com/', '/a/b/c.txt')).toBe(
      'https://dav.example.com/a/b/c.txt',
    );
  });
});
