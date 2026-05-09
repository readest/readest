import { describe, it, expect } from 'vitest';

import { createWebSearchProvider } from '@/services/dictionaries/providers/webSearchProvider';
import {
  BUILTIN_WEB_SEARCHES,
  getBuiltinWebSearch,
  isValidUrlTemplate,
  substituteUrlTemplate,
} from '@/services/dictionaries/webSearchTemplates';
import type { WebSearchEntry } from '@/services/dictionaries/types';

describe('substituteUrlTemplate', () => {
  it('replaces %WORD% (case-insensitive) with the URL-encoded word', () => {
    expect(substituteUrlTemplate('https://x.com/?q=%WORD%', 'hello')).toBe(
      'https://x.com/?q=hello',
    );
    expect(substituteUrlTemplate('https://x.com/?q=%word%', 'hello')).toBe(
      'https://x.com/?q=hello',
    );
  });

  it('URL-encodes spaces and special characters', () => {
    expect(substituteUrlTemplate('https://x.com/?q=%WORD%', 'hello world')).toBe(
      'https://x.com/?q=hello%20world',
    );
    expect(substituteUrlTemplate('https://x.com/?q=%WORD%', 'a&b?c')).toBe(
      'https://x.com/?q=a%26b%3Fc',
    );
  });

  it('handles double-encoded %25WORD%25', () => {
    expect(substituteUrlTemplate('https://x.com/?q=%25WORD%25', 'hi')).toBe('https://x.com/?q=hi');
  });

  it('replaces every occurrence', () => {
    expect(substituteUrlTemplate('a/%WORD%/b/%WORD%', 'X')).toBe('a/X/b/X');
  });
});

describe('isValidUrlTemplate', () => {
  it('requires http(s):// + a placeholder', () => {
    expect(isValidUrlTemplate('https://x.com/?q=%WORD%')).toBe(true);
    expect(isValidUrlTemplate('  http://x.com/?q=%WORD%  ')).toBe(true);
    expect(isValidUrlTemplate('https://x.com/?q=%25WORD%25')).toBe(true);
  });

  it('rejects missing scheme or placeholder', () => {
    expect(isValidUrlTemplate('https://x.com/?q=hi')).toBe(false);
    expect(isValidUrlTemplate('//x.com/?q=%WORD%')).toBe(false);
    expect(isValidUrlTemplate('ftp://x.com/?q=%WORD%')).toBe(false);
    expect(isValidUrlTemplate('')).toBe(false);
  });
});

describe('getBuiltinWebSearch', () => {
  it('returns each of the three built-ins by id', () => {
    for (const tpl of BUILTIN_WEB_SEARCHES) {
      const found = getBuiltinWebSearch(tpl.id);
      expect(found).toBeDefined();
      expect(found?.urlTemplate).toContain('%WORD%');
    }
  });

  it('returns undefined for unknown ids', () => {
    expect(getBuiltinWebSearch('web:builtin:nope')).toBeUndefined();
    expect(getBuiltinWebSearch('web:custom:abc')).toBeUndefined();
  });
});

describe('webSearchProvider', () => {
  const customEntry: WebSearchEntry = {
    id: 'web:abc123',
    name: 'Custom Site',
    urlTemplate: 'https://example.com/?q=%WORD%',
  };

  it('renders headword + sub-label + open button + URL preview', async () => {
    const provider = createWebSearchProvider({ template: customEntry });
    const container = document.createElement('div');
    const outcome = await provider.lookup('hello world', {
      signal: new AbortController().signal,
      container,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.headword).toBe('hello world');
      expect(outcome.sourceLabel).toBe('Custom Site');
    }
    expect(container.querySelector('h1')?.textContent).toBe('hello world');
    const link = container.querySelector('a');
    expect(link).toBeTruthy();
    expect(link?.getAttribute('href')).toBe('https://example.com/?q=hello%20world');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    // URL preview rendered for transparency.
    expect(container.textContent).toContain('https://example.com/?q=hello%20world');
  });

  it('returns empty for a blank word', async () => {
    const provider = createWebSearchProvider({ template: customEntry });
    const outcome = await provider.lookup('   ', {
      signal: new AbortController().signal,
      container: document.createElement('div'),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('empty');
  });

  it('respects abort signals', async () => {
    const provider = createWebSearchProvider({ template: customEntry });
    const ac = new AbortController();
    ac.abort();
    const outcome = await provider.lookup('hello', {
      signal: ac.signal,
      container: document.createElement('div'),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('error');
  });

  it('uses a label override when provided', () => {
    const provider = createWebSearchProvider({
      template: customEntry,
      label: 'Override',
    });
    expect(provider.label).toBe('Override');
    expect(provider.kind).toBe('web');
  });

  it('opens each built-in URL with the headword substituted', async () => {
    for (const tpl of BUILTIN_WEB_SEARCHES) {
      const provider = createWebSearchProvider({ template: tpl });
      const container = document.createElement('div');
      await provider.lookup('hello', {
        signal: new AbortController().signal,
        container,
      });
      const link = container.querySelector('a');
      expect(link).toBeTruthy();
      const href = link?.getAttribute('href') ?? '';
      expect(href).toContain('hello');
      expect(href.startsWith('https://')).toBe(true);
      expect(href).not.toContain('%WORD%');
    }
  });
});
