// src/services/ai/types.ts
// core types for AI reading companion

export type AIProviderName = 'ollama' | 'openrouter';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIProvider {
  id: AIProviderName;
  name: string;
  requiresAuth: boolean;

  // core capabilities
  embed(text: string): Promise<number[]>;
  chatStream(
    messages: ChatMessage[],
    onToken: (token: string) => void,
    onComplete: () => void,
    onError: (error: Error) => void,
  ): Promise<AbortController>;

  // health & discovery
  isAvailable(): Promise<boolean>;
  healthCheck(): Promise<boolean>;
}

export interface AISettings {
  enabled: boolean;
  provider: AIProviderName;

  // ollama (local)
  ollamaBaseUrl: string;
  ollamaModel: string;
  ollamaEmbeddingModel: string;

  // openrouter (cloud)
  openrouterApiKey?: string;
  openrouterModel?: string;
  openrouterEmbeddingModel?: string;

  // rag settings
  spoilerProtection: boolean;
  maxContextChunks: number;
  indexingMode: 'on-demand' | 'background';
}

export interface TextChunk {
  id: string;
  bookHash: string;
  sectionIndex: number;
  chapterTitle: string;
  text: string;
  embedding?: number[];
}

export interface ScoredChunk extends TextChunk {
  score: number;
  source: 'bm25' | 'vector' | 'hybrid';
}
