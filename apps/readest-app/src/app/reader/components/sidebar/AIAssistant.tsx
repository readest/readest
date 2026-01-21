'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  useAssistantRuntime,
} from '@assistant-ui/react';

import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import {
  indexBook,
  isBookIndexed,
  aiStore,
  aiLogger,
  createTauriAdapter,
  getLastSources,
  clearLastSources,
} from '@/services/ai';
import type { EmbeddingProgress, AISettings } from '@/services/ai/types';

import { Thread } from '@/components/assistant-ui/thread';
import { Button } from '@/components/ui/button';
import { Loader2Icon, BookOpenIcon } from 'lucide-react';

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
  onResetIndex,
}: {
  aiSettings: AISettings;
  bookHash: string;
  bookTitle: string;
  authorName: string;
  currentPage: number;
  onResetIndex: () => void;
}) => {
  // create adapter with current settings
  const adapter = useMemo(() => {
    if (!aiSettings) return null;
    return createTauriAdapter({
      settings: aiSettings,
      bookHash,
      bookTitle,
      authorName,
      currentPage,
    });
  }, [aiSettings, bookHash, bookTitle, authorName, currentPage]);

  // guard: return early if no adapter (prevents calling useLocalRuntime with null)
  if (!adapter) {
    return null;
  }

  return <AIAssistantWithRuntime adapter={adapter} onResetIndex={onResetIndex} />;
};

// separate component to ensure useLocalRuntime is always called with a valid adapter
const AIAssistantWithRuntime = ({
  adapter,
  onResetIndex,
}: {
  adapter: NonNullable<ReturnType<typeof createTauriAdapter>>;
  onResetIndex: () => void;
}) => {
  const runtime = useLocalRuntime(adapter);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadWrapper onResetIndex={onResetIndex} />
    </AssistantRuntimeProvider>
  );
};

// inner component that uses useAssistantRuntime (must be inside provider)
const ThreadWrapper = ({ onResetIndex }: { onResetIndex: () => void }) => {
  const [sources, setSources] = useState(getLastSources());
  const assistantRuntime = useAssistantRuntime();

  // poll for sources updates (adapter stores them)
  useEffect(() => {
    const interval = setInterval(() => {
      setSources(getLastSources());
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const handleClear = useCallback(() => {
    clearLastSources();
    setSources([]);
    assistantRuntime.switchToNewThread();
  }, [assistantRuntime]);

  return <Thread sources={sources} onClear={handleClear} onResetIndex={onResetIndex} />;
};

const AIAssistant = ({ bookKey }: AIAssistantProps) => {
  const _ = useTranslation();
  const { settings } = useSettingsStore();
  const { getBookData } = useBookDataStore();
  const { getProgress } = useReaderStore();
  const bookData = getBookData(bookKey);
  const progress = getProgress(bookKey);

  const [isLoading, setIsLoading] = useState(true);
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexProgress, setIndexProgress] = useState<EmbeddingProgress | null>(null);
  const [indexed, setIndexed] = useState(false);

  const bookHash = bookKey.split('-')[0] || '';
  const bookTitle = bookData?.book?.title || 'Unknown';
  const authorName = bookData?.book?.author || '';
  const currentPage = progress?.pageinfo?.current ?? 0;
  const aiSettings = settings?.aiSettings;

  // check if book is indexed on mount
  useEffect(() => {
    if (bookHash) {
      isBookIndexed(bookHash).then((result) => {
        setIndexed(result);
        setIsLoading(false);
      });
    } else {
      setIsLoading(false);
    }
  }, [bookHash]);

  const handleIndex = useCallback(async () => {
    if (!bookData?.bookDoc || !aiSettings) return;
    setIsIndexing(true);
    try {
      await indexBook(
        bookData.bookDoc as Parameters<typeof indexBook>[0],
        bookHash,
        aiSettings,
        setIndexProgress,
      );
      setIndexed(true);
    } catch (e) {
      aiLogger.rag.indexError(bookHash, (e as Error).message);
    } finally {
      setIsIndexing(false);
      setIndexProgress(null);
    }
  }, [bookData?.bookDoc, bookHash, aiSettings]);

  const handleResetIndex = useCallback(async () => {
    if (!window.confirm('Are you sure you want to re-index this book?')) return;
    await aiStore.clearBook(bookHash);
    setIndexed(false);
  }, [bookHash]);

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
