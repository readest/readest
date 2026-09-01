import { describe, expect, it } from 'vitest';

import { parseContextTranslationResult } from '@/services/ai/contextTranslationParser';

describe('parseContextTranslationResult', () => {
  it('parses a normal JSON result', () => {
    const result = parseContextTranslationResult(
      JSON.stringify({
        mode: 'normal',
        headword: 'requires',
        explanation: 'Nghĩa theo ngữ cảnh.',
      }),
      'normal',
    );

    expect(result).toEqual({
      mode: 'normal',
      headword: 'requires',
      explanation: 'Nghĩa theo ngữ cảnh.',
    });
  });

  it('parses JSON wrapped in a markdown code fence', () => {
    const result = parseContextTranslationResult(
      '```json\n{"mode":"normal","headword":"requires","explanation":"nghĩa"}\n```',
      'normal',
    );

    expect(result.mode).toBe('normal');
    expect(result.headword).toBe('requires');
  });

  it('parses a detailed JSON result', () => {
    const result = parseContextTranslationResult(
      JSON.stringify({
        mode: 'detailed',
        headword: 'text often requires',
        grammarPattern: 'noun + adverb + verb phrase',
        pronunciation: '/tɛkst ˈɔː.fən rɪˈkwaɪərz/',
        definition: 'To frequently make something necessary.',
        explanation: 'Detailed explanation.',
        examples: [{ sentence: 'Navigation often requires a map.', explanation: 'Similar use.' }],
        synonyms: [
          {
            phrase: 'frequently demands',
            example: 'It frequently demands care.',
            nuance: 'Stronger.',
          },
        ],
      }),
      'detailed',
    );

    expect(result.mode).toBe('detailed');
    if (result.mode !== 'detailed') throw new Error('Expected detailed result');
    expect(result.examples).toHaveLength(1);
    expect(result.synonyms).toHaveLength(1);
  });

  it('throws for invalid JSON', () => {
    expect(() => parseContextTranslationResult('not json', 'normal')).toThrow(
      'AI provider returned invalid JSON',
    );
  });

  it('throws when the mode does not match the requested detail level', () => {
    expect(() =>
      parseContextTranslationResult(
        '{"mode":"normal","headword":"x","explanation":"z"}',
        'detailed',
      ),
    ).toThrow('AI provider returned a result for the wrong detail level');
  });
});
