import { describe, expect, test } from 'vitest';
import {
  CUSTOM_TRANSLATOR_KIND,
  TRANSLATION_PROMPT_KIND,
  customTranslatorAdapter,
  translationPromptAdapter,
} from '@/services/sync/adapters/customTranslator';
import type { CustomTranslator, TranslationPrompt } from '@/types/translation';
import type { FieldEnvelope, FieldsObject, Hlc, ReplicaRow } from '@/types/replica';

const HLC = '00000000000-00000000-dev' as Hlc;
const env = <T>(v: T): FieldEnvelope<T> => ({ v, t: HLC, s: 'dev' });

const translator: CustomTranslator = {
  id: 't-1',
  type: 'openai-compatible',
  name: 'My LLM',
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-secret',
  model: 'gpt-x',
  temperature: 0.3,
  disabled: true,
  addedAt: 1700000000000,
  updatedAt: 1700000000001,
};

const prompt: TranslationPrompt = {
  id: 'p-1',
  name: 'Literary',
  systemPrompt: 'Translate {{sourceLang}} to {{targetLang}}.',
  addedAt: 1700000000000,
  updatedAt: 1700000000001,
};

const makeRow = (kind: string, fields: FieldsObject, overrides: Partial<ReplicaRow> = {}) =>
  ({
    user_id: 'u',
    kind,
    replica_id: 'rid',
    fields_jsonb: fields,
    manifest_jsonb: null,
    deleted_at_ts: null,
    reincarnation: null,
    updated_at_ts: HLC,
    schema_version: 1,
    ...overrides,
  }) as ReplicaRow;

const envelopes = (fields: Record<string, unknown>): FieldsObject =>
  Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, env(v)]));

describe('customTranslatorAdapter', () => {
  test('kind is custom_translator and the adapter is metadata-only', () => {
    expect(customTranslatorAdapter.kind).toBe('custom_translator');
    expect(CUSTOM_TRANSLATOR_KIND).toBe('custom_translator');
    expect(customTranslatorAdapter.binary).toBeUndefined();
  });

  test('declares apiKey as an encrypted field', () => {
    expect(customTranslatorAdapter.encryptedFields).toContain('apiKey');
  });

  test('pack passes apiKey through as plaintext (middleware encrypts)', () => {
    expect(customTranslatorAdapter.pack(translator)['apiKey']).toBe('sk-secret');
  });

  test('pack ∘ unpack round-trips every synced field', () => {
    const out = customTranslatorAdapter.unpack(customTranslatorAdapter.pack(translator));
    expect(out).toEqual({ ...translator, id: '' });
  });

  test('computeId is the record id', async () => {
    expect(await customTranslatorAdapter.computeId(translator)).toBe('t-1');
  });

  test('unpackRow rebuilds the translator with the replica id and reincarnation', () => {
    const fields = customTranslatorAdapter.pack(translator);
    const row = makeRow(CUSTOM_TRANSLATOR_KIND, envelopes(fields), { reincarnation: 'r1' });
    expect(customTranslatorAdapter.unpackRow(row, '')).toEqual({
      ...translator,
      id: 'rid',
      reincarnation: 'r1',
    });
  });

  test('unpackRow returns null on missing name or invalid type', () => {
    const noName = makeRow(CUSTOM_TRANSLATOR_KIND, envelopes({ type: 'deepl' }));
    expect(customTranslatorAdapter.unpackRow(noName, '')).toBeNull();
    const badType = makeRow(CUSTOM_TRANSLATOR_KIND, envelopes({ type: 'bogus', name: 'x' }));
    expect(customTranslatorAdapter.unpackRow(badType, '')).toBeNull();
  });
});

describe('translationPromptAdapter', () => {
  test('kind is translation_prompt with no encrypted fields', () => {
    expect(translationPromptAdapter.kind).toBe('translation_prompt');
    expect(TRANSLATION_PROMPT_KIND).toBe('translation_prompt');
    expect(translationPromptAdapter.encryptedFields).toBeUndefined();
  });

  test('pack ∘ unpack round-trips', () => {
    const out = translationPromptAdapter.unpack(translationPromptAdapter.pack(prompt));
    expect(out).toEqual({ ...prompt, id: '' });
  });

  test('unpackRow rebuilds the prompt and rejects rows without a name', () => {
    const row = makeRow(TRANSLATION_PROMPT_KIND, envelopes(translationPromptAdapter.pack(prompt)));
    expect(translationPromptAdapter.unpackRow(row, '')).toEqual({ ...prompt, id: 'rid' });
    const noName = makeRow(TRANSLATION_PROMPT_KIND, envelopes({ systemPrompt: 'x' }));
    expect(translationPromptAdapter.unpackRow(noName, '')).toBeNull();
  });
});
