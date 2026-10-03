import type { ReplicaAdapter } from '@/services/sync/replicaRegistry';
import type { ReplicaRow } from '@/types/replica';
import type {
  CustomTranslator,
  CustomTranslatorType,
  TranslationPrompt,
} from '@/types/translation';
import { defaultComputeId, unwrap } from './helpers';

export const CUSTOM_TRANSLATOR_KIND = 'custom_translator';
export const TRANSLATION_PROMPT_KIND = 'translation_prompt';

const TRANSLATOR_TYPES: readonly CustomTranslatorType[] = ['openai-compatible', 'deepl'];

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

const toTranslator = (id: string, get: (key: string) => unknown): CustomTranslator | null => {
  const type = get('type') as CustomTranslatorType;
  const name = str(get('name'));
  if (!TRANSLATOR_TYPES.includes(type) || !name) return null;
  const translator: CustomTranslator = {
    id,
    type,
    name,
    addedAt: num(get('addedAt')) ?? Date.now(),
    updatedAt: num(get('updatedAt')) ?? Date.now(),
  };
  const baseUrl = str(get('baseUrl'));
  const apiKey = str(get('apiKey'));
  const model = str(get('model'));
  const temperature = num(get('temperature'));
  if (baseUrl !== undefined) translator.baseUrl = baseUrl;
  if (apiKey !== undefined) translator.apiKey = apiKey;
  if (model !== undefined) translator.model = model;
  if (temperature !== undefined) translator.temperature = temperature;
  if (get('disabled') === true) translator.disabled = true;
  return translator;
};

const toPrompt = (id: string, get: (key: string) => unknown): TranslationPrompt | null => {
  const name = str(get('name'));
  const systemPrompt = str(get('systemPrompt'));
  if (!name || systemPrompt === undefined) return null;
  return {
    id,
    name,
    systemPrompt,
    addedAt: num(get('addedAt')) ?? Date.now(),
    updatedAt: num(get('updatedAt')) ?? Date.now(),
  };
};

export const customTranslatorAdapter: ReplicaAdapter<CustomTranslator> = {
  kind: CUSTOM_TRANSLATOR_KIND,
  schemaVersion: 1,

  pack(t: CustomTranslator): Record<string, unknown> {
    const fields: Record<string, unknown> = {
      type: t.type,
      name: t.name,
      addedAt: t.addedAt,
      updatedAt: t.updatedAt,
    };
    if (t.baseUrl !== undefined) fields['baseUrl'] = t.baseUrl;
    if (t.model !== undefined) fields['model'] = t.model;
    if (t.temperature !== undefined) fields['temperature'] = t.temperature;
    if (t.disabled !== undefined) fields['disabled'] = t.disabled;
    // Plaintext here; replicaCryptoMiddleware encrypts (or drops) it.
    if (t.apiKey !== undefined) fields['apiKey'] = t.apiKey;
    return fields;
  },

  unpack(fields: Record<string, unknown>): CustomTranslator {
    return toTranslator('', (key) => fields[key])!;
  },

  computeId: defaultComputeId,

  unpackRow(row: ReplicaRow): CustomTranslator | null {
    const translator = toTranslator(row.replica_id, (key) => unwrap(row.fields_jsonb[key]));
    if (translator && row.reincarnation) translator.reincarnation = row.reincarnation;
    return translator;
  },

  encryptedFields: ['apiKey'] as const,
};

export const translationPromptAdapter: ReplicaAdapter<TranslationPrompt> = {
  kind: TRANSLATION_PROMPT_KIND,
  schemaVersion: 1,

  pack(p: TranslationPrompt): Record<string, unknown> {
    return {
      name: p.name,
      systemPrompt: p.systemPrompt,
      addedAt: p.addedAt,
      updatedAt: p.updatedAt,
    };
  },

  unpack(fields: Record<string, unknown>): TranslationPrompt {
    return toPrompt('', (key) => fields[key])!;
  },

  computeId: defaultComputeId,

  unpackRow(row: ReplicaRow): TranslationPrompt | null {
    const prompt = toPrompt(row.replica_id, (key) => unwrap(row.fields_jsonb[key]));
    if (prompt && row.reincarnation) prompt.reincarnation = row.reincarnation;
    return prompt;
  },
};
