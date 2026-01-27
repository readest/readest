const DEBUG = true;
const PREFIX = '[AI]';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

function formatData(data: unknown): string {
  if (data === undefined) return '';
  if (typeof data === 'object') {
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  }
  return String(data);
}

function log(level: LogLevel, module: string, message: string, data?: unknown) {
  if (!DEBUG) return;
  const timestamp = new Date().toISOString().split('T')[1]?.slice(0, 12);
  const prefix = `${PREFIX}[${timestamp}][${module}]`;
  const formatted = data !== undefined ? `${message} ${formatData(data)}` : message;

  switch (level) {
    case 'info':
      console.log(`%c${prefix} ${formatted}`, 'color: #4fc3f7');
      break;
    case 'warn':
      console.warn(`${prefix} ${formatted}`);
      break;
    case 'error':
      console.error(`${prefix} ${formatted}`);
      break;
    case 'debug':
      console.log(`%c${prefix} ${formatted}`, 'color: #81c784');
      break;
  }
}

export const aiLogger = {
  chunker: {
    start: (bookHash: string, sectionCount: number) =>
      log('info', 'CHUNKER', `Starting chunking`, { bookHash, sectionCount }),
    section: (sectionIndex: number, charCount: number, chunkCount: number) =>
      log('debug', 'CHUNKER', `Section ${sectionIndex}: ${charCount} chars → ${chunkCount} chunks`),
    complete: (bookHash: string, totalChunks: number) =>
      log('info', 'CHUNKER', `Chunking complete`, { bookHash, totalChunks }),
    error: (sectionIndex: number, error: string) =>
      log('error', 'CHUNKER', `Section ${sectionIndex} failed: ${error}`),
  },
  embedding: {
    start: (model: string, chunkCount: number) =>
      log('info', 'EMBED', `Starting embedding`, { model, chunkCount }),
    batch: (current: number, total: number) =>
      log(
        'debug',
        'EMBED',
        `Embedded ${current}/${total} (${Math.round((current / total) * 100)}%)`,
      ),
    complete: (successCount: number, totalCount: number, dimensions: number) =>
      log('info', 'EMBED', `Embedding complete`, { successCount, totalCount, dimensions }),
    error: (chunkId: string, error: string) =>
      log('error', 'EMBED', `Failed chunk ${chunkId}: ${error}`),
  },
  store: {
    saveChunks: (bookHash: string, count: number) =>
      log('info', 'STORE', `Saving ${count} chunks`, { bookHash }),
    saveMeta: (meta: object) => log('info', 'STORE', `Saving book meta`, meta),
    saveBM25: (bookHash: string) => log('info', 'STORE', `Saving BM25 index`, { bookHash }),
    loadChunks: (bookHash: string, count: number) =>
      log('debug', 'STORE', `Loaded ${count} chunks`, { bookHash }),
    clear: (bookHash: string) => log('info', 'STORE', `Cleared book data`, { bookHash }),
    error: (operation: string, error: string) =>
      log('error', 'STORE', `${operation} failed: ${error}`),
  },
  search: {
    query: (query: string, maxSection?: number) =>
      log('info', 'SEARCH', `Query: "${query.slice(0, 50)}..."`, { maxSection }),
    bm25Results: (count: number, topScore: number) =>
      log('debug', 'SEARCH', `BM25: ${count} results, top score: ${topScore.toFixed(3)}`),
    vectorResults: (count: number, topScore: number) =>
      log('debug', 'SEARCH', `Vector: ${count} results, top similarity: ${topScore.toFixed(4)}`),
    hybridResults: (count: number, methods: string[]) =>
      log('info', 'SEARCH', `Hybrid: ${count} results`, { methods }),
    spoilerFiltered: (before: number, after: number, maxSection: number) =>
      log('debug', 'SEARCH', `Spoiler filter: ${before} → ${after} (max section: ${maxSection})`),
  },
  chat: {
    send: (messageLength: number, hasContext: boolean) =>
      log('info', 'CHAT', `Sending message`, { messageLength, hasContext }),
    context: (chunks: number, totalChars: number) =>
      log('debug', 'CHAT', `Context: ${chunks} chunks, ${totalChars} chars`),
    stream: (tokens: number) => log('debug', 'CHAT', `Streamed ${tokens} tokens`),
    complete: (responseLength: number) =>
      log('info', 'CHAT', `Response complete: ${responseLength} chars`),
    error: (error: string) => log('error', 'CHAT', error),
  },
  rag: {
    indexStart: (bookHash: string, title: string) =>
      log('info', 'RAG', `Index start`, { bookHash, title }),
    indexProgress: (phase: string, current: number, total: number) =>
      log('debug', 'RAG', `Index progress: ${phase} ${current}/${total}`),
    indexComplete: (bookHash: string, chunks: number, duration: number) =>
      log('info', 'RAG', `Index complete`, { bookHash, chunks, durationMs: duration }),
    indexError: (bookHash: string, error: string) =>
      log('error', 'RAG', `Index failed`, { bookHash, error }),
    isIndexed: (bookHash: string, indexed: boolean) =>
      log('debug', 'RAG', `isIndexed check`, { bookHash, indexed }),
  },
  provider: {
    init: (provider: string, model: string) =>
      log('info', 'PROVIDER', `Initialized`, { provider, model }),
    embed: (provider: string, textLength: number) =>
      log('debug', 'PROVIDER', `Embed request: ${textLength} chars`, { provider }),
    chat: (provider: string, messageCount: number) =>
      log('debug', 'PROVIDER', `Chat request: ${messageCount} messages`, { provider }),
    error: (provider: string, error: string) =>
      log('error', 'PROVIDER', `${provider} error: ${error}`),
  },
};
