/**
 * custom embedding model that proxies AI Gateway requests through our API route
 * solves CORS issues when making gateway calls from browser
 */

import type { EmbeddingModel } from 'ai';

interface ProxiedEmbeddingOptions {
  apiKey: string;
  model?: string;
}

// custom embedding model that routes requests through /api/ai/embed
export function createProxiedEmbeddingModel(
  options: ProxiedEmbeddingOptions,
): EmbeddingModel<string> {
  const modelId = options.model || 'openai/text-embedding-3-small';

  return {
    specificationVersion: 'v2',
    modelId,
    provider: 'ai-gateway-proxied',
    maxEmbeddingsPerCall: 100,
    supportsParallelCalls: false,

    async doEmbed({ values }: { values: string[] }): Promise<{
      embeddings: number[][];
      usage?: { tokens: number };
    }> {
      const response = await fetch('/api/ai/embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          texts: values,
          single: values.length === 1,
          apiKey: options.apiKey,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || `Embedding failed: ${response.status}`);
      }

      const data = await response.json();

      if (values.length === 1 && data.embedding) {
        return { embeddings: [data.embedding] };
      }

      return { embeddings: data.embeddings };
    },
  };
}
