'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { AssistantRuntimeProvider, useLocalRuntime } from '@assistant-ui/react';

import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { indexBook, isBookIndexed } from '@/services/ai/ragService';
import { createTauriAdapter, getLastSources, clearLastSources } from '@/services/ai/adapters';
import { aiLogger } from '@/services/ai/logger';
import type { EmbeddingProgress, AISettings } from '@/services/ai/types';

import { Thread } from '@/components/assistant-ui/thread';
import { Button } from '@/components/ui/button';
import { Loader2Icon, BookOpenIcon, SparklesIcon } from 'lucide-react';

interface AIAssistantProps {
  bookKey: string;
}

// inner component that uses the runtime hook
const AIAssistantChat = ({
  aiSettings,
  bookHash,
  bookTitle,
  authorName,
  currentSection,
}: {
  aiSettings: AISettings;
  bookHash: string;
  bookTitle: string;
  authorName: string;
  currentSection: number;
}) => {
  const [sources, setSources] = useState(getLastSources());

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
  }, []);

  // create adapter with current settings
  const adapter = useMemo(() => {
    if (!aiSettings) return null;
    return createTauriAdapter({
      settings: aiSettings,
      bookHash,
      bookTitle,
      authorName,
      currentSection,
    });
  }, [aiSettings, bookHash, bookTitle, authorName, currentSection]);

  // use LocalRuntime with the adapter
  const runtime = useLocalRuntime(adapter!);

  if (!adapter) {
    return null;
  }

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread sources={sources} onClear={handleClear} />
    </AssistantRuntimeProvider>
  );
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
  const currentSection = progress?.section?.current || 0;
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

  if (!aiSettings?.enabled) {
    return (
      <div className='flex h-full items-center justify-center p-4'>
        <p className='text-sm text-muted-foreground'>{_('Enable AI in Settings')}</p>
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
        <div className='rounded-full bg-primary/10 p-3'>
          <SparklesIcon className='size-6 text-primary' />
        </div>
        <div>
          <h3 className='mb-0.5 text-sm font-medium text-foreground'>{_('Index This Book')}</h3>
          <p className='text-xs text-muted-foreground'>
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
        <Loader2Icon className='size-6 animate-spin text-primary' />
        <div>
          <p className='mb-1 text-sm font-medium text-foreground'>{_('Indexing book...')}</p>
          <p className='text-xs text-muted-foreground'>
            {indexProgress?.phase === 'embedding'
              ? `${indexProgress.current} / ${indexProgress.total} chunks`
              : _('Preparing...')}
          </p>
        </div>
        <div className='h-1.5 w-32 overflow-hidden rounded-full bg-muted'>
          <div
            className='h-full bg-primary transition-all duration-300'
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
      currentSection={currentSection}
    />
  );
};

export default AIAssistant;
