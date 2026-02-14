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
import {
  indexBook,
  isBookIndexed,
  aiStore,
  aiLogger,
  createTauriAdapter,
  getLastSources,
  clearLastSources,
  updateXRayForProgress,
} from '@/services/ai';
import type { EmbeddingProgress, AISettings, AIMessage, IndexingState } from '@/services/ai/types';
import { useEnv } from '@/context/EnvContext';
import { eventDispatcher } from '@/utils/event';

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

// inner component that coordinates history + runtime
const AIAssistantChat = ({
  aiSettings,
  bookHash,
  bookTitle,
  authorName,
  currentPage,
  onResetIndex,
}: {
  aiSettings: AISettings;
  bookHash: string;
  bookTitle: string;
  authorName: string;
  currentPage: number;
  onResetIndex: () => void;
}) => {
  const {
    activeConversationId,
    messages: storedMessages,
    addMessage,
    isLoadingMessages,
  } = useAIChatStore();

  const showHistoryLoading = isLoadingMessages && !!activeConversationId;
  const hasStoredMessages = storedMessages.length > 0;

  if (showHistoryLoading) {
    return <div className='flex-1' />;
  }

  return (
    <AIAssistantRuntime
      key={activeConversationId ?? 'new'}
      aiSettings={aiSettings}
      bookHash={bookHash}
      bookTitle={bookTitle}
      authorName={authorName}
      currentPage={currentPage}
      activeConversationId={activeConversationId}
      storedMessages={storedMessages}
      addMessage={addMessage}
      onResetIndex={onResetIndex}
      isLoadingHistory={isLoadingMessages}
      hasStoredMessages={hasStoredMessages}
    />
  );
};

const AIAssistantRuntime = ({
  aiSettings,
  bookHash,
  bookTitle,
  authorName,
  currentPage,
  activeConversationId,
  storedMessages,
  addMessage,
  onResetIndex,
  isLoadingHistory,
  hasStoredMessages,
}: {
  aiSettings: AISettings;
  bookHash: string;
  bookTitle: string;
  authorName: string;
  currentPage: number;
  activeConversationId: string | null;
  storedMessages: AIMessage[];
  addMessage: (message: Omit<AIMessage, 'id' | 'createdAt'>) => Promise<void>;
  onResetIndex: () => void;
  isLoadingHistory: boolean;
  hasStoredMessages: boolean;
}) => {
  // use a ref to keep up-to-date options without triggering re-renders of the runtime
  const optionsRef = useRef({
    settings: aiSettings,
    bookHash,
    bookTitle,
    authorName,
    currentPage,
  });

  // update ref on every render with latest values
  useEffect(() => {
    optionsRef.current = {
      settings: aiSettings,
      bookHash,
      bookTitle,
      authorName,
      currentPage,
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
      hasStoredMessages={hasStoredMessages}
    />
  );
};

const AIAssistantWithRuntime = ({
  adapter,
  historyAdapter,
  onResetIndex,
  isLoadingHistory,
  hasStoredMessages,
}: {
  adapter: NonNullable<ReturnType<typeof createTauriAdapter>>;
  historyAdapter?: ThreadHistoryAdapter;
  onResetIndex: () => void;
  isLoadingHistory: boolean;
  hasStoredMessages: boolean;
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
        hasStoredMessages={hasStoredMessages}
      />
    </AssistantRuntimeProvider>
  );
};

const ThreadWrapper = ({
  onResetIndex,
  isLoadingHistory,
  hasStoredMessages,
}: {
  onResetIndex: () => void;
  isLoadingHistory: boolean;
  hasStoredMessages: boolean;
}) => {
  const [sources, setSources] = useState(getLastSources());
  const assistantRuntime = useAssistantRuntime();
  const { setActiveConversation } = useAIChatStore();

  useEffect(() => {
    const interval = setInterval(() => {
      setSources(getLastSources());
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const handleClear = useCallback(() => {
    clearLastSources();
    setSources([]);
    setActiveConversation(null);
    assistantRuntime.switchToNewThread();
  }, [assistantRuntime, setActiveConversation]);

  return (
    <Thread
      sources={sources}
      onClear={handleClear}
      onResetIndex={onResetIndex}
      isLoadingHistory={isLoadingHistory}
      hasStoredMessages={hasStoredMessages}
    />
  );
};

const AIAssistant = ({ bookKey }: AIAssistantProps) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const { getBookData } = useBookDataStore();
  const { getProgress } = useReaderStore();
  const bookData = getBookData(bookKey);
  const progress = getProgress(bookKey);

  const [isLoading, setIsLoading] = useState(true);
  const [indexingState, setIndexingState] = useState<IndexingState | null>(null);
  const [indexed, setIndexed] = useState(false);
  const hasAutoRestored = useRef(false);

  const bookHash = bookKey.split('-')[0] || '';
  const bookTitle = bookData?.book?.title || 'Unknown';
  const authorName = bookData?.book?.author || '';
  const currentPage = progress?.pageinfo?.current ?? 0;
  const aiSettings = settings?.aiSettings;
  const { loadConversations, setActiveConversation, createConversation } = useAIChatStore();
  const isIndexing = !indexed && indexingState?.status === 'indexing';
  const indexProgress: EmbeddingProgress | null = indexingState?.phase
    ? {
        current: indexingState.current ?? 0,
        total: indexingState.total ?? 0,
        phase: indexingState.phase,
      }
    : null;

  // check if book is indexed on mount
  useEffect(() => {
    let cancelled = false;
    const loadIndexState = async () => {
      if (!bookHash) {
        setIsLoading(false);
        setIndexingState(null);
        return;
      }
      const [indexedResult, storedState] = await Promise.all([
        isBookIndexed(bookHash),
        aiStore.getIndexingState(bookHash),
      ]);
      if (cancelled) return;
      setIndexed(indexedResult);
      setIndexingState(storedState);
      setIsLoading(false);
    };
    void loadIndexState();

    const handleIndexingUpdate = (event: CustomEvent) => {
      const state = event.detail as IndexingState;
      if (state.bookHash !== bookHash) return;
      setIndexingState(state);
      if (state.status === 'complete') setIndexed(true);
    };

    eventDispatcher.on('rag-indexing-updated', handleIndexingUpdate);

    return () => {
      cancelled = true;
      eventDispatcher.off('rag-indexing-updated', handleIndexingUpdate);
    };
  }, [bookHash]);

  useEffect(() => {
    hasAutoRestored.current = false;
  }, [bookHash]);

  useEffect(() => {
    let cancelled = false;

    const ensureConversation = async () => {
      if (!bookHash || !aiSettings?.enabled) return;

      await loadConversations(bookHash);
      if (cancelled || hasAutoRestored.current) return;

      const { conversations, activeConversationId, currentBookHash, messages } =
        useAIChatStore.getState();

      if (currentBookHash !== bookHash) return;

      const hasValidActive =
        !!activeConversationId && conversations.some((conv) => conv.id === activeConversationId);

      if (hasValidActive) {
        if (activeConversationId && messages.length === 0) {
          await setActiveConversation(activeConversationId);
        }
        hasAutoRestored.current = true;
        return;
      }

      if (conversations.length > 0) {
        const mostRecent = conversations[0];
        if (!mostRecent) return;
        await setActiveConversation(mostRecent.id);
        hasAutoRestored.current = true;
        return;
      }

      await createConversation(bookHash, `Chat about ${bookTitle}`);
      hasAutoRestored.current = true;
    };

    ensureConversation();

    return () => {
      cancelled = true;
    };
  }, [
    bookHash,
    bookTitle,
    aiSettings?.enabled,
    loadConversations,
    setActiveConversation,
    createConversation,
  ]);

  const handleIndex = useCallback(async () => {
    if (!bookData?.bookDoc || !aiSettings) return;
    let indexSucceeded = false;
    try {
      await indexBook(bookData.bookDoc as Parameters<typeof indexBook>[0], bookHash, aiSettings);
      indexSucceeded = true;
    } catch (e) {
      aiLogger.rag.indexError(bookHash, (e as Error).message);
    }

    if (indexSucceeded) {
      setIndexed(true);
    }

    if (indexSucceeded) {
      void updateXRayForProgress({
        bookHash,
        currentPage,
        settings: aiSettings,
        bookTitle,
        appService,
        force: true,
        bookMetadata: bookData?.book?.metadata,
      }).catch((error) => {
        aiLogger.rag.indexError(bookHash, (error as Error).message);
      });
    }
  }, [bookData, bookHash, aiSettings, appService, bookTitle, currentPage]);

  const handleResetIndex = useCallback(async () => {
    if (!appService) return;
    if (!(await appService.ask(_('Are you sure you want to re-index this book?')))) return;
    await aiStore.clearBook(bookHash);
    await aiStore.clearXRayBook(bookHash);
    await aiStore.clearIndexingState(bookHash);
    setIndexed(false);
    setIndexingState(null);
  }, [bookHash, appService, _]);

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
        <div
          className='bg-primary/10 rounded-full p-3'
          style={{
            animation: 'subtleBounce 2.5s ease-in-out infinite',
          }}
        >
          <BookOpenIcon className='text-primary size-6' />
          <style>{`
            @keyframes subtleBounce {
              0%, 100% { transform: translateY(0); }
              50% { transform: translateY(2px); }
            }
          `}</style>
        </div>
        <div>
          <h3 className='text-foreground mb-0.5 text-sm font-medium'>{_('Index This Book')}</h3>
          <p className='text-muted-foreground text-xs'>
            {_('Enable AI chat and X-Ray for this book')}
          </p>
        </div>
        <Button onClick={handleIndex} size='sm' className='h-8 text-xs'>
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

  return (
    <AIAssistantChat
      aiSettings={aiSettings}
      bookHash={bookHash}
      bookTitle={bookTitle}
      authorName={authorName}
      currentPage={currentPage}
      onResetIndex={handleResetIndex}
    />
  );
};

export default AIAssistant;
