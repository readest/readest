import { embed, embedMany } from 'ai';
import { aiStore } from './storage/aiStore';
import { chunkSection, extractTextFromDocument } from './utils/chunker';
import { withRetryAndTimeout, AI_TIMEOUTS, AI_RETRY_CONFIGS } from './utils/retry';
import { getAIProvider } from './providers';
import { aiLogger } from './logger';
import type {
  AISettings,
  TextChunk,
  ScoredChunk,
  IndexingState,
  EmbeddingProgress,
  BookIndexMeta,
} from './types';

interface SectionItem {
  id: string;
  size: number;
  linear: string;
  createDocument: () => Promise<Document>;
}

interface TOCItem {
  id: number;
  label: string;
  href?: string;
}

export interface BookDocType {
  sections?: SectionItem[];
  toc?: TOCItem[];
  metadata?: { title?: string | { [key: string]: string }; author?: string | { name?: string } };
}

const indexingStates = new Map<string, IndexingState>();

export function getIndexingState(bookHash: string): IndexingState | null {
  return indexingStates.get(bookHash) || null;
}

export async function isBookIndexed(bookHash: string): Promise<boolean> {
  const indexed = await aiStore.isIndexed(bookHash);
  aiLogger.rag.isIndexed(bookHash, indexed);
  return indexed;
}

export async function getBookMeta(bookHash: string): Promise<BookIndexMeta | null> {
  return aiStore.getMeta(bookHash);
}

function extractTitle(metadata?: BookDocType['metadata']): string {
  if (!metadata?.title) return 'Unknown Book';
  if (typeof metadata.title === 'string') return metadata.title;
  return (
    metadata.title['en'] ||
    metadata.title['default'] ||
    Object.values(metadata.title)[0] ||
    'Unknown Book'
  );
}

function extractAuthor(metadata?: BookDocType['metadata']): string {
  if (!metadata?.author) return 'Unknown Author';
  if (typeof metadata.author === 'string') return metadata.author;
  return metadata.author.name || 'Unknown Author';
}

function getChapterTitle(toc: TOCItem[] | undefined, sectionIndex: number): string {
  if (!toc || toc.length === 0) return `Section ${sectionIndex + 1}`;
  for (let i = toc.length - 1; i >= 0; i--) {
    if (toc[i]!.id <= sectionIndex) return toc[i]!.label;
  }
  return toc[0]?.label || `Section ${sectionIndex + 1}`;
}

export async function indexBook(
  bookDoc: BookDocType,
  bookHash: string,
  settings: AISettings,
  onProgress?: (progress: EmbeddingProgress) => void,
): Promise<void> {
  const startTime = Date.now();
  const title = extractTitle(bookDoc.metadata);

  if (await aiStore.isIndexed(bookHash)) {
    aiLogger.rag.isIndexed(bookHash, true);
    return;
  }

  aiLogger.rag.indexStart(bookHash, title);
  const provider = getAIProvider(settings);
  const sections = bookDoc.sections || [];
  const toc = bookDoc.toc || [];

  aiLogger.chunker.start(bookHash, sections.length);
  const state: IndexingState = {
    bookHash,
    status: 'indexing',
    progress: 0,
    chunksProcessed: 0,
    totalChunks: 0,
  };
  indexingStates.set(bookHash, state);

  try {
    onProgress?.({ current: 0, total: 1, phase: 'chunking' });
    aiLogger.rag.indexProgress('chunking', 0, sections.length);
    const allChunks: TextChunk[] = [];

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i]!;
      try {
        const doc = await section.createDocument();
        const text = extractTextFromDocument(doc);
        if (text.length < 100) continue;
        const sectionChunks = chunkSection(doc, i, getChapterTitle(toc, i), bookHash);
        aiLogger.chunker.section(i, text.length, sectionChunks.length);
        allChunks.push(...sectionChunks);
      } catch (e) {
        aiLogger.chunker.error(i, (e as Error).message);
      }
    }

    aiLogger.chunker.complete(bookHash, allChunks.length);
    state.totalChunks = allChunks.length;

    if (allChunks.length === 0) {
      state.status = 'complete';
      state.progress = 100;
      aiLogger.rag.indexComplete(bookHash, 0, Date.now() - startTime);
      return;
    }

    onProgress?.({ current: 0, total: allChunks.length, phase: 'embedding' });
    const embeddingModelName =
      settings.provider === 'ollama'
        ? settings.ollamaEmbeddingModel
        : settings.aiGatewayEmbeddingModel || 'text-embedding-3-small';
    aiLogger.embedding.start(embeddingModelName, allChunks.length);

    const texts = allChunks.map((c) => c.text);
    try {
      const { embeddings } = await withRetryAndTimeout(
        () =>
          embedMany({
            model: provider.getEmbeddingModel(),
            values: texts,
          }),
        AI_TIMEOUTS.EMBEDDING_BATCH,
        AI_RETRY_CONFIGS.EMBEDDING,
      );

      for (let i = 0; i < allChunks.length; i++) {
        allChunks[i]!.embedding = embeddings[i];
        state.chunksProcessed = i + 1;
        state.progress = Math.round(((i + 1) / allChunks.length) * 100);
      }
      onProgress?.({ current: allChunks.length, total: allChunks.length, phase: 'embedding' });
      aiLogger.embedding.complete(embeddings.length, allChunks.length, embeddings[0]?.length || 0);
    } catch (e) {
      aiLogger.embedding.error('batch', (e as Error).message);
      throw e;
    }

    onProgress?.({ current: 0, total: 2, phase: 'indexing' });
    aiLogger.store.saveChunks(bookHash, allChunks.length);
    await aiStore.saveChunks(allChunks);

    onProgress?.({ current: 1, total: 2, phase: 'indexing' });
    aiLogger.store.saveBM25(bookHash);
    await aiStore.saveBM25Index(bookHash, allChunks);

    const meta: BookIndexMeta = {
      bookHash,
      bookTitle: title,
      authorName: extractAuthor(bookDoc.metadata),
      totalSections: sections.length,
      totalChunks: allChunks.length,
      embeddingModel: embeddingModelName,
      lastUpdated: Date.now(),
    };
    aiLogger.store.saveMeta(meta);
    await aiStore.saveMeta(meta);

    onProgress?.({ current: 2, total: 2, phase: 'indexing' });
    state.status = 'complete';
    state.progress = 100;
    aiLogger.rag.indexComplete(bookHash, allChunks.length, Date.now() - startTime);
  } catch (error) {
    state.status = 'error';
    state.error = (error as Error).message;
    aiLogger.rag.indexError(bookHash, (error as Error).message);
    throw error;
  }
}

export async function hybridSearch(
  bookHash: string,
  query: string,
  settings: AISettings,
  topK = 10,
  maxSectionIndex?: number,
): Promise<ScoredChunk[]> {
  aiLogger.search.query(query, maxSectionIndex);
  const provider = getAIProvider(settings);
  let queryEmbedding: number[] | null = null;

  try {
    // use AI SDK embed with provider's embedding model
    const { embedding } = await withRetryAndTimeout(
      () =>
        embed({
          model: provider.getEmbeddingModel(),
          value: query,
        }),
      AI_TIMEOUTS.EMBEDDING_SINGLE,
      AI_RETRY_CONFIGS.EMBEDDING,
    );
    queryEmbedding = embedding;
  } catch {
    // bm25 only fallback
  }

  const results = await aiStore.hybridSearch(
    bookHash,
    queryEmbedding,
    query,
    topK,
    maxSectionIndex,
  );
  aiLogger.search.hybridResults(results.length, [...new Set(results.map((r) => r.searchMethod))]);
  return results;
}

export async function getRelevantContext(
  bookHash: string,
  query: string,
  settings: AISettings,
  maxSectionIndex?: number,
): Promise<string[]> {
  const results = await hybridSearch(
    bookHash,
    query,
    settings,
    settings.maxContextChunks || 5,
    maxSectionIndex,
  );
  const texts = results.map((r) => r.text);
  aiLogger.chat.context(results.length, texts.join('').length);
  return texts;
}

export async function clearBookIndex(bookHash: string): Promise<void> {
  aiLogger.store.clear(bookHash);
  await aiStore.clearBook(bookHash);
  indexingStates.delete(bookHash);
}
