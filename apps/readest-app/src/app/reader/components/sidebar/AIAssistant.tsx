'use client';

import clsx from 'clsx';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { PiStop, PiTrash, PiX, PiBookOpenText, PiSparkle } from 'react-icons/pi';
import { marked } from 'marked';

import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import {
  createChatSession,
  sendMessage,
  abortGeneration,
  clearSession,
} from '@/services/ai/chatService';
import { indexBook, isBookIndexed } from '@/services/ai/ragService';
import { aiLogger } from '@/services/ai/logger';
import type { ChatSession, EmbeddingProgress, ScoredChunk } from '@/services/ai/types';

interface AIAssistantProps {
  bookKey: string;
}

interface ChatMessageUI {
  role: 'user' | 'assistant';
  content: string;
}

// sources popup modal
const SourcesModal: React.FC<{
  sources: ScoredChunk[];
  onClose: () => void;
}> = ({ sources, onClose }) => (
  <div
    className='fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm'
    onClick={onClose}
  >
    <div
      className='bg-base-100 mx-4 max-h-[70vh] w-full max-w-sm overflow-hidden rounded-xl shadow-xl'
      onClick={(e) => e.stopPropagation()}
    >
      <div className='border-base-300/50 flex items-center justify-between border-b px-4 py-3'>
        <span className='text-base-content/80 text-sm font-medium'>Sources</span>
        <button onClick={onClose} className='btn btn-ghost btn-xs btn-square'>
          <PiX className='h-4 w-4' />
        </button>
      </div>
      <div className='max-h-[50vh] space-y-2 overflow-y-auto p-3'>
        {sources.map((src, i) => (
          <div key={i} className='bg-base-200/60 border-base-300/30 rounded-lg border p-3'>
            <div className='text-primary/80 mb-1 text-xs font-medium'>{src.chapterTitle}</div>
            <p className='text-base-content/70 line-clamp-4 text-xs leading-relaxed'>{src.text}</p>
          </div>
        ))}
      </div>
    </div>
  </div>
);

const AIAssistant: React.FC<AIAssistantProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { settings } = useSettingsStore();
  const { getBookData } = useBookDataStore();
  const { getProgress } = useReaderStore();
  const bookData = getBookData(bookKey);
  const progress = getProgress(bookKey);

  const [session, setSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessageUI[]>([]);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexProgress, setIndexProgress] = useState<EmbeddingProgress | null>(null);
  const [indexed, setIndexed] = useState(false);
  const [lastSources, setLastSources] = useState<ScoredChunk[]>([]);
  const [showSources, setShowSources] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamingRef = useRef(''); // ref to track streaming content in callbacks

  const bookHash = bookKey.split('-')[0] || '';
  const bookTitle = bookData?.book?.title || 'Unknown';
  const authorName = bookData?.book?.author || '';
  const currentSection = progress?.section?.current || 0;
  const aiSettings = settings.aiSettings;

  useEffect(() => {
    if (bookHash) {
      aiLogger.chat.send(0, false);
      setSession(createChatSession(bookKey, bookHash));
      isBookIndexed(bookHash).then(setIndexed);
    }
  }, [bookKey, bookHash]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  const handleIndex = useCallback(async () => {
    if (!bookData?.bookDoc || !aiSettings) return;
    setIsIndexing(true);
    setError(null);
    try {
      await indexBook(
        bookData.bookDoc as Parameters<typeof indexBook>[0],
        bookHash,
        aiSettings,
        setIndexProgress,
      );
      setIndexed(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsIndexing(false);
      setIndexProgress(null);
    }
  }, [bookData?.bookDoc, bookHash, aiSettings]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || !session || !aiSettings || isGenerating) return;
    const userInput = input.trim();
    setInput('');
    setError(null);
    setIsGenerating(true);
    setStreamingContent('');
    setMessages((prev) => [...prev, { role: 'user', content: userInput }]);

    try {
      streamingRef.current = '';
      await sendMessage(
        session,
        userInput,
        aiSettings,
        bookTitle,
        authorName,
        currentSection,
        (token) => {
          streamingRef.current += token;
          setStreamingContent(streamingRef.current);
        },
        (sources) => {
          const finalContent = streamingRef.current;
          setMessages((prev) => [...prev, { role: 'assistant', content: finalContent }]);
          setLastSources(sources);
          streamingRef.current = '';
          setStreamingContent('');
          setIsGenerating(false);
        },
        (e) => {
          setError(e.message);
          setIsGenerating(false);
          setStreamingContent('');
          streamingRef.current = '';
        },
      );
    } catch (e) {
      setError((e as Error).message);
      setIsGenerating(false);
    }
  }, [
    input,
    session,
    aiSettings,
    isGenerating,
    bookTitle,
    authorName,
    currentSection,
    streamingContent,
  ]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // disabled state
  if (!aiSettings?.enabled) {
    return (
      <div className='flex h-full items-center justify-center p-4'>
        <p className='text-base-content/50 text-xs'>{_('Enable AI in Settings')}</p>
      </div>
    );
  }

  const progressPercent =
    indexProgress?.phase === 'embedding' && indexProgress.total > 0
      ? Math.round((indexProgress.current / indexProgress.total) * 100)
      : 0;

  // needs indexing
  if (!indexed && !isIndexing) {
    return (
      <div className='flex h-full flex-col items-center justify-center p-6 text-center'>
        <PiSparkle className='text-primary/50 mb-3 h-8 w-8' />
        <p className='text-base-content/70 mb-3 text-sm'>{_('Index this book first')}</p>
        <button className='btn btn-primary btn-sm' onClick={handleIndex}>
          {_('Index')}
        </button>
      </div>
    );
  }

  // indexing
  if (isIndexing) {
    return (
      <div className='flex h-full flex-col items-center justify-center p-6 text-center'>
        <div className='loading loading-spinner loading-md text-primary mb-3' />
        <p className='text-base-content/70 mb-2 text-xs'>{_('Indexing...')}</p>
        <div className='bg-base-200 h-1 w-32 overflow-hidden rounded-full'>
          <div
            className='bg-primary h-full transition-all'
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>
    );
  }

  // chat UI
  return (
    <div className='flex h-full flex-col'>
      {showSources && <SourcesModal sources={lastSources} onClose={() => setShowSources(false)} />}

      {/* messages */}
      <div className='flex-1 space-y-2 overflow-y-auto p-2'>
        {messages.length === 0 && !streamingContent && (
          <div className='flex h-full items-center justify-center'>
            <p className='text-base-content/30 text-xs'>{_('Ask about this book')}</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={clsx('text-sm', msg.role === 'user' ? 'text-right' : '')}>
            <div
              className={clsx(
                'inline-block max-w-[90%] rounded-lg px-3 py-2',
                msg.role === 'user'
                  ? 'bg-primary text-primary-content'
                  : 'bg-base-200 text-base-content',
              )}
            >
              {msg.role === 'assistant' ? (
                <div
                  className='prose prose-sm dark:prose-invert prose-p:my-1 prose-ul:my-1 max-w-none'
                  dangerouslySetInnerHTML={{ __html: marked(msg.content) as string }}
                />
              ) : (
                msg.content
              )}
            </div>
          </div>
        ))}

        {/* streaming */}
        {streamingContent && (
          <div className='text-sm'>
            <div className='bg-base-200 text-base-content inline-block max-w-[90%] rounded-lg px-3 py-2'>
              <div
                className='prose prose-sm dark:prose-invert prose-p:my-1 max-w-none'
                dangerouslySetInnerHTML={{ __html: marked(streamingContent) as string }}
              />
            </div>
          </div>
        )}

        {/* thinking */}
        {isGenerating && !streamingContent && (
          <div className='text-sm'>
            <div className='bg-base-200 inline-block rounded-lg px-3 py-2'>
              <span className='loading loading-dots loading-xs' />
            </div>
          </div>
        )}

        {error && <div className='text-error px-2 text-xs'>{error}</div>}
        <div ref={messagesEndRef} />
      </div>

      {/* sources button */}
      {lastSources.length > 0 && !isGenerating && (
        <button
          onClick={() => setShowSources(true)}
          className='text-primary/70 hover:text-primary mx-2 mb-1 flex items-center gap-1.5 text-xs'
        >
          <PiBookOpenText className='h-3.5 w-3.5' />
          <span>{lastSources.length} sources</span>
        </button>
      )}

      {/* input - minimal auto-expanding */}
      <div className='p-2'>
        <div className='border-base-300/50 bg-base-200/30 flex items-end gap-2 rounded-2xl border px-3 py-2'>
          <textarea
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
            }}
            onKeyDown={handleKeyDown}
            placeholder={_('Ask...')}
            className='placeholder:text-base-content/30 flex-1 resize-none bg-transparent text-sm leading-snug focus:outline-none'
            style={{ minHeight: '24px', maxHeight: '120px' }}
            rows={1}
            disabled={isGenerating}
          />
          {messages.length > 0 && !isGenerating && (
            <button
              className='text-base-content/40 hover:text-base-content shrink-0 transition-colors'
              onClick={() => {
                if (session) clearSession(session);
                setMessages([]);
                setLastSources([]);
              }}
            >
              <PiTrash className='h-4 w-4' />
            </button>
          )}
          {isGenerating ? (
            <button
              className='text-error/70 hover:text-error shrink-0 transition-colors'
              onClick={() => {
                if (session) abortGeneration(session);
                setIsGenerating(false);
              }}
            >
              <PiStop className='h-5 w-5' />
            </button>
          ) : (
            <button
              className='bg-base-content text-base-100 flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-opacity disabled:opacity-30'
              onClick={handleSend}
              disabled={!input.trim()}
            >
              <svg
                className='h-4 w-4'
                fill='none'
                stroke='currentColor'
                strokeWidth='2.5'
                viewBox='0 0 24 24'
              >
                <path strokeLinecap='round' strokeLinejoin='round' d='M5 15l7-7 7 7' />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default AIAssistant;
