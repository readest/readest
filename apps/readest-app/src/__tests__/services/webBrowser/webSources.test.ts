import { describe, it, expect } from 'vitest';
import {
  addWebSource,
  normalizeWebSourceUrl,
  removeWebSource,
  webSourceNameFromUrl,
} from '@/services/webBrowser/webSources';

describe('normalizeWebSourceUrl', () => {
  it('accepts http(s) and prefixes https when the scheme is missing', () => {
    expect(normalizeWebSourceUrl('https://calibre.example.com/')).toBe(
      'https://calibre.example.com/',
    );
    expect(normalizeWebSourceUrl('  calibre.example.com/opds ')).toBe(
      'https://calibre.example.com/opds',
    );
    expect(normalizeWebSourceUrl('http://192.168.1.10:8083')).toBe('http://192.168.1.10:8083/');
  });

  it('rejects empty, non-http and malformed input', () => {
    expect(normalizeWebSourceUrl('')).toBeNull();
    expect(normalizeWebSourceUrl('ftp://x')).toBeNull();
    expect(normalizeWebSourceUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeWebSourceUrl('http://')).toBeNull();
  });
});

describe('webSourceNameFromUrl', () => {
  it('uses the host', () => {
    expect(webSourceNameFromUrl('https://calibre.example.com/opds')).toBe('calibre.example.com');
    expect(webSourceNameFromUrl('nonsense')).toBe('nonsense');
  });
});

describe('addWebSource / removeWebSource', () => {
  it('appends a source with a generated id and a default name', () => {
    const list = addWebSource([], '', 'https://calibre.example.com/');
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBeTruthy();
    expect(list[0]!.name).toBe('calibre.example.com');
    expect(list[0]!.url).toBe('https://calibre.example.com/');
  });

  it('replaces an existing entry with the same url instead of duplicating', () => {
    const first = addWebSource([], 'Old', 'https://calibre.example.com/');
    const second = addWebSource(first, 'New', 'https://calibre.example.com/');
    expect(second).toHaveLength(1);
    expect(second[0]!.name).toBe('New');
    expect(second[0]!.id).toBe(first[0]!.id);
  });

  it('removes by id and leaves other entries untouched', () => {
    const list = addWebSource(
      addWebSource([], 'A', 'https://a.example/'),
      'B',
      'https://b.example/',
    );
    const next = removeWebSource(list, list[0]!.id);
    expect(next.map((s) => s.name)).toEqual(['B']);
  });
});
