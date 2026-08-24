import { createGateway, embed, embedMany, type EmbeddingModel as VercelEmbeddingModel } from 'ai';

import type { AISettings } from '@/services/ai/types';
import { getAIFetch } from '@/services/ai/utils/httpFetch';
import type { EmbeddingModel } from '@/services/reedy/models/EmbeddingModel';
import { createReedyModels, type ReedyModels } from '@/services/reedy/models/registry';

export const createXRayModels = (settings: AISettings): ReedyModels => {
  const models = createReedyModels(settings);
  if (settings.provider !== 'ai-gateway') return models;

  const gateway = createGateway({
    apiKey: settings.aiGatewayApiKey,
    fetch: getAIFetch(),
  });

  return {
    chat: {
      ...models.chat,
      getLanguageModel: () => gateway(models.chat.id),
    },
    embedding: adaptEmbeddingModel(
      gateway.embeddingModel(models.embedding.id),
      models.embedding.id,
      models.embedding.batchSize,
    ),
  };
};

const adaptEmbeddingModel = (
  model: VercelEmbeddingModel,
  id: string,
  batchSize?: number,
): EmbeddingModel => {
  let dim: number | null = null;

  return {
    id,
    get dim(): number {
      if (dim === null) {
        throw new Error('embedding dim unknown - call embed([sample]) once before reading dim');
      }
      return dim;
    },
    batchSize,
    async embed(texts, options) {
      if (texts.length === 0) return [];
      if (texts.length === 1) {
        const result = await embed({
          model,
          value: texts[0]!,
          abortSignal: options?.signal,
        });
        dim ??= result.embedding.length;
        return [result.embedding];
      }

      const result = await embedMany({
        model,
        values: texts,
        abortSignal: options?.signal,
      });
      if (result.embeddings.length > 0) dim ??= result.embeddings[0]!.length;
      return result.embeddings;
    },
  };
};
