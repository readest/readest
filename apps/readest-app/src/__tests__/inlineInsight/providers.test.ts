import { describe, expect, it } from 'vitest';
import { DEFAULT_INLINE_INSIGHT_SETTINGS } from '@/services/inlineInsight/types';
import {
  getInlineInsightChatEndpoint,
  getInlineInsightModelsEndpoint,
  getInlineInsightProviderConfig,
  getInlineInsightThinkingControlParams,
  normalizeInlineInsightProvider,
  inlineInsightProviderNeedsApiKey,
  inlineInsightProviderSupportsApiKey,
} from '@/services/inlineInsight/providers';

describe('Inline Insight providers', () => {
  it('maps the legacy OpenAI-compatible provider to the custom preset', () => {
    expect(normalizeInlineInsightProvider('openai-compatible')).toBe('custom-openai-compatible');
    expect(getInlineInsightProviderConfig('openai-compatible').label).toBe('OpenAI-compatible');
  });

  it('builds provider endpoints from the configured base URL', () => {
    const settings = {
      ...DEFAULT_INLINE_INSIGHT_SETTINGS,
      provider: 'deepseek' as const,
      baseUrl: 'https://api.deepseek.com/',
    };

    expect(getInlineInsightChatEndpoint(settings)).toBe(
      'https://api.deepseek.com/v1/chat/completions',
    );
    expect(getInlineInsightModelsEndpoint(settings)).toBe('https://api.deepseek.com/v1/models');
  });

  it('uses Ollama model tags and no API key requirement for local models', () => {
    expect(getInlineInsightModelsEndpoint(DEFAULT_INLINE_INSIGHT_SETTINGS)).toBe(
      'http://127.0.0.1:11434/api/tags',
    );
    expect(inlineInsightProviderNeedsApiKey('ollama')).toBe(false);
    expect(inlineInsightProviderNeedsApiKey('openai')).toBe(true);
  });

  it('builds LM Studio REST endpoints and treats API keys as optional', () => {
    const settings = {
      ...DEFAULT_INLINE_INSIGHT_SETTINGS,
      provider: 'lmstudio-rest' as const,
      baseUrl: 'http://localhost:1234/',
    };

    expect(getInlineInsightChatEndpoint(settings)).toBe(
      'http://localhost:1234/api/v0/chat/completions',
    );
    expect(getInlineInsightModelsEndpoint(settings)).toBe('http://localhost:1234/api/v0/models');
    expect(inlineInsightProviderNeedsApiKey('lmstudio-rest')).toBe(false);
    expect(inlineInsightProviderSupportsApiKey('lmstudio-rest')).toBe(true);
  });

  it('adds provider-specific thinking suppression parameters when supported', () => {
    expect(getInlineInsightThinkingControlParams(DEFAULT_INLINE_INSIGHT_SETTINGS)).toEqual({
      think: false,
    });
    expect(
      getInlineInsightThinkingControlParams({
        ...DEFAULT_INLINE_INSIGHT_SETTINGS,
        provider: 'openrouter',
      }),
    ).toEqual({ reasoning: { effort: 'none', exclude: true } });
    expect(
      getInlineInsightThinkingControlParams({
        ...DEFAULT_INLINE_INSIGHT_SETTINGS,
        provider: 'gemini',
        model: 'gemini-2.5-flash',
      }),
    ).toEqual({ reasoning_effort: 'none' });
    expect(
      getInlineInsightThinkingControlParams({
        ...DEFAULT_INLINE_INSIGHT_SETTINGS,
        provider: 'lmstudio-rest',
      }),
    ).toEqual({ reasoning: 'off' });
  });

  it('does not add unknown thinking suppression parameters for generic providers', () => {
    expect(
      getInlineInsightThinkingControlParams({
        ...DEFAULT_INLINE_INSIGHT_SETTINGS,
        provider: 'custom-openai-compatible',
      }),
    ).toEqual({});
  });
});
