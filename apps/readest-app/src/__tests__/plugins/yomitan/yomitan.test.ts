import { describe, expect, test } from 'vitest';
import { normalizeYomitanGlossary } from '@/plugins/yomitan/content';
import { deinflectJapanese } from '@/plugins/yomitan/deinflect';
import { parseDictionaryLookupResult } from '@/services/plugins/contract';
import {
  parseYomitanIndex,
  yomitanTagBankSchema,
  yomitanTermBankSchema,
  yomitanTermMetaBankSchema,
} from '@/plugins/yomitan/schemas';

describe('Yomitan schemas', () => {
  test('accepts official dictionary format 1-3 index metadata', () => {
    expect(parseYomitanIndex({ title: 'Test', revision: '1', format: 3 })).toMatchObject({
      title: 'Test',
      sourceFormatVersion: 3,
    });
    expect(parseYomitanIndex({ title: 'Legacy', revision: '1', version: 1 })).toMatchObject({
      sourceFormatVersion: 1,
    });
    expect(() => parseYomitanIndex({ title: 'Future', revision: '1', format: 4 })).toThrow(
      /unsupported/i,
    );
  });

  test('validates term, tag, frequency, pitch, and IPA tuples', () => {
    expect(
      yomitanTermBankSchema.parse([['読む', 'よむ', 'common', 'v5', 10, ['to read'], 1, 'verb']]),
    ).toHaveLength(1);
    expect(yomitanTagBankSchema.parse([['v5', 'partOfSpeech', 1, 'Godan verb', 5]])).toHaveLength(
      1,
    );
    expect(
      yomitanTermMetaBankSchema.parse([
        ['読む', 'freq', { reading: 'よむ', frequency: { value: 42, displayValue: '42' } }],
        ['読む', 'pitch', { reading: 'よむ', pitches: [{ position: 1 }] }],
        ['読む', 'ipa', { reading: 'よむ', transcriptions: [{ ipa: '[jo̞mɯ̟ᵝ]' }] }],
      ]),
    ).toHaveLength(3);
  });
});

describe('Yomitan structured content', () => {
  test('normalizes ruby, tables, internal links, and archive images', () => {
    const nodes = normalizeYomitanGlossary([
      {
        type: 'structured-content',
        content: [
          { tag: 'ruby', content: ['読', { tag: 'rt', content: 'よ' }] },
          {
            tag: 'table',
            content: [{ tag: 'tr', content: [{ tag: 'td', content: 'definition' }] }],
          },
          { tag: 'a', href: '?query=読書', content: 'Related' },
          { tag: 'img', path: 'images/read.png', alt: 'stroke order', width: 160 },
        ],
      },
    ]);

    expect(nodes).toEqual([
      {
        type: 'element',
        tag: 'ruby',
        children: [
          { type: 'text', value: '読' },
          {
            type: 'element',
            tag: 'rt',
            children: [{ type: 'text', value: 'よ' }],
          },
        ],
      },
      {
        type: 'element',
        tag: 'table',
        children: [
          {
            type: 'element',
            tag: 'tr',
            children: [
              {
                type: 'element',
                tag: 'td',
                children: [{ type: 'text', value: 'definition' }],
              },
            ],
          },
        ],
      },
      { type: 'link', label: 'Related', target: { type: 'lookup', word: '読書' } },
      {
        type: 'image',
        resourceRef: 'images/read.png',
        alt: 'stroke order',
        width: 160,
      },
    ]);
  });

  test('rejects traversal paths, script URLs, and oversized trees', () => {
    expect(() => normalizeYomitanGlossary([{ type: 'image', path: '../secret.svg' }])).toThrow(
      /path/i,
    );
    expect(() =>
      normalizeYomitanGlossary([
        { type: 'structured-content', content: { tag: 'a', href: 'javascript:alert(1)' } },
      ]),
    ).toThrow(/link/i);
    expect(() => normalizeYomitanGlossary(Array.from({ length: 1_100 }, () => 'x'))).toThrow(
      /nodes/i,
    );
  });

  test('resolves an empty internal query to the current headword', () => {
    expect(
      normalizeYomitanGlossary(
        [{ type: 'structured-content', content: { tag: 'a', href: '?', content: 'Same term' } }],
        '読む',
      ),
    ).toEqual([{ type: 'link', label: 'Same term', target: { type: 'lookup', word: '読む' } }]);
  });

  test('normalizes Jitendex structured content nested to depth 13', () => {
    const tags = [
      'ul',
      'li',
      'ol',
      'li',
      'div',
      'div',
      'div',
      'div',
      'span',
      'span',
      'ruby',
      'rt',
    ] as const;
    const content = tags.reduceRight<unknown>((child, tag) => ({ tag, content: child }), '物作り');

    const definitions = normalizeYomitanGlossary([{ type: 'structured-content', content }]);
    expect(definitions).toHaveLength(1);
    expect(() =>
      parseDictionaryLookupResult({
        entries: [{ expression: '物作り', reading: 'ものづくり', definitions }],
      }),
    ).not.toThrow();
  });
});

describe('Japanese deinflection', () => {
  test('generates common verb and i-adjective dictionary forms with exact first', () => {
    const politePast = deinflectJapanese('読みました');
    expect(politePast[0]).toEqual({ term: '読みました', rules: [], reasons: [] });
    expect(politePast).toContainEqual({
      term: '読む',
      rules: ['v5'],
      reasons: ['polite past'],
    });

    expect(deinflectJapanese('食べなかった')).toContainEqual({
      term: '食べる',
      rules: ['v1'],
      reasons: ['negative past'],
    });
    expect(deinflectJapanese('青かった')).toContainEqual({
      term: '青い',
      rules: ['adj-i'],
      reasons: ['past'],
    });
  });

  test('deduplicates and caps the candidate graph', () => {
    const results = deinflectJapanese('読ませられませんでした');
    expect(new Set(results.map((result) => `${result.term}:${result.rules.join(',')}`)).size).toBe(
      results.length,
    );
    expect(results.length).toBeLessThanOrEqual(64);
  });
});
