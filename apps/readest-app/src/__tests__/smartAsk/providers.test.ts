import { describe, expect, it } from 'vitest';
import { DEFAULT_SMART_ASK_SETTINGS } from '@/services/smartAsk/types';
import {
  getSmartAskChatEndpoint,
  getSmartAskModelsEndpoint,
  getSmartAskProviderConfig,
  getSmartAskThinkingControlParams,
  normalizeSmartAskProvider,
  smartAskProviderNeedsApiKey,
  smartAskProviderSupportsApiKey,
} from '@/services/smartAsk/providers';

describe('Inline Insight providers', () => {
  it('maps the legacy OpenAI-compatible provider to the custom preset', () => {
    expect(normalizeSmartAskProvider('openai-compatible')).toBe('custom-openai-compatible');
    expect(getSmartAskProviderConfig('openai-compatible').label).toBe('OpenAI-compatible');
  });

  it('builds provider endpoints from the configured base URL', () => {
    const settings = {
      ...DEFAULT_SMART_ASK_SETTINGS,
      provider: 'deepseek' as const,
      baseUrl: 'https://api.deepseek.com/',
    };

    expect(getSmartAskChatEndpoint(settings)).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(getSmartAskModelsEndpoint(settings)).toBe('https://api.deepseek.com/v1/models');
  });

  it('uses Ollama model tags and no API key requirement for local models', () => {
    expect(getSmartAskModelsEndpoint(DEFAULT_SMART_ASK_SETTINGS)).toBe(
      'http://127.0.0.1:11434/api/tags',
    );
    expect(smartAskProviderNeedsApiKey('ollama')).toBe(false);
    expect(smartAskProviderNeedsApiKey('openai')).toBe(true);
  });

  it('builds LM Studio REST endpoints and treats API keys as optional', () => {
    const settings = {
      ...DEFAULT_SMART_ASK_SETTINGS,
      provider: 'lmstudio-rest' as const,
      baseUrl: 'http://localhost:1234/',
    };

    expect(getSmartAskChatEndpoint(settings)).toBe('http://localhost:1234/api/v0/chat/completions');
    expect(getSmartAskModelsEndpoint(settings)).toBe('http://localhost:1234/api/v0/models');
    expect(smartAskProviderNeedsApiKey('lmstudio-rest')).toBe(false);
    expect(smartAskProviderSupportsApiKey('lmstudio-rest')).toBe(true);
  });

  it('adds provider-specific thinking suppression parameters when supported', () => {
    expect(getSmartAskThinkingControlParams(DEFAULT_SMART_ASK_SETTINGS)).toEqual({
      think: false,
    });
    expect(
      getSmartAskThinkingControlParams({
        ...DEFAULT_SMART_ASK_SETTINGS,
        provider: 'openrouter',
      }),
    ).toEqual({ reasoning: { effort: 'none', exclude: true } });
    expect(
      getSmartAskThinkingControlParams({
        ...DEFAULT_SMART_ASK_SETTINGS,
        provider: 'gemini',
        model: 'gemini-2.5-flash',
      }),
    ).toEqual({ reasoning_effort: 'none' });
    expect(
      getSmartAskThinkingControlParams({
        ...DEFAULT_SMART_ASK_SETTINGS,
        provider: 'lmstudio-rest',
      }),
    ).toEqual({ reasoning: 'off' });
  });

  it('does not add unknown thinking suppression parameters for generic providers', () => {
    expect(
      getSmartAskThinkingControlParams({
        ...DEFAULT_SMART_ASK_SETTINGS,
        provider: 'custom-openai-compatible',
      }),
    ).toEqual({});
  });
});
