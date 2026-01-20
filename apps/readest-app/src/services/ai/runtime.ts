import { isTauriAppPlatform } from '@/services/environment';
import type { AISettings } from './types';

export type RuntimeMode = 'client' | 'server';

export interface RuntimeInfo {
  mode: RuntimeMode;
  platform: 'tauri' | 'web' | 'mobile';
  provider: AISettings['provider'];
  supportsOffline: boolean;
  storageLocation: 'indexeddb' | 'server';
}

export function getAIRuntimeInfo(settings: AISettings): RuntimeInfo {
  const isTauri = isTauriAppPlatform();
  const provider = settings.provider;

  // tauri desktop: always client-side (safe)
  if (isTauri) {
    return {
      mode: 'client',
      platform: 'tauri',
      provider,
      supportsOffline: provider === 'ollama',
      storageLocation: 'indexeddb', // always local storage for now
    };
  }

  // web: depends on provider and key ownership
  // for now: client-side with user's key, future: server-side with your key
  if (provider === 'ollama') {
    // ollama not supported in web
    throw new Error('Ollama is a local-only provider and not available in web mode');
  }

  // ai-gateway in web: currently client-side (user's key)
  // future: will use server routes when you provide the key
  return {
    mode: 'client', // TODO: change to 'server' when implementing free/paid tiers
    platform: 'web',
    provider,
    supportsOffline: false,
    storageLocation: 'indexeddb', // storage always client-side for now
  };
}

/**
 * checks if the current runtime supports the requested operation
 */
export function canUseAI(settings: AISettings): { available: boolean; reason?: string } {
  const isTauri = isTauriAppPlatform();

  if (!settings.enabled) {
    return { available: false, reason: 'AI is disabled in settings' };
  }

  if (!isTauri && settings.provider === 'ollama') {
    return { available: false, reason: 'Ollama is only available in the desktop app' };
  }

  if (settings.provider === 'ai-gateway' && !settings.aiGatewayApiKey) {
    return { available: false, reason: 'AI Gateway requires an API key' };
  }

  return { available: true };
}

/**
 * placeholder for future server-side storage
 * currently always uses IndexedDB
 */
export interface StorageBackend {
  type: 'indexeddb' | 'qdrant' | 'postgres';
  isRemote: boolean;
  supportsSync: boolean;
}

export function getStorageBackend(_settings: AISettings): StorageBackend {
  // TODO: future - add server-side storage options for cross-device sync
  // - qdrant for self-hosted vector DB
  // - postgres for supabase pgvector
  // - supabase storage for embeddings

  return {
    type: 'indexeddb',
    isRemote: false,
    supportsSync: false, // future: will be true when qdrant/postgres added
  };
}

/**
 * placeholder for future server-side RAG
 * when implemented, this will route to server API for embedding generation
 */
export interface EmbeddingSource {
  type: 'local' | 'server';
  endpoint?: string;
}

export function getEmbeddingSource(settings: AISettings): EmbeddingSource {
  const isTauri = isTauriAppPlatform();

  // tauri: always local (ollama or direct ai-gateway call with user's key)
  if (isTauri) {
    return { type: 'local' };
  }

  // web: local for now (user's key), server in future (your key)
  // TODO: when implementing free/paid tiers, route through /api/ai/embed
  if (settings.provider === 'ai-gateway' && settings.aiGatewayApiKey) {
    return { type: 'local' }; // user's key, safe to call directly
  }

  // future: your key scenario
  // return { type: 'server', endpoint: '/api/ai/embed' };

  return { type: 'local' };
}

/**
 * placeholder for future server-side chat
 */
export interface ChatSource {
  type: 'local' | 'server';
  endpoint?: string;
}

export function getChatSource(settings: AISettings): ChatSource {
  const isTauri = isTauriAppPlatform();

  // tauri: always local
  if (isTauri) {
    return { type: 'local' };
  }

  // web: local for now (user's key), server in future (your key)
  // TODO: when implementing free/paid tiers, route through /api/ai/chat
  if (settings.provider === 'ai-gateway' && settings.aiGatewayApiKey) {
    return { type: 'local' };
  }

  // future: your key scenario
  // return { type: 'server', endpoint: '/api/ai/chat' };

  return { type: 'local' };
}
