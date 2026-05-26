'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppService } from '@/types/system';
import type { BookDoc } from '@/libs/document';
import type { AISettings } from '@/services/ai/types';
import { AgentRuntime } from '../runtime/AgentRuntime';
import { BookIndexer } from '../retrieval/BookIndexer';
import { BookRetriever } from '../retrieval/BookRetriever';
import { ReedyDb } from '../db/ReedyDb';
import { createReedyModels } from '../models/registry';
import { ToolRegistry } from '../tools/ToolRegistry';
import {
  createAddCitationTool,
  createGetReadingContextTool,
  createGetSelectionTool,
  createLookupPassageTool,
  type ReadingContextSnapshot,
} from '../tools/builtins';
import {
  DEFAULT_POLICY,
  createPolicyLayer,
  createReadingLayer,
  createSkillLayer,
  createToolCatalogLayer,
} from '../context';
import { useReedyStore } from '../store/reedyStore';
import { useReedyTurn } from './useReedyTurn';
import { AgentThread } from './AgentThread';
import { Composer } from './Composer';
import { IndexingStatus, type IndexingPhase } from './IndexingStatus';

export interface ReedyAssistantProps {
  appService: AppService;
  bookDoc: BookDoc;
  bookHash: string;
  bookKey: string;
  aiSettings: AISettings;
  readingContext: ReadingContextSnapshot;
  /** Wired by the notebook to `getView(bookKey)?.goTo(cfi)` on click. */
  onNavigateToCfi?: (cfi: string) => void;
}

/**
 * Top-level entrypoint mounted by the notebook AI tab when
 * `aiSettings.reedy.runtime === 'agent'` (Phase 4.3).
 *
 * Constructs ReedyDb / BookIndexer / BookRetriever / tool registry /
 * AgentRuntime from the per-book deps and renders the indexing status
 * → AgentThread → Composer flow. The legacy MVP path stays at the
 * notebook level under the same flag's 'mvp' value.
 */
export function ReedyAssistant({
  appService,
  bookDoc,
  bookHash,
  aiSettings,
  readingContext,
  onNavigateToCfi,
}: ReedyAssistantProps) {
  const models = useMemo(() => createReedyModels(aiSettings), [aiSettings]);

  // Lazily open reedy.db on first mount. The promise resolves once and
  // we share the same ReedyDb + Indexer + Retriever for the lifetime of
  // this component instance.
  const [reedy, setReedy] = useState<{
    db: ReedyDb;
    indexer: BookIndexer;
    retriever: BookRetriever;
  } | null>(null);
  useEffect(() => {
    let alive = true;
    void appService
      .openDatabase('reedy', 'reedy.db', 'Data', { experimental: ['index_method'] })
      .then((svc) => {
        if (!alive) return;
        const db = new ReedyDb(svc);
        setReedy({ db, indexer: new BookIndexer(db), retriever: new BookRetriever(db) });
      })
      .catch((err) => {
        console.error('[Reedy] failed to open reedy.db', err);
      });
    return () => {
      alive = false;
    };
  }, [appService]);

  // Snapshot the reading context in a ref so the tool factories don't
  // re-render the registry on every page turn.
  const readingRef = useRef(readingContext);
  useEffect(() => {
    readingRef.current = readingContext;
  }, [readingContext]);

  // Build the tool registry + runtime once per (reedy ready, model) pair.
  const runtime = useMemo(() => {
    if (!reedy) return null;
    const reg = new ToolRegistry();
    reg.register(createGetReadingContextTool(() => readingRef.current));
    reg.register(createGetSelectionTool(() => readingRef.current.selection ?? null));
    reg.register(
      createLookupPassageTool({
        bookHash,
        retriever: reedy.retriever,
        activeEmbeddingModel: models.embedding,
      }),
    );
    reg.register(
      createAddCitationTool(() => {
        // Citation side-channel — the runtime synthesizes a citation
        // event from the lookupPassage tool result, so addCitation
        // just acks. A future enhancement could push directly into
        // the store via a closure here.
      }),
    );

    const layers = [
      createPolicyLayer(DEFAULT_POLICY),
      createSkillLayer(null),
      createReadingLayer(readingRef.current),
      createToolCatalogLayer(reg.list()),
    ];

    return new AgentRuntime({ model: models.chat, tools: reg, layers });
  }, [reedy, models.chat, models.embedding, bookHash]);

  const messages = useReedyStore((s) => s.messages);
  const isRunning = useReedyStore((s) => s.isRunning);
  const resetStore = useReedyStore((s) => s.reset);
  const { send, abort } = useReedyTurn(runtime);

  // Indexing state — tracked locally to avoid layering yet another store.
  const [indexingPhase, setIndexingPhase] = useState<IndexingPhase>('idle');
  const [indexProgress, setIndexProgress] = useState<{
    pct: number;
    current: number;
    total: number;
  } | null>(null);

  useEffect(() => {
    if (!reedy || !bookHash) return;
    let alive = true;
    void reedy.db.getBookMeta(bookHash).then((meta) => {
      if (!alive) return;
      if (!meta) setIndexingPhase('idle');
      else if (meta.indexingStatus === 'indexed') setIndexingPhase('indexed');
      else if (meta.indexingStatus === 'empty_index') setIndexingPhase('empty');
      else if (meta.indexingStatus === 'failed') setIndexingPhase('failed');
      else setIndexingPhase('idle');
    });
    return () => {
      alive = false;
    };
  }, [reedy, bookHash]);

  // Reset the conversation log when the book or session changes.
  useEffect(() => {
    resetStore();
  }, [bookHash, resetStore]);

  const handleIndex = useCallback(async () => {
    if (!reedy) return;
    setIndexingPhase('indexing');
    try {
      await reedy.indexer.indexBook(bookDoc, bookHash, models.embedding, {
        onProgress: (e) => {
          if (e.phase === 'embedding' && e.total > 0) {
            setIndexProgress({
              pct: Math.round((e.current / e.total) * 100),
              current: e.current,
              total: e.total,
            });
          }
        },
      });
      const meta = await reedy.db.getBookMeta(bookHash);
      setIndexingPhase(
        meta?.indexingStatus === 'empty_index'
          ? 'empty'
          : meta?.indexingStatus === 'indexed'
            ? 'indexed'
            : 'failed',
      );
    } catch (err) {
      console.error('[Reedy] index failed', err);
      setIndexingPhase('failed');
    } finally {
      setIndexProgress(null);
    }
  }, [reedy, bookDoc, bookHash, models.embedding]);

  const handleSend = useCallback(
    (text: string) => {
      if (!runtime) return;
      void send({ sessionId: bookHash, bookHash, userMessage: text });
    },
    [runtime, send, bookHash],
  );

  if (!aiSettings.enabled) {
    return (
      <div className='flex h-full items-center justify-center p-4'>
        <p className='text-base-content/60 text-sm'>Enable AI in Settings</p>
      </div>
    );
  }

  if (!reedy) {
    return (
      <div className='flex h-full items-center justify-center p-4'>
        <p className='text-base-content/60 text-sm'>Loading Reedy…</p>
      </div>
    );
  }

  if (indexingPhase !== 'indexed') {
    return (
      <IndexingStatus
        status={indexingPhase}
        progressPercent={indexProgress?.pct}
        chunkProgress={
          indexProgress ? { current: indexProgress.current, total: indexProgress.total } : undefined
        }
        onIndex={handleIndex}
        onReindex={handleIndex}
      />
    );
  }

  return (
    <div className='reedy-agent-shell flex h-full w-full flex-col'>
      <div className='min-h-0 flex-1'>
        <AgentThread
          messages={messages}
          isRunning={isRunning}
          onSourceClick={onNavigateToCfi}
          emptyState={
            <div className='text-base-content/60 px-6 text-center text-sm'>
              Ask anything about this book.
            </div>
          }
        />
      </div>
      <Composer isRunning={isRunning} onSend={handleSend} onAbort={abort} />
    </div>
  );
}
