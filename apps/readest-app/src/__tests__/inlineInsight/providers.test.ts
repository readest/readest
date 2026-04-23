import { describe, expect, it } from 'vitest';
import { DEFAULT_INLINE_INSIGHT_SETTINGS } from '@/services/inlineInsight/types';
import {
  getProviderDefaultConfig,
  getInlineInsightChatEndpoint,
  getInlineInsightModelsEndpoint,
  getMinimalThinkingParams,
  inlineInsightProviderNeedsApiKey,
  inlineInsightProviderSupportsApiKey,
} from '@/services/inlineInsight/providers';

describe('Inline Insight providers', () => {
  it('uses the custom OpenAI-compatible preset directly', () => {
    expect(getProviderDefaultConfig('custom-openai-compatible').label).toBe('OpenAI-compatible');
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

  it('only adds thinking suppression parameters for providers with known-safe request shapes', () => {
    expect(getMinimalThinkingParams(DEFAULT_INLINE_INSIGHT_SETTINGS)).toEqual({});
    expect(
      getMinimalThinkingParams({
        ...DEFAULT_INLINE_INSIGHT_SETTINGS,
        provider: 'gemini',
        model: 'gemini-3.1-flash-lite-preview',
      }),
    ).toEqual({ reasoning_effort: 'minimal' });
    expect(
      getMinimalThinkingParams({
        ...DEFAULT_INLINE_INSIGHT_SETTINGS,
        provider: 'gemini',
        model: 'gemini-2.5-flash',
      }),
    ).toEqual({ reasoning_effort: 'none' });
    expect(
      getMinimalThinkingParams({
        ...DEFAULT_INLINE_INSIGHT_SETTINGS,
        provider: 'gemini',
        model: 'gemini-2.5-pro',
      }),
    ).toEqual({});
    expect(
      getMinimalThinkingParams({
        ...DEFAULT_INLINE_INSIGHT_SETTINGS,
        provider: 'openrouter',
      }),
    ).toEqual({ reasoning: { effort: 'none' } });
    expect(
      getMinimalThinkingParams({
        ...DEFAULT_INLINE_INSIGHT_SETTINGS,
        provider: 'lmstudio-rest',
      }),
    ).toEqual({ reasoning: 'off' });
  });

  it('does not add unknown thinking suppression parameters for generic providers', () => {
    expect(
      getMinimalThinkingParams({
        ...DEFAULT_INLINE_INSIGHT_SETTINGS,
        provider: 'custom-openai-compatible',
      }),
    ).toEqual({});
  });
});
