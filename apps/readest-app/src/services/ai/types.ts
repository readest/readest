export type AIProviderName = 'ollama' | 'openrouter';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIProvider {
  id: AIProviderName;
  name: string;
  requiresAuth: boolean;
  embed(text: string): Promise<number[]>;
  chatStream(
    messages: ChatMessage[],
    onToken: (token: string) => void,
    onComplete: () => void,
    onError: (error: Error) => void,
  ): Promise<AbortController>;
  isAvailable(): Promise<boolean>;
  healthCheck(): Promise<boolean>;
}

export interface AISettings {
  enabled: boolean;
  provider: AIProviderName;
  ollamaBaseUrl: string;
  ollamaModel: string;
  ollamaEmbeddingModel: string;
  openrouterApiKey?: string;
  openrouterModel?: string;
  openrouterEmbeddingModel?: string;
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
  searchMethod: 'bm25' | 'vector' | 'hybrid';
}

export interface BookIndexMeta {
  bookHash: string;
  bookTitle: string;
  authorName: string;
  totalSections: number;
  totalChunks: number;
  embeddingModel: string;
  lastUpdated: number;
}

export interface ChatSession {
  bookKey: string;
  bookHash: string;
  messages: ChatMessage[];
  abortController?: AbortController;
}

export interface IndexingState {
  bookHash: string;
  status: 'idle' | 'indexing' | 'complete' | 'error';
  progress: number;
  chunksProcessed: number;
  totalChunks: number;
  error?: string;
}

export interface EmbeddingProgress {
  current: number;
  total: number;
  phase: 'chunking' | 'embedding' | 'indexing';
}

export interface SourceCitation {
  text: string;
  chunkId: string;
  sectionIndex: number;
  chapterTitle: string;
}

export interface StructuredAIResponse {
  answer: string;
  sources: SourceCitation[];
}

export const OLLAMA_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string', description: 'The answer to the question' },
    sources: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Quoted text from the book' },
          chunkId: { type: 'string', description: 'ID of the source chunk' },
          sectionIndex: { type: 'number', description: 'Section/chapter number' },
          chapterTitle: { type: 'string', description: 'Chapter title' },
        },
        required: ['text', 'sectionIndex', 'chapterTitle'],
      },
    },
  },
  required: ['answer', 'sources'],
};

export const OPENROUTER_RESPONSE_SCHEMA = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'ai_response',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        answer: { type: 'string', description: 'The answer to the question' },
        sources: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Quoted text from the book' },
              chunkId: { type: 'string', description: 'ID of the source chunk' },
              sectionIndex: { type: 'number', description: 'Section/chapter number' },
              chapterTitle: { type: 'string', description: 'Chapter title' },
            },
            required: ['text', 'sectionIndex', 'chapterTitle'],
            additionalProperties: false,
          },
        },
      },
      required: ['answer', 'sources'],
      additionalProperties: false,
    },
  },
};
