import { embed, embedMany } from 'ai';
import { aiStore } from './storage/aiStore';
import { chunkSection, extractTextFromDocument } from './utils/chunker';
import { withRetryAndTimeout, AI_TIMEOUTS, AI_RETRY_CONFIGS } from './utils/retry';
import { getAIProvider } from './providers';
import { aiLogger } from './logger';
import type {
  AISettings,
  ScoredChunk,
  EmbeddingProgress,
  BookIndexMeta,
  IndexingState,
} from './types';
import { eventDispatcher } from '@/utils/event';

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
const indexingInFlight = new Map<string, Promise<void>>();

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const yieldToMainThread = async (): Promise<void> => {
  if (typeof window === 'undefined') return;
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

const createYieldController = (budgetMs = 12) => {
  let lastYield = nowMs();
  return async () => {
    const now = nowMs();
    if (now - lastYield < budgetMs) return;
    lastYield = now;
    await yieldToMainThread();
  };
};

export async function isBookIndexed(bookHash: string): Promise<boolean> {
  const indexed = await aiStore.isIndexed(bookHash);
  aiLogger.rag.isIndexed(bookHash, indexed);
  return indexed;
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
  const inflight = indexingInFlight.get(bookHash);
  if (inflight) return inflight;

  const run = async () => {
    const startTime = Date.now();
    const yieldIfNeeded = createYieldController(12);
    const title = extractTitle(bookDoc.metadata);
    const meta = await aiStore.getMeta(bookHash);
    if (meta && meta.totalChunks > 0) {
      const toc = bookDoc.toc || [];
      const chunks = await aiStore.getChunks(bookHash);
      let updated = false;
      const updatedChunks = chunks.map((chunk) => {
        const chapterTitle = chunk.chapterTitle || getChapterTitle(toc, chunk.sectionIndex);
        const chapterNumber =
          typeof chunk.chapterNumber === 'number' ? chunk.chapterNumber : chunk.sectionIndex + 1;
        if (chapterTitle !== chunk.chapterTitle || chapterNumber !== chunk.chapterNumber) {
          updated = true;
          return { ...chunk, chapterTitle, chapterNumber };
        }
        return chunk;
      });
      if (updated) {
        await aiStore.saveChunks(updatedChunks);
        await aiStore.saveBM25Index(bookHash, updatedChunks);
      }
      aiLogger.rag.isIndexed(bookHash, true);
      const completedState: IndexingState = {
        bookHash,
        status: 'complete',
        progress: 100,
        chunksProcessed: meta.totalChunks,
        totalChunks: meta.totalChunks,
        phase: 'indexing',
        current: 2,
        total: 2,
        updatedAt: Date.now(),
      };
      indexingStates.set(bookHash, completedState);
      await aiStore.saveIndexingState(completedState);
      void eventDispatcher.dispatch('rag-indexing-updated', completedState);
      return;
    }

    aiLogger.rag.indexStart(bookHash, title);
    const provider = getAIProvider(settings);
    const sections = bookDoc.sections || [];
    const toc = bookDoc.toc || [];

    // calculate cumulative character sizes like toc.ts does
    const sizes = sections.map((s) => (s.linear !== 'no' && s.size > 0 ? s.size : 0));
    let cumulative = 0;
    const cumulativeSizes = sizes.map((size) => {
      const current = cumulative;
      cumulative += size;
      return current;
    });

    let state: IndexingState = {
      bookHash,
      status: 'indexing',
      progress: 0,
      chunksProcessed: 0,
      totalChunks: 0,
      phase: 'chunking',
      current: 0,
      total: Math.max(1, sections.length),
      updatedAt: Date.now(),
    };
    indexingStates.set(bookHash, state);

    let lastPersisted = 0;
    const persistState = (force = false) => {
      const now = Date.now();
      if (!force && now - lastPersisted < 400) return;
      lastPersisted = now;
      void aiStore.saveIndexingState(state);
      void eventDispatcher.dispatch('rag-indexing-updated', state);
    };

    const updateState = (partial: Partial<IndexingState>, force = false) => {
      state = { ...state, ...partial, updatedAt: Date.now() };
      indexingStates.set(bookHash, state);
      persistState(force);
    };

    const reportProgress = (progress: EmbeddingProgress, extra?: Partial<IndexingState>) => {
      onProgress?.(progress);
      const nextProgress =
        progress.phase === 'embedding' && progress.total > 0
          ? Math.round((progress.current / progress.total) * 100)
          : progress.phase === 'indexing'
            ? 100
            : state.progress;
      updateState(
        {
          ...(extra || {}),
          phase: progress.phase,
          current: progress.current,
          total: progress.total,
          progress: nextProgress,
        },
        false,
      );
    };

    try {
      reportProgress({ current: 0, total: Math.max(1, sections.length), phase: 'chunking' });
      aiLogger.rag.indexProgress('chunking', 0, sections.length);
      let allChunks = await aiStore.getChunks(bookHash);

      if (allChunks.length === 0) {
        allChunks = [];
        for (let i = 0; i < sections.length; i++) {
          const section = sections[i]!;
          try {
            const doc = await section.createDocument();
            const text = extractTextFromDocument(doc);
            if (text.length < 100) continue;
            const sectionChunks = chunkSection(
              doc,
              i,
              getChapterTitle(toc, i),
              bookHash,
              cumulativeSizes[i] ?? 0,
            );
            aiLogger.chunker.section(i, text.length, sectionChunks.length);
            allChunks.push(...sectionChunks);
          } catch (e) {
            aiLogger.chunker.error(i, (e as Error).message);
          }
          reportProgress({
            current: i + 1,
            total: Math.max(1, sections.length),
            phase: 'chunking',
          });
          await yieldIfNeeded();
        }
      } else {
        reportProgress({
          current: Math.max(1, sections.length),
          total: Math.max(1, sections.length),
          phase: 'chunking',
        });
      }

      aiLogger.chunker.complete(bookHash, allChunks.length);
      updateState({ totalChunks: allChunks.length });

      if (allChunks.length === 0) {
        updateState({ status: 'complete', progress: 100 }, true);
        aiLogger.rag.indexComplete(bookHash, 0, Date.now() - startTime);
        return;
      }

      await aiStore.saveChunks(allChunks);

      const missingIndices = allChunks
        .map((chunk, index) => ({ index, hasEmbedding: !!chunk.embedding?.length }))
        .filter((item) => !item.hasEmbedding)
        .map((item) => item.index);
      const alreadyEmbedded = allChunks.length - missingIndices.length;
      reportProgress(
        {
          current: alreadyEmbedded,
          total: allChunks.length,
          phase: 'embedding',
        },
        { chunksProcessed: alreadyEmbedded },
      );
      const embeddingModelName =
        settings.provider === 'ollama'
          ? settings.ollamaEmbeddingModel
          : settings.aiGatewayEmbeddingModel || 'text-embedding-3-small';
      aiLogger.embedding.start(embeddingModelName, allChunks.length);

      let processed = alreadyEmbedded;
      try {
        const batchSize = 64;
        for (let offset = 0; offset < missingIndices.length; offset += batchSize) {
          const batchIndices = missingIndices.slice(offset, offset + batchSize);
          const texts = batchIndices.map((index) => allChunks[index]!.text);
          const { embeddings } = await withRetryAndTimeout(
            () =>
              embedMany({
                model: provider.getEmbeddingModel(),
                values: texts,
              }),
            AI_TIMEOUTS.EMBEDDING_BATCH,
            AI_RETRY_CONFIGS.EMBEDDING,
          );
          embeddings.forEach((embedding, idx) => {
            const targetIndex = batchIndices[idx];
            if (typeof targetIndex === 'number') {
              allChunks[targetIndex]!.embedding = embedding;
            }
          });
          processed += embeddings.length;
          reportProgress(
            { current: processed, total: allChunks.length, phase: 'embedding' },
            { chunksProcessed: processed },
          );
          await aiStore.saveChunks(allChunks);
          await yieldIfNeeded();
        }
        if (missingIndices.length === 0) {
          reportProgress(
            { current: allChunks.length, total: allChunks.length, phase: 'embedding' },
            { chunksProcessed: allChunks.length },
          );
        }
        aiLogger.embedding.complete(
          processed,
          allChunks.length,
          allChunks[0]?.embedding?.length || 0,
        );
      } catch (e) {
        aiLogger.embedding.error('batch', (e as Error).message);
        throw e;
      }

      reportProgress({ current: 0, total: 2, phase: 'indexing' });
      aiLogger.store.saveChunks(bookHash, allChunks.length);
      await aiStore.saveChunks(allChunks);

      reportProgress({ current: 1, total: 2, phase: 'indexing' });
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

      reportProgress({ current: 2, total: 2, phase: 'indexing' });
      updateState({ status: 'complete', progress: 100 }, true);
      aiLogger.rag.indexComplete(bookHash, allChunks.length, Date.now() - startTime);
    } catch (error) {
      updateState({ status: 'error', error: (error as Error).message }, true);
      aiLogger.rag.indexError(bookHash, (error as Error).message);
      throw error;
    }
  };

  const promise = run().finally(() => {
    indexingInFlight.delete(bookHash);
  });
  indexingInFlight.set(bookHash, promise);
  return await promise;
}

export async function hybridSearch(
  bookHash: string,
  query: string,
  settings: AISettings,
  topK = 10,
  maxPage?: number,
): Promise<ScoredChunk[]> {
  aiLogger.search.query(query, maxPage);
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

  const results = await aiStore.hybridSearch(bookHash, queryEmbedding, query, topK, maxPage);
  aiLogger.search.hybridResults(results.length, [...new Set(results.map((r) => r.searchMethod))]);
  return results;
}

export async function clearBookIndex(bookHash: string): Promise<void> {
  aiLogger.store.clear(bookHash);
  await aiStore.clearBook(bookHash);
  await aiStore.clearIndexingState(bookHash);
  indexingStates.delete(bookHash);
  indexingInFlight.delete(bookHash);
}
