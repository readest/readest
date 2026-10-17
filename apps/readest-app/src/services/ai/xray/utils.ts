import type { AISettings } from '@/services/ai/types';

export const hasXRayCredentials = (settings: AISettings): boolean => {
  if (settings.provider === 'ai-gateway') return !!settings.aiGatewayApiKey;
  if (settings.provider === 'openrouter') return !!settings.openrouterApiKey;
  return true;
};

export const normalizeXRayText = (value: string): string =>
  value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
