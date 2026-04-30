import { isTauriAppPlatform } from '@/services/environment';
import type { InlineInsightSettings } from './types';
import { inlineInsightProviderSupportsApiKey } from './providers';

export async function fetchInlineInsightModels(settings: InlineInsightSettings): Promise<string[]> {
  const targetUrl = settings.modelUrl;
  const apiKey = inlineInsightProviderSupportsApiKey(settings.provider) ? settings.apiKey : '';

  let response: Response;
  if (!isTauriAppPlatform()) {
    response = await fetch('/api/inlineinsight/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: targetUrl, apiKey: apiKey || undefined }),
    });
  } else {
    response = await fetch(targetUrl, {
      ...(apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : {}),
    });
  }

  if (!response.ok) {
    throw new Error('Failed to fetch models');
  }

  const data: unknown = await response.json();
  const openAiLikeData = data as { data?: { id: string }[] };
  return openAiLikeData.data?.map((item) => item.id) ?? [];
}
