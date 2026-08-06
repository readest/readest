import { describe, expect, it } from 'vitest';

import { buildContextTranslationSystemPrompt } from '@/services/ai/contextTranslationPrompt';

describe('buildContextTranslationSystemPrompt', () => {
  it('requires every normal result field to use the target language', () => {
    const prompt = buildContextTranslationSystemPrompt('normal');

    expect(prompt).toContain('Every user-facing JSON string value must be written in the target language');
  });

  it('requires detailed explanatory fields to use the target language', () => {
    const prompt = buildContextTranslationSystemPrompt('detailed');

    expect(prompt).toContain(
      'Write grammarPattern, definition, explanation, example explanations, synonym phrases, synonym examples, and nuance notes in the target language',
    );
  });

  it('does not ask detailed mode to return English definitions', () => {
    const prompt = buildContextTranslationSystemPrompt('detailed');

    expect(prompt).not.toContain('English definition');
  });
});
