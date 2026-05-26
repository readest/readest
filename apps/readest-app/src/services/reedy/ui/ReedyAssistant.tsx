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
  createSearchBookMemoryTool,
  createSearchSessionMemoryTool,
  createSearchUserMemoryTool,
  createWriteBookMemoryTool,
  createWriteUserMemoryTool,
  type ReadingContextSnapshot,
} from '../tools/builtins';
import {
  DEFAULT_POLICY,
  createBookMemoryLayer,
  createPolicyLayer,
  createReadingLayer,
  createSkillLayer,
  createToolCatalogLayer,
  createUserMemoryLayer,
  type SkillInstructions,
} from '../context';
import { MemoryService } from '../memory/MemoryService';
import { SkillRegistry } from '../skills/SkillRegistry';
import type { Skill } from '../skills/types';
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
  /** Stable id for the current user (used as the scope_key for user memory). */
  userId?: string;
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
  userId = 'local',
  onNavigateToCfi,
}: ReedyAssistantProps) {
  const models = useMemo(() => createReedyModels(aiSettings), [aiSettings]);

  // Lazily open reedy.db on first mount. The promise resolves once and
  // we share the same ReedyDb + Indexer + Retriever + MemoryService +
  // SkillRegistry for the lifetime of this component instance. The
  // skill registry is seeded on first init() with the 3 builtins; on
  // subsequent mounts the call is a no-op.
  const [reedy, setReedy] = useState<{
    db: ReedyDb;
    indexer: BookIndexer;
    retriever: BookRetriever;
    memory: MemoryService;
    skills: SkillRegistry;
  } | null>(null);
  const [availableSkills, setAvailableSkills] = useState<Skill[]>([]);
  useEffect(() => {
    let alive = true;
    void appService
      .openDatabase('reedy', 'reedy.db', 'Data', { experimental: ['index_method'] })
      .then(async (svc) => {
        if (!alive) return;
        const db = new ReedyDb(svc);
        const skills = new SkillRegistry(svc);
        await skills.init();
        const memory = new MemoryService(db, models.embedding);
        const enabledSkills = await skills.listEnabled();
        if (!alive) return;
        setReedy({
          db,
          indexer: new BookIndexer(db),
          retriever: new BookRetriever(db),
          memory,
          skills,
        });
        setAvailableSkills(enabledSkills);
      })
      .catch((err) => {
        console.error('[Reedy] failed to open reedy.db', err);
      });
    return () => {
      alive = false;
    };
  }, [appService, models.embedding]);

  // Active skill selection — null means no skill (the model gets the
  // default Policy + Reading + ToolCatalog system prompt).
  const [activeSkillId, setActiveSkillId] = useState<string | null>(null);
  const activeSkill = useMemo<Skill | null>(
    () => availableSkills.find((s) => s.id === activeSkillId) ?? null,
    [availableSkills, activeSkillId],
  );

  // Snapshot the reading context in a ref so the tool factories don't
  // re-render the registry on every page turn.
  const readingRef = useRef(readingContext);
  useEffect(() => {
    readingRef.current = readingContext;
  }, [readingContext]);

  // Active-skill state is read via a ref inside the SkillLayer's
  // resolution so the runtime memo doesn't have to rebuild on every
  // chip click. The layer captures the closure once; the closure peeks
  // at the ref at prompt-build time.
  const activeSkillRef = useRef<SkillInstructions | null>(null);
  useEffect(() => {
    activeSkillRef.current = activeSkill
      ? { id: activeSkill.id, instructions: activeSkill.instructions }
      : null;
  }, [activeSkill]);

  // Build the tool registry + runtime once per (reedy ready, model)
  // pair. The userId and bookHash flow through the memory tool factories
  // so each tool dispatches under the right scope_key.
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
    // Memory tools (Phase 3.1) — bookHash scopes book memory; userId
    // scopes user memory; sessionId mirrors the runtime's per-turn
    // sessionId which we set to bookHash today (sessions are
    // book-scoped in this build).
    reg.register(createSearchBookMemoryTool({ service: reedy.memory, scopeKey: () => bookHash }));
    reg.register(createWriteBookMemoryTool({ service: reedy.memory, scopeKey: () => bookHash }));
    reg.register(createSearchUserMemoryTool({ service: reedy.memory, scopeKey: () => userId }));
    reg.register(createWriteUserMemoryTool({ service: reedy.memory, scopeKey: () => userId }));
    reg.register(
      createSearchSessionMemoryTool({ service: reedy.memory, scopeKey: () => bookHash }),
    );

    const layers = [
      createPolicyLayer(DEFAULT_POLICY),
      // Use a tiny wrapper so the SkillLayer resolves the *current*
      // active skill each time the runtime rebuilds the prompt.
      ((): ReturnType<typeof createSkillLayer> => {
        const snapshot = activeSkillRef.current;
        return createSkillLayer(snapshot);
      })(),
      createReadingLayer(readingRef.current),
      createToolCatalogLayer(reg.list()),
      createBookMemoryLayer(() => ''),
      createUserMemoryLayer(() => ''),
    ];

    return new AgentRuntime({ model: models.chat, tools: reg, layers });
  }, [reedy, models.chat, models.embedding, bookHash, userId]);

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
      void send({
        sessionId: bookHash,
        bookHash,
        userMessage: text,
        toolAllowlist: activeSkill?.toolAllowlist ?? null,
      });
    },
    [runtime, send, bookHash, activeSkill],
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
      <Composer
        isRunning={isRunning}
        onSend={handleSend}
        onAbort={abort}
        skills={availableSkills.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
        }))}
        activeSkillId={activeSkillId}
        onSkillSelect={setActiveSkillId}
      />
    </div>
  );
}
