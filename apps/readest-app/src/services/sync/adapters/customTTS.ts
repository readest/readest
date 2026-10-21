import type { ReplicaAdapter } from '@/services/sync/replicaRegistry';
import type { ReplicaRow } from '@/types/replica';
import type { CustomTTSService } from '@/types/customTTS';
import { defaultComputeId, unwrap } from './helpers';

export const CUSTOM_TTS_KIND = 'custom_tts';

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

const toService = (id: string, get: (key: string) => unknown): CustomTTSService | null => {
  const name = str(get('name'));
  const baseUrl = str(get('baseUrl'));
  const model = str(get('model'));
  if (!name || !baseUrl || !model) return null;
  const service: CustomTTSService = {
    id,
    name,
    baseUrl,
    model,
    addedAt: num(get('addedAt')) ?? Date.now(),
    updatedAt: num(get('updatedAt')) ?? Date.now(),
  };
  const apiKey = str(get('apiKey'));
  const instructions = str(get('instructions'));
  if (apiKey !== undefined) service.apiKey = apiKey;
  if (instructions !== undefined) service.instructions = instructions;
  if (get('disabled') === true) service.disabled = true;
  return service;
};

export const customTTSAdapter: ReplicaAdapter<CustomTTSService> = {
  kind: CUSTOM_TTS_KIND,
  schemaVersion: 1,

  pack(s: CustomTTSService): Record<string, unknown> {
    const fields: Record<string, unknown> = {
      name: s.name,
      baseUrl: s.baseUrl,
      model: s.model,
      addedAt: s.addedAt,
      updatedAt: s.updatedAt,
    };
    if (s.instructions !== undefined) fields['instructions'] = s.instructions;
    if (s.disabled !== undefined) fields['disabled'] = s.disabled;
    // Plaintext here; replicaCryptoMiddleware encrypts (or drops) it.
    if (s.apiKey !== undefined) fields['apiKey'] = s.apiKey;
    return fields;
  },

  unpack(fields: Record<string, unknown>): CustomTTSService {
    return toService('', (key) => fields[key])!;
  },

  computeId: defaultComputeId,

  unpackRow(row: ReplicaRow): CustomTTSService | null {
    const service = toService(row.replica_id, (key) => unwrap(row.fields_jsonb[key]));
    if (service && row.reincarnation) service.reincarnation = row.reincarnation;
    return service;
  },

  encryptedFields: ['apiKey'] as const,
};
