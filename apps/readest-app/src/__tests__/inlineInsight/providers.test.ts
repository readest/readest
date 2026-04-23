import { describe, expect, it } from 'vitest';
import { DEFAULT_INLINE_INSIGHT_SETTINGS } from '@/services/inlineInsight/types';
import {
  buildInlineInsightUrlsFromApiHost,
  getApiHostFromInlineInsightChatUrl,
  getProviderDefaultConfig,
  getMinimalThinkingParams,
  inlineInsightProviderAllowsCustomApiHost,
  inlineInsightProviderNeedsApiKey,
  inlineInsightProviderSupportsApiKey,
} from '@/services/inlineInsight/providers';

describe('Inline Insight providers', () => {
  it('uses the custom OpenAI-compatible preset directly', () => {
    expect(getProviderDefaultConfig('custom-openai-compatible').label).toBe('OpenAI-compatible');
  });

  it('derives OpenAI-compatible endpoint pairs from an API host', () => {
    expect(buildInlineInsightUrlsFromApiHost('https://api.deepseek.com/')).toEqual({
      chatUrl: 'https://api.deepseek.com/v1/chat/completions',
      modelUrl: 'https://api.deepseek.com/v1/models',
    });
  });

  it('removes repeated endpoint suffixes while deriving endpoint pairs', () => {
    expect(buildInlineInsightUrlsFromApiHost('http://localhost:1234/v1')).toEqual({
      chatUrl: 'http://localhost:1234/v1/chat/completions',
      modelUrl: 'http://localhost:1234/v1/models',
    });
    expect(buildInlineInsightUrlsFromApiHost('http://localhost:1234/chat/completions')).toEqual({
      chatUrl: 'http://localhost:1234/v1/chat/completions',
      modelUrl: 'http://localhost:1234/v1/models',
    });
    expect(getApiHostFromInlineInsightChatUrl('http://localhost:1234/v1/chat/completions')).toBe(
      'http://localhost:1234',
    );
  });

  it('uses OpenAI-compatible defaults and no API key requirement for Ollama local models', () => {
    expect(getProviderDefaultConfig('ollama').defaultModelUrl).toBe(
      'http://127.0.0.1:11434/v1/models',
    );
    expect(inlineInsightProviderAllowsCustomApiHost('ollama')).toBe(true);
    expect(inlineInsightProviderNeedsApiKey('ollama')).toBe(false);
    expect(inlineInsightProviderNeedsApiKey('openai')).toBe(true);
  });

  it('uses OpenAI-compatible LM Studio defaults and treats API keys as optional', () => {
    expect(getProviderDefaultConfig('lmstudio').defaultChatUrl).toBe(
      'http://localhost:1234/v1/chat/completions',
    );
    expect(getProviderDefaultConfig('lmstudio').defaultModelUrl).toBe(
      'http://localhost:1234/v1/models',
    );
    expect(inlineInsightProviderAllowsCustomApiHost('lmstudio')).toBe(true);
    expect(inlineInsightProviderNeedsApiKey('lmstudio')).toBe(false);
    expect(inlineInsightProviderSupportsApiKey('lmstudio')).toBe(true);
  });

  it('marks hosted providers as non-editable in the UI', () => {
    expect(inlineInsightProviderAllowsCustomApiHost('openai')).toBe(false);
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
        provider: 'lmstudio',
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
