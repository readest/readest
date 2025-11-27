import clsx from 'clsx';
import React, { useCallback, useEffect, useRef } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { ActiveSnippet, useAIChatStore } from '@/store/aiChatStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useThemeStore } from '@/store/themeStore';
import { DragKey, useDrag } from '@/hooks/useDrag';
import { Overlay } from '@/components/Overlay';
import useShortcuts from '@/hooks/useShortcuts';
import { createSystemPrompt, sendChatMessage } from '@/services/openaiService';
import {
  AIChatService,
  AIConversation,
  AIChatMessage as AIChatMessageType,
} from '@/services/aiChatService';
import { getCurrentPageText, getCurrentChapterText } from '@/utils/bookText';
import { uniqueId } from '@/utils/misc';
import AIChatHeader from './AIChatHeader';
import AIChatMessage from './AIChatMessage';
import AIChatInput from './AIChatInput';
import SnippetSelector from './SnippetSelector';
import SpeechConversationTrigger from './SpeechConversationTrigger';
import SpeechConversationStatus from './SpeechConversationStatus';
import { RealtimeSpeechService } from '@/services/realtimeSpeechService';

const MIN_AI_CHAT_WIDTH = 0.2;
const MAX_AI_CHAT_WIDTH = 0.5;

const AIChatPanel: React.FC = () => {
  const _ = useTranslation();
  const { updateAppTheme, safeAreaInsets } = useThemeStore();
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const { sideBarBookKey } = useSidebarStore();
  const {
    aiChatWidth,
    isAIChatVisible,
    isAIChatPinned,
    currentConversationId,
    conversations,
    activeSnippet,
    isLoading,
    error,
    isSpeechModeActive,
    isRecording,
    setAIChatVisible,
    toggleAIChatPin,
    setAIChatWidth,
    setActiveSnippet,
    setCurrentConversationId,
    addMessage,
    createConversation,
    loadConversations,
    setConversations,
    setLoading,
    setError,
    startSpeechConversation,
    stopSpeechConversation,
    setRecording,
  } = useAIChatStore();
  const { getBookData } = useBookDataStore();
  const { getView, getProgress, getViewSettings } = useReaderStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const speechServiceRef = useRef<RealtimeSpeechService | null>(null);

  const currentConversation = conversations.find((c) => c.id === currentConversationId) || null;
  const apiKey = settings.globalReadSettings.openaiApiKey;

  useEffect(() => {
    if (appService) loadConversations(appService);
  }, [appService, loadConversations]);
  useEffect(() => {
    if (activeSnippet && activeSnippet.bookKey !== sideBarBookKey) {
      setActiveSnippet(null);
      setCurrentConversationId(null);
      setError(null);
    }
  }, [activeSnippet, sideBarBookKey, setActiveSnippet, setCurrentConversationId, setError]);

  useEffect(() => {
    updateAppTheme(isAIChatVisible ? 'base-200' : 'base-100');
  }, [isAIChatVisible, updateAppTheme]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentConversation?.messages]);

  useEffect(() => {
    return () => {
      speechServiceRef.current?.disconnect().catch(() => {});
    };
  }, []);

  const handleHideAIChat = useCallback(() => {
    if (!isAIChatPinned) {
      setAIChatVisible(false);
      setActiveSnippet(null);
      setCurrentConversationId(null);
    }
  }, [isAIChatPinned, setAIChatVisible, setActiveSnippet, setCurrentConversationId]);

  useShortcuts({ onEscape: handleHideAIChat }, [handleHideAIChat]);

  const handleClickOverlay = () => {
    setAIChatVisible(false);
    setActiveSnippet(null);
    setCurrentConversationId(null);
  };

  const handleSelectContent = async (type: 'page' | 'chapter') => {
    if (!sideBarBookKey || !appService) return;
    const view = getView(sideBarBookKey);
    const bookData = getBookData(sideBarBookKey);
    const progress = type === 'chapter' ? getProgress(sideBarBookKey) : null;

    if (!view || !bookData?.book || (type === 'chapter' && !progress)) return;

    setLoading(true);
    try {
      const text =
        type === 'page'
          ? await getCurrentPageText(sideBarBookKey, view)
          : await getCurrentChapterText(sideBarBookKey, view, progress!);

      if (text) {
        const snippetPayload: ActiveSnippet = {
          text,
          type,
          bookKey: sideBarBookKey,
          bookTitle: bookData.book.title,
          bookAuthor: bookData.book.author,
        };
        setActiveSnippet(snippetPayload);
        await handleCreateConversation(snippetPayload);
      } else {
        setError(_(`No content found in the current ${type}.`));
      }
    } catch {
      setError(_(`Failed to extract ${type} text`));
    } finally {
      setLoading(false);
    }
  };

  const handleCreateConversation = async (snippet: ActiveSnippet): Promise<string | null> => {
    if (!appService) return null;

    const conversation: AIConversation = {
      id: uniqueId(),
      bookKey: snippet.bookKey,
      bookTitle: snippet.bookTitle,
      bookAuthor: snippet.bookAuthor,
      snippet: snippet.text,
      snippetType: snippet.type,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await createConversation(conversation);
    setCurrentConversationId(conversation.id);
    return conversation.id;
  };

  const ensureConversation = async (): Promise<string | null> => {
    if (currentConversationId) return currentConversationId;
    if (!activeSnippet) return null;
    return handleCreateConversation(activeSnippet);
  };

  const handleSendMessage = async (messageText: string) => {
    if (!apiKey || !activeSnippet) {
      setError(_('OpenAI API key is not configured. Please add your API key in Settings > AI.'));
      return;
    }

    const conversationId = await ensureConversation();
    if (!conversationId) {
      setError(_('Failed to create conversation. Please try again.'));
      return;
    }

    const userMessage: AIChatMessageType = {
      role: 'user',
      content: messageText,
      timestamp: Date.now(),
    };
    await addMessage(conversationId, userMessage);
    setLoading(true);
    setError(null);

    try {
      let conversation = conversations.find((c) => c.id === conversationId);
      if (!conversation && appService) {
        const chatService = new AIChatService(appService);
        const allConversations = await chatService.loadConversations();
        setConversations(allConversations);
        conversation = allConversations.find((c) => c.id === conversationId);
      }

      if (!conversation) {
        setError(_('Conversation not found. Please try again.'));
        return;
      }

      const systemPrompt = createSystemPrompt(
        activeSnippet.bookTitle,
        activeSnippet.bookAuthor,
        activeSnippet.text,
      );
      const response = await sendChatMessage(
        apiKey,
        [...conversation.messages, userMessage],
        systemPrompt,
      );

      if (response.error) {
        setError(response.error);
        return;
      }

      await addMessage(conversationId, {
        role: 'assistant',
        content: response.content,
        timestamp: Date.now(),
      });
    } catch {
      setError(_('Failed to send message. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const onDragMove = (data: { clientX: number }) => {
    const widthFraction = 1 - data.clientX / window.innerWidth;
    const newWidth = Math.max(MIN_AI_CHAT_WIDTH, Math.min(MAX_AI_CHAT_WIDTH, widthFraction));
    setAIChatWidth(`${Math.round(newWidth * 10000) / 100}%`);
  };

  const onDragKeyDown = (data: { key: DragKey; step: number }) => {
    const currentWidth = parseFloat(aiChatWidth) / 100;
    let newWidth = currentWidth;
    if (data.key === 'ArrowLeft') newWidth = Math.max(MIN_AI_CHAT_WIDTH, currentWidth + data.step);
    else if (data.key === 'ArrowRight')
      newWidth = Math.min(MAX_AI_CHAT_WIDTH, currentWidth - data.step);
    setAIChatWidth(`${Math.round(newWidth * 10000) / 100}%`);
  };

  const { handleDragStart, handleDragKeyDown } = useDrag(onDragMove, onDragKeyDown);

  const handleStartSpeechConversation = async () => {
    if (!apiKey || !activeSnippet) {
      setError(_('OpenAI API key is not configured. Please add your API key in Settings > AI.'));
      return;
    }

    try {
      const conversationId = await ensureConversation();
      if (!conversationId) {
        setError(_('Failed to create conversation. Please try again.'));
        return;
      }

      const systemPrompt = createSystemPrompt(
        activeSnippet.bookTitle,
        activeSnippet.bookAuthor,
        activeSnippet.text,
      );
      const service = new RealtimeSpeechService(apiKey, {
        onTranscript: async (text, role) => {
          await addMessage(conversationId, { role, content: text, timestamp: Date.now() });
        },
        onError: setError,
        onConnectionStateChange: (connected) => {
          if (!connected) stopSpeechConversation();
        },
        onRecordingStateChange: setRecording,
      });

      speechServiceRef.current = service;
      await service.connect(systemPrompt);
      await service.startRecording();
      startSpeechConversation(conversationId);
      setError(null);
    } catch {
      setError(_('Failed to start voice conversation. Please try again.'));
      await speechServiceRef.current?.disconnect();
      speechServiceRef.current = null;
    }
  };

  const handleStopSpeechConversation = async () => {
    await speechServiceRef.current?.disconnect();
    speechServiceRef.current = null;
    stopSpeechConversation();
  };

  if (!sideBarBookKey) return null;

  const bookData = getBookData(sideBarBookKey);
  const viewSettings = getViewSettings(sideBarBookKey);
  if (!bookData?.bookDoc) return null;

  return isAIChatVisible ? (
    <>
      {!isAIChatPinned && (
        <Overlay
          className={clsx('z-[45]', viewSettings?.isEink ? '' : 'bg-black/20')}
          onDismiss={handleClickOverlay}
        />
      )}
      <div
        className={clsx(
          'ai-chat-container right-0 flex min-w-60 select-none flex-col',
          'font-sans text-base font-normal sm:text-sm',
          viewSettings?.isEink ? 'bg-base-100' : 'bg-base-200',
          appService?.isIOSApp ? 'h-[100vh]' : 'h-full',
          appService?.hasRoundedWindow && 'rounded-window-top-right rounded-window-bottom-right',
          isAIChatPinned ? 'z-20' : 'z-[45] shadow-2xl',
          !isAIChatPinned && viewSettings?.isEink && 'border-base-content border-s',
        )}
        role='group'
        aria-label={_('AI Chat')}
        dir='ltr'
        style={{
          width: aiChatWidth,
          maxWidth: `${MAX_AI_CHAT_WIDTH * 100}%`,
          position: isAIChatPinned ? 'relative' : 'absolute',
          paddingTop: `${safeAreaInsets?.top || 0}px`,
        }}
      >
        <style jsx>{`
          @media (max-width: 640px) {
            .ai-chat-container {
              width: 100%;
              min-width: 100%;
            }
          }
        `}</style>
        <div
          className='drag-bar absolute -left-2 top-0 h-full w-0.5 cursor-col-resize bg-transparent p-2'
          role='slider'
          tabIndex={0}
          aria-label={_('Resize AI Chat')}
          aria-orientation='horizontal'
          aria-valuenow={parseFloat(aiChatWidth)}
          onMouseDown={handleDragStart}
          onTouchStart={handleDragStart}
          onKeyDown={handleDragKeyDown}
        />
        <div className='flex-shrink-0'>
          <AIChatHeader
            isPinned={isAIChatPinned}
            handleClose={() => setAIChatVisible(false)}
            handleTogglePin={toggleAIChatPin}
          />
        </div>
        <SnippetSelector
          onSelectPage={() => handleSelectContent('page')}
          onSelectChapter={() => handleSelectContent('chapter')}
          isLoading={isLoading}
        />
        {error && (
          <div className='border-b-base-300 bg-error/10 text-error border-b px-4 py-2 text-sm'>
            {error}
          </div>
        )}
        <div className='flex-grow overflow-y-auto px-4 py-4'>
          {isSpeechModeActive ? (
            <div className='flex h-full flex-col items-center justify-center'>
              {currentConversation && currentConversation.messages.length > 0 && (
                <div className='mb-4 w-full'>
                  {currentConversation.messages.map((message, index) => (
                    <AIChatMessage key={`${message.timestamp}-${index}`} message={message} />
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              )}
              <SpeechConversationStatus
                isRecording={isRecording}
                onStop={handleStopSpeechConversation}
              />
            </div>
          ) : currentConversation && currentConversation.messages.length > 0 ? (
            <div>
              {currentConversation.messages.map((message, index) => (
                <AIChatMessage key={`${message.timestamp}-${index}`} message={message} />
              ))}
              {isLoading && (
                <div className='mb-4 flex justify-start'>
                  <div className='bg-base-300 rounded-lg px-4 py-2'>
                    <div className='flex items-center gap-2'>
                      <span className='loading loading-spinner loading-sm'></span>
                      <span className='text-sm'>{_('Thinking...')}</span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          ) : activeSnippet ? (
            <SpeechConversationTrigger
              onClick={handleStartSpeechConversation}
              disabled={!apiKey || isLoading}
            />
          ) : (
            <div className='text-base-content/70 flex h-full items-center justify-center'>
              <p className='text-center text-sm'>{_('Select content to start chatting')}</p>
            </div>
          )}
        </div>
        {activeSnippet && !isSpeechModeActive && (
          <AIChatInput
            onSend={handleSendMessage}
            disabled={isLoading || !apiKey}
            placeholder={
              !apiKey ? _('Configure OpenAI API key in Settings > AI') : _('Type your message...')
            }
          />
        )}
      </div>
    </>
  ) : null;
};

export default AIChatPanel;
