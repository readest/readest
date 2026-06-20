import { type Tool, embed, embedMany } from 'ai';
import type { BookDoc } from '@/libs/document';
import type { AppService } from '@/types/system';
import { ReedyDb } from '@/services/reedy/db/ReedyDb';
import { BookIndexer } from '@/services/reedy/retrieval/BookIndexer';
import { BookRetriever } from '@/services/reedy/retrieval/BookRetriever';
import type { EmbeddingModel as ReedyEmbeddingModel } from '@/services/reedy/models/EmbeddingModel';
import { buildLookupTool, createTurnState } from '@/services/reedy/tools/lookupPassage';
import {
  NoopReedyMetrics,
  ReedyMetrics,
  type ReedyMetricsWriter,
} from '@/services/reedy/instrumentation';
import type { DatabaseService } from '@/types/database';
import { getAIProvider } from '../providers';
import type { AISettings, EmbeddingProgress } from '../types';
import type { BackendIndexOptions, RetrievalBackend } from './retrievalBackend';
import type { ReedySourceStore } from './reedySourceStore';

const REEDY_DB_KEY = 'reedy';
const REEDY_DB_FILE = 'reedy.db';
const DEFAULT_TOP_K = 5;

/**
 * Reedy retrieval backend. Lazy-opens reedy.db on first use, wraps the
 * existing AI provider's embedding model in Reedy's EmbeddingModel shape,
 * and exposes a Vercel `lookupPassage` tool the adapter passes through to
 * `streamText({ tools: ... })`.
 *
 * Only constructed when {@link selectBackend} returns `kind === 'reedy'`,
 * which requires both `aiSettings.reedy.enabled` and `isTauri()`.
 */
export class ReedyBackend implements RetrievalBackend {
  readonly kind = 'reedy' as const;

  private readonly dbReady: Promise<DatabaseService>;
  private readonly reedyReady: Promise<{
    reedy: ReedyDb;
    indexer: BookIndexer;
    retriever: BookRetriever;
  }>;
  private readonly model: ReedyEmbeddingModel;
  /**
   * Metrics writer — lazy because we don't want construction to block on
   * the DB open. Until the DB is ready, events go to a NoopWriter (events
   * during the first ~50ms of app startup are not load-bearing for the
   * 4-week measurement plan).
   */
  private metrics: ReedyMetricsWriter = new NoopReedyMetrics();
  private readonly sessionId: string;

  constructor(
    private readonly appService: AppService,
    settings: AISettings,
    private readonly appVersion: string = '0.0.0-dev',
  ) {
    this.model = adaptEmbeddingModel(settings);
    this.sessionId = randomSessionId();
    this.dbReady = this.appService.openDatabase(REEDY_DB_KEY, REEDY_DB_FILE, 'Data', {
      experimental: ['index_method'],
    });
    this.reedyReady = this.dbReady.then((svc) => {
      this.metrics = new ReedyMetrics(svc, this.appVersion, this.sessionId);
      const reedy = new ReedyDb(svc);
      return { reedy, indexer: new BookIndexer(reedy), retriever: new BookRetriever(reedy) };
    });
  }

  /** Surface the metrics writer so the AI panel can call exportBundle(). */
  getMetrics(): ReedyMetricsWriter {
    return this.metrics;
  }

  async isIndexed(bookHash: string): Promise<boolean> {
    const { reedy } = await this.reedyReady;
    const meta = await reedy.getBookMeta(bookHash);
    return meta?.indexingStatus === 'indexed' || meta?.indexingStatus === 'empty_index';
  }

  async indexBook(
    bookDoc: BookDoc,
    bookHash: string,
    options?: BackendIndexOptions,
  ): Promise<void> {
    const { indexer, reedy } = await this.reedyReady;
    this.metrics.log('book_indexing_started', { bookHash });
    try {
      await indexer.indexBook(bookDoc, bookHash, this.model, {
        onProgress: options?.onProgress
          ? (event): void => {
              const phaseMap: Record<typeof event.phase, EmbeddingProgress['phase']> = {
                chunking: 'chunking',
                embedding: 'embedding',
              };
              options.onProgress?.({
                current: event.current,
                total: event.total,
                phase: phaseMap[event.phase],
              });
            }
          : undefined,
        signal: options?.signal,
      });
      const meta = await reedy.getBookMeta(bookHash);
      this.metrics.log('book_indexed', {
        bookHash,
        payload: { chunk_count: meta?.chunkCount ?? 0 },
      });
    } catch (err) {
      this.metrics.log('book_indexing_failed', {
        bookHash,
        payload: { reason: err instanceof Error ? err.message : String(err) },
      });
      throw err;
    }
  }

  async clearBook(bookHash: string): Promise<void> {
    const { reedy } = await this.reedyReady;
    await reedy.dropBookData(bookHash);
  }

  buildLookupTool(args: {
    bookHash: string;
    turnId: string;
    sourceStore: ReedySourceStore;
    spoilerBoundPosition?: number;
  }): Tool {
    const { bookHash, turnId, sourceStore, spoilerBoundPosition } = args;
    // Wrap the retriever so each lookupPassage call also appends its result
    // to the sourceStore — the Sources dropdown reads from the same store.
    const lazyRetriever: BookRetriever = {
      search: async (searchArgs) => {
        const { retriever } = await this.reedyReady;
        const res = await retriever.search(searchArgs);
        if (res.passages.length > 0) {
          sourceStore.append(turnId, res.passages);
        }
        return res;
      },
    } as BookRetriever;

    return buildLookupTool({
      bookHash,
      retriever: lazyRetriever,
      activeEmbeddingModel: this.model,
      turnState: createTurnState(),
      spoilerBoundPosition,
      onEvent: (event) => {
        // Map the tool's lifecycle events into the metrics schema. The
        // tool emits short type strings; we widen them to the schema's
        // ReedyEvent union when they line up.
        const reedyEvent = mapToolEventToMetricEvent(event.type);
        if (reedyEvent) {
          this.metrics.log(reedyEvent, { bookHash, turnId, payload: event.payload });
        }
      },
    });
  }
}

function mapToolEventToMetricEvent(
  type: string,
): import('@/services/reedy/instrumentation').ReedyEvent | null {
  switch (type) {
    case 'tool_called':
      return 'tool_called';
    case 'tool_call_cached':
      return 'tool_call_cached';
    case 'tool_returned_empty':
      return 'tool_returned_empty';
    case 'tool_returned_stale':
      return 'tool_returned_stale';
    case 'budget_exceeded':
      return 'budget_exceeded';
    default:
      return null;
  }
}

function randomSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Wrap the active AI provider's Vercel `EmbeddingModel` into Reedy's
 * narrower interface (id + dim + embed). We don't import provider modules
 * directly — they're already constructed by `getAIProvider(settings)`.
 */
function adaptEmbeddingModel(settings: AISettings): ReedyEmbeddingModel {
  const provider = getAIProvider(settings);
  const vercelModel = provider.getEmbeddingModel();
  const id = embeddingModelIdFor(settings);
  const batchSize = settings.provider === 'ollama' ? 4 : 16;

  // Cache the dim after the first round-trip so we don't re-probe per batch.
  let dim: number | null = null;

  return {
    id,
    get dim(): number {
      if (dim == null) {
        throw new Error(
          'embedding model dim unknown — call embed([sample]) once before reading dim',
        );
      }
      return dim;
    },
    batchSize,
    async embed(texts, opts): Promise<number[][]> {
      if (texts.length === 0) return [];
      if (texts.length === 1) {
        const { embedding } = await embed({
          model: vercelModel,
          value: texts[0]!,
          abortSignal: opts?.signal,
        });
        dim ??= embedding.length;
        return [embedding];
      }
      const { embeddings } = await embedMany({
        model: vercelModel,
        values: texts,
        abortSignal: opts?.signal,
      });
      if (embeddings.length > 0) dim ??= embeddings[0]!.length;
      return embeddings;
    },
  };
}

function embeddingModelIdFor(settings: AISettings): string {
  switch (settings.provider) {
    case 'ollama':
      return settings.ollamaEmbeddingModel || 'nomic-embed-text';
    case 'ai-gateway':
      return settings.aiGatewayEmbeddingModel || 'openai/text-embedding-3-small';
    case 'openrouter':
      return settings.openrouterEmbeddingModel || 'openai/text-embedding-3-small';
  }
}

export { DEFAULT_TOP_K };
