import { describe, it, expect } from 'vitest';
import { isSafeObjectKeyName } from '@/utils/object';

// GHSA-mfmj-2frf-vhgw: the storage object key is built as `${user.id}/${fileName}`
// from a client-controlled `fileName`. The R2 signer interpolates it into
// `new Request(url)`, whose URL parser collapses `../` before signing — so a
// crafted name escapes the caller's `${user.id}/` prefix into another tenant's
// namespace. fileName legitimately contains '/' (Readest/Books/..., Replicas),
// so we reject traversal/absolute/backslash forms rather than separators.
describe('isSafeObjectKeyName', () => {
  it('accepts the legitimate book / replica / cover key shapes', () => {
    expect(isSafeObjectKeyName('Readest/Books/abc123.epub')).toBe(true);
    expect(isSafeObjectKeyName('Readest/Replicas/dict/id-1/data.bin')).toBe(true);
    expect(isSafeObjectKeyName('cover.png')).toBe(true);
    expect(isSafeObjectKeyName('My Book (2024).epub')).toBe(true);
    expect(isSafeObjectKeyName('A&B.epub')).toBe(true);
  });

  it('rejects parent-directory traversal segments', () => {
    expect(isSafeObjectKeyName('../victim/Readest/Book/h/book.epub')).toBe(false);
    expect(isSafeObjectKeyName('Readest/../../victim/book.epub')).toBe(false);
    expect(isSafeObjectKeyName('..')).toBe(false);
    expect(isSafeObjectKeyName('a/../b')).toBe(false);
  });

  it('rejects percent-encoded traversal', () => {
    expect(isSafeObjectKeyName('%2e%2e/victim/book.epub')).toBe(false);
    expect(isSafeObjectKeyName('a/%2e%2e/b')).toBe(false);
  });

  it('rejects absolute paths, backslashes, NUL and empty segments', () => {
    expect(isSafeObjectKeyName('/etc/passwd')).toBe(false);
    expect(isSafeObjectKeyName('a\\b')).toBe(false);
    expect(isSafeObjectKeyName('a\0b')).toBe(false);
    expect(isSafeObjectKeyName('a//b')).toBe(false);
    expect(isSafeObjectKeyName('a/')).toBe(false);
  });

  it('rejects empty / non-string input', () => {
    expect(isSafeObjectKeyName('')).toBe(false);
    // @ts-expect-error runtime guard for untrusted req.body values
    expect(isSafeObjectKeyName(undefined)).toBe(false);
    // @ts-expect-error runtime guard for untrusted req.body values
    expect(isSafeObjectKeyName(123)).toBe(false);
  });
});
