import { createGateway } from 'ai';

import type { AISettings } from '@/services/ai/types';
import { getAIFetch } from '@/services/ai/utils/httpFetch';
import type { ChatModel } from '@/services/reedy/models/ChatModel';
import { createReedyModels } from '@/services/reedy/models/registry';

interface XRayModels {
  readonly chat: ChatModel;
  readonly chatModelIdentity: string;
  readonly embeddingModelId: string;
}

export const createXRayModels = (settings: AISettings): XRayModels => {
  const models = createReedyModels(settings);
  const chatModelIdentity = JSON.stringify([
    settings.provider,
    settings.provider === 'ollama'
      ? settings.ollamaBaseUrl
      : settings.provider === 'openrouter'
        ? (settings.openrouterBaseUrl ?? null)
        : null,
    models.chat.id,
  ]);
  if (settings.provider !== 'ai-gateway') {
    return { chat: models.chat, chatModelIdentity, embeddingModelId: models.embedding.id };
  }

  const gateway = createGateway({
    apiKey: settings.aiGatewayApiKey,
    fetch: getAIFetch(),
  });

  return {
    chat: {
      ...models.chat,
      getLanguageModel: () => gateway(models.chat.id),
    },
    chatModelIdentity,
    embeddingModelId: models.embedding.id,
  };
};
