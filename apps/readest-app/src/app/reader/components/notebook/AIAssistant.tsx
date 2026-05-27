'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  useAssistantRuntime,
  type ThreadMessage,
  type ThreadHistoryAdapter,
} from '@assistant-ui/react';

import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useAIChatStore } from '@/store/aiChatStore';
import { aiLogger, createTauriAdapter } from '@/services/ai';
import {
  LegacyIdbBackend,
  ReedyBackend,
  ReedySourceStore,
  selectBackend,
  type RetrievalBackend,
  type SourceItem,
} from '@/services/ai/adapters';
import type { EmbeddingProgress, AISettings, AIMessage } from '@/services/ai/types';
import type { RetrievedChunk } from '@/services/reedy/retrieval/BookRetriever';
import { useEnv } from '@/context/EnvContext';
import { isTauriAppPlatform } from '@/services/environment';
import type { AppService } from '@/types/system';
import { ReedyAssistant } from '@/services/reedy/ui/ReedyAssistant';
import type { ReadingContextSnapshot } from '@/services/reedy/tools/builtins/types';

import { Button } from '@/components/ui/button';
import { Loader2Icon, BookOpenIcon } from 'lucide-react';
import { Thread } from '@/components/assistant/Thread';

// Helper function to convert AIMessage array to ExportedMessageRepository format
// Each message needs to be wrapped with { message, parentId } structure
function convertToExportedMessages(
  aiMessages: AIMessage[],
): { message: ThreadMessage; parentId: string | null }[] {
  return aiMessages.map((msg, idx) => {
    const baseMessage = {
      id: msg.id,
      content: [{ type: 'text' as const, text: msg.content }],
      createdAt: new Date(msg.createdAt),
      metadata: { custom: {} },
    };

    // Build role-specific message to satisfy ThreadMessage union type
    const threadMessage: ThreadMessage =
      msg.role === 'user'
        ? ({
            ...baseMessage,
            role: 'user' as const,
            attachments: [] as const,
          } as unknown as ThreadMessage)
        : ({
            ...baseMessage,
            role: 'assistant' as const,
            status: { type: 'complete' as const, reason: 'stop' as const },
          } as unknown as ThreadMessage);

    return {
      message: threadMessage,
      parentId: idx > 0 ? (aiMessages[idx - 1]?.id ?? null) : null,
    };
  });
}

interface AIAssistantProps {
  bookKey: string;
}

// inner component that uses the runtime hook
const AIAssistantChat = ({
  aiSettings,
  bookHash,
  bookTitle,
  authorName,
  currentPage,
  backend,
  sourceStore,
  currentTurnId,
  setCurrentTurnId,
  onSourceClick,
  onResetIndex,
}: {
  aiSettings: AISettings;
  bookHash: string;
  bookTitle: string;
  authorName: string;
  currentPage: number;
  backend: RetrievalBackend;
  sourceStore: ReedySourceStore;
  currentTurnId: string | null;
  setCurrentTurnId: (id: string) => void;
  onSourceClick?: (source: SourceItem) => void;
  onResetIndex: () => void;
}) => {
  const {
    activeConversationId,
    messages: storedMessages,
    addMessage,
    isLoadingHistory,
  } = useAIChatStore();

  // use a ref to keep up-to-date options without triggering re-renders of the runtime
  const optionsRef = useRef({
    settings: aiSettings,
    bookHash,
    bookTitle,
    authorName,
    currentPage,
    backend,
    sourceStore,
    onTurnStart: setCurrentTurnId,
  });

  // update ref on every render with latest values
  useEffect(() => {
    optionsRef.current = {
      settings: aiSettings,
      bookHash,
      bookTitle,
      authorName,
      currentPage,
      backend,
      sourceStore,
      onTurnStart: setCurrentTurnId,
    };
  });

  // create adapter ONCE and keep it stable
  const adapter = useMemo(() => {
    // eslint-disable-next-line react-hooks/refs -- intentional: we read optionsRef inside a deferred callback, not during render
    return createTauriAdapter(() => optionsRef.current);
  }, []);

  // Create history adapter to load/persist messages
  const historyAdapter = useMemo<ThreadHistoryAdapter | undefined>(() => {
    if (!activeConversationId) return undefined;

    return {
      async load() {
        // storedMessages are already loaded by aiChatStore when conversation is selected
        return {
          messages: convertToExportedMessages(storedMessages),
        };
      },
      async append(item) {
        // item is ExportedMessageRepositoryItem - access the actual message via .message
        const msg = item.message;
        // Persist new messages to our store
        if (activeConversationId && msg.role !== 'system') {
          const textContent = msg.content
            .filter(
              (part): part is { type: 'text'; text: string } =>
                'type' in part && part.type === 'text',
            )
            .map((part) => part.text)
            .join('\n');

          if (textContent) {
            await addMessage({
              conversationId: activeConversationId,
              role: msg.role as 'user' | 'assistant',
              content: textContent,
            });
          }
        }
      },
    };
  }, [activeConversationId, storedMessages, addMessage]);

  return (
    <AIAssistantWithRuntime
      adapter={adapter}
      historyAdapter={historyAdapter}
      onResetIndex={onResetIndex}
      isLoadingHistory={isLoadingHistory}
      hasActiveConversation={!!activeConversationId}
      sourceStore={sourceStore}
      currentTurnId={currentTurnId}
      onSourceClick={onSourceClick}
    />
  );
};

const AIAssistantWithRuntime = ({
  adapter,
  historyAdapter,
  onResetIndex,
  isLoadingHistory,
  hasActiveConversation,
  sourceStore,
  currentTurnId,
  onSourceClick,
}: {
  adapter: NonNullable<ReturnType<typeof createTauriAdapter>>;
  historyAdapter?: ThreadHistoryAdapter;
  onResetIndex: () => void;
  isLoadingHistory: boolean;
  hasActiveConversation: boolean;
  sourceStore: ReedySourceStore;
  currentTurnId: string | null;
  onSourceClick?: (source: SourceItem) => void;
}) => {
  const runtime = useLocalRuntime(adapter, {
    adapters: historyAdapter ? { history: historyAdapter } : undefined,
  });

  if (!runtime) return null;

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadWrapper
        onResetIndex={onResetIndex}
        isLoadingHistory={isLoadingHistory}
        hasActiveConversation={hasActiveConversation}
        sourceStore={sourceStore}
        currentTurnId={currentTurnId}
        onSourceClick={onSourceClick}
      />
    </AssistantRuntimeProvider>
  );
};

const ThreadWrapper = ({
  onResetIndex,
  isLoadingHistory,
  hasActiveConversation,
  sourceStore,
  currentTurnId,
  onSourceClick,
}: {
  onResetIndex: () => void;
  isLoadingHistory: boolean;
  hasActiveConversation: boolean;
  sourceStore: ReedySourceStore;
  currentTurnId: string | null;
  onSourceClick?: (source: SourceItem) => void;
}) => {
  const [sources, setSources] = useState<RetrievedChunk[]>(
    currentTurnId ? sourceStore.get(currentTurnId) : [],
  );
  const assistantRuntime = useAssistantRuntime();
  const { setActiveConversation } = useAIChatStore();

  // Subscribe to the active turn's slot in the source store. Replaces the
  // pre-Reedy 500ms poll over a module-global lastSources (per plan §M1.7).
  useEffect(() => {
    if (!currentTurnId) {
      setSources([]);
      return;
    }
    setSources(sourceStore.get(currentTurnId));
    return sourceStore.subscribe(currentTurnId, setSources);
  }, [currentTurnId, sourceStore]);

  const handleClear = useCallback(() => {
    sourceStore.clear();
    setSources([]);
    setActiveConversation(null);
    assistantRuntime.switchToNewThread();
  }, [assistantRuntime, setActiveConversation, sourceStore]);

  return (
    <Thread
      sources={sources}
      onSourceClick={onSourceClick}
      onClear={handleClear}
      onResetIndex={onResetIndex}
      isLoadingHistory={isLoadingHistory}
      hasActiveConversation={hasActiveConversation}
    />
  );
};

/**
 * Phase 4.3 router. Switches between the legacy / Reedy-MVP path
 * (LegacyAIAssistant) and the Phase 4 agent-runtime path
 * (ReedyAgentAssistantBridge) based on aiSettings.reedy.runtime.
 *
 * The split is at component boundary rather than inside one component
 * so hooks always run in stable order on whichever path is rendered.
 */
const AIAssistant = ({ bookKey }: AIAssistantProps) => {
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const { getBookData } = useBookDataStore();
  const bookData = getBookData(bookKey);

  const reedyRuntime = settings?.aiSettings?.reedy?.runtime ?? 'mvp';
  const useAgentRuntime =
    settings?.aiSettings?.enabled === true &&
    settings?.aiSettings?.reedy?.enabled === true &&
    reedyRuntime === 'agent' &&
    !!appService &&
    isTauriAppPlatform() &&
    !!bookData?.bookDoc;

  if (useAgentRuntime) return <ReedyAgentAssistantBridge bookKey={bookKey} />;
  return <LegacyAIAssistant bookKey={bookKey} />;
};

const LegacyAIAssistant = ({ bookKey }: AIAssistantProps) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const { getBookData } = useBookDataStore();
  const { getProgress, getView } = useReaderStore();
  const bookData = getBookData(bookKey);
  const progress = getProgress(bookKey);

  const [isLoading, setIsLoading] = useState(true);
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexProgress, setIndexProgress] = useState<EmbeddingProgress | null>(null);
  const [indexed, setIndexed] = useState(false);
  const [currentTurnId, setCurrentTurnId] = useState<string | null>(null);

  const bookHash = bookKey.split('-')[0] || '';
  const bookTitle = bookData?.book?.title || 'Unknown';
  const authorName = bookData?.book?.author || '';
  const currentPage = progress?.pageinfo?.current ?? 0;
  const aiSettings = settings?.aiSettings;

  // Per-instance source store, plus the active backend chosen via the same
  // selectBackend gate the chat adapter will hit (Reedy on Tauri when
  // enabled; legacy IDB otherwise).
  const sourceStore = useMemo(() => new ReedySourceStore(), []);
  const backend = useMemo<RetrievalBackend | null>(() => {
    if (!aiSettings) return null;
    const legacy = new LegacyIdbBackend(aiSettings);
    const reedy: RetrievalBackend | null =
      appService && isTauriAppPlatform()
        ? new ReedyBackend(appService as AppService, aiSettings)
        : null;
    return selectBackend({ settings: aiSettings, isTauri: isTauriAppPlatform(), legacy, reedy });
  }, [aiSettings, appService]);

  // check if book is indexed on mount
  useEffect(() => {
    if (bookHash && backend) {
      backend.isIndexed(bookHash).then((result) => {
        setIndexed(result);
        setIsLoading(false);
      });
    } else if (!backend) {
      setIsLoading(false);
    } else {
      setIsLoading(false);
    }
  }, [bookHash, backend]);

  const handleIndex = useCallback(async () => {
    if (!bookData?.bookDoc || !aiSettings || !backend) return;
    setIsIndexing(true);
    try {
      await backend.indexBook(bookData.bookDoc, bookHash, { onProgress: setIndexProgress });
      setIndexed(true);
    } catch (e) {
      aiLogger.rag.indexError(bookHash, (e as Error).message);
    } finally {
      setIsIndexing(false);
      setIndexProgress(null);
    }
  }, [bookData?.bookDoc, bookHash, aiSettings]);

  const handleResetIndex = useCallback(async () => {
    if (!appService || !backend) return;
    if (!(await appService.ask(_('Are you sure you want to re-index this book?')))) return;
    await backend.clearBook(bookHash);
    setIndexed(false);
  }, [bookHash, appService, backend, _]);

  // Navigate the reader to a clicked source's CFI. Legacy backend chunks have
  // no CFI so the Thread component renders them as static rows — only Reedy
  // sources are clickable in M1.10.
  const handleSourceClick = useCallback(
    (source: SourceItem) => {
      if (!source.cfi) return;
      getView(bookKey)?.goTo(source.cfi);
    },
    [bookKey, getView],
  );

  if (!aiSettings?.enabled) {
    return (
      <div className='flex h-full items-center justify-center p-4'>
        <p className='text-muted-foreground text-sm'>{_('Enable AI in Settings')}</p>
      </div>
    );
  }

  // show nothing while checking index status to prevent flicker
  if (isLoading) {
    return null;
  }

  const progressPercent =
    indexProgress?.phase === 'embedding' && indexProgress.total > 0
      ? Math.round((indexProgress.current / indexProgress.total) * 100)
      : 0;

  if (!indexed && !isIndexing) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3 p-4 text-center'>
        <div className='bg-primary/10 rounded-full p-3'>
          <BookOpenIcon className='text-primary size-6' />
        </div>
        <div>
          <h3 className='text-foreground mb-0.5 text-sm font-medium'>{_('Index This Book')}</h3>
          <p className='text-muted-foreground text-xs'>
            {_('Enable AI search and chat for this book')}
          </p>
        </div>
        <Button onClick={handleIndex} size='sm' className='h-8 text-xs'>
          <BookOpenIcon className='mr-1.5 size-3.5' />
          {_('Start Indexing')}
        </Button>
      </div>
    );
  }

  if (isIndexing) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3 p-4 text-center'>
        <Loader2Icon className='text-primary size-6 animate-spin' />
        <div>
          <p className='text-foreground mb-1 text-sm font-medium'>{_('Indexing book...')}</p>
          <p className='text-muted-foreground text-xs'>
            {indexProgress?.phase === 'embedding'
              ? `${indexProgress.current} / ${indexProgress.total} chunks`
              : _('Preparing...')}
          </p>
        </div>
        <div className='bg-muted h-1.5 w-32 overflow-hidden rounded-full'>
          <div
            className='bg-primary h-full transition-all duration-300'
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>
    );
  }

  if (!backend) return null;

  return (
    <AIAssistantChat
      aiSettings={aiSettings}
      bookHash={bookHash}
      bookTitle={bookTitle}
      authorName={authorName}
      currentPage={currentPage}
      backend={backend}
      sourceStore={sourceStore}
      currentTurnId={currentTurnId}
      setCurrentTurnId={setCurrentTurnId}
      onSourceClick={handleSourceClick}
      onResetIndex={handleResetIndex}
    />
  );
};

/**
 * Bridge from the notebook AI tab into the Phase 4 ReedyAssistant.
 *
 * Kept separate from AIAssistant so legacy props/state don't leak in
 * and we don't pay the cost of constructing the agent runtime when the
 * user is on the MVP path. The flag check in AIAssistant guarantees this
 * only renders when aiSettings.reedy.runtime === 'agent'.
 */
const ReedyAgentAssistantBridge = ({ bookKey }: AIAssistantProps) => {
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const { getBookData } = useBookDataStore();
  const { getProgress, getView } = useReaderStore();
  const bookData = getBookData(bookKey);
  const progress = getProgress(bookKey);

  const bookHash = bookKey.split('-')[0] || '';
  const aiSettings = settings?.aiSettings;

  const readingContext = useMemo<ReadingContextSnapshot>(
    () => ({
      cfi: progress?.location ?? null,
      sectionIndex: progress?.section?.current ?? 0,
      chapterTitle: progress?.sectionLabel ?? null,
      pageNumber: progress?.pageinfo?.current ?? 0,
    }),
    [progress],
  );

  const handleNavigate = useCallback(
    (cfi: string) => {
      getView(bookKey)?.goTo(cfi);
    },
    [bookKey, getView],
  );

  if (!aiSettings || !appService || !bookData?.bookDoc) return null;

  return (
    <ReedyAssistant
      appService={appService as AppService}
      bookDoc={bookData.bookDoc}
      bookHash={bookHash}
      bookKey={bookKey}
      aiSettings={aiSettings}
      readingContext={readingContext}
      onNavigateToCfi={handleNavigate}
    />
  );
};

export default AIAssistant;
