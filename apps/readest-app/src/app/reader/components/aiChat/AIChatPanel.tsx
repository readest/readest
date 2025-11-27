import clsx from 'clsx';
import React, { useCallback, useEffect, useRef } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useAIChatStore } from '@/store/aiChatStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useThemeStore } from '@/store/themeStore';
import { DragKey, useDrag } from '@/hooks/useDrag';
import { Overlay } from '@/components/Overlay';
import useShortcuts from '@/hooks/useShortcuts';
import { OpenAIService } from '@/services/openaiService';
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
  console.log('AIChatPanel@!!');
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

  useEffect(() => {
    if (appService) {
      loadConversations(appService);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService]);

  useEffect(() => {
    if (isAIChatVisible) {
      updateAppTheme('base-200');
    } else {
      updateAppTheme('base-100');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAIChatVisible]);

  useEffect(() => {
    // Scroll to bottom when new messages arrive
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentConversation?.messages]);

  // Cleanup speech service on unmount
  useEffect(() => {
    return () => {
      if (speechServiceRef.current) {
        speechServiceRef.current.disconnect().catch(console.error);
        speechServiceRef.current = null;
      }
    };
  }, []);

  const handleHideAIChat = useCallback(() => {
    if (!isAIChatPinned) {
      setAIChatVisible(false);
      setActiveSnippet(null);
      setCurrentConversationId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAIChatPinned]);

  useShortcuts({ onEscape: handleHideAIChat }, [handleHideAIChat]);

  const handleAIChatResize = (newWidth: string) => {
    setAIChatWidth(newWidth);
  };

  const handleTogglePin = () => {
    toggleAIChatPin();
  };

  const handleClickOverlay = () => {
    setAIChatVisible(false);
    setActiveSnippet(null);
    setCurrentConversationId(null);
  };

  const handleSelectPage = async () => {
    if (!sideBarBookKey || !appService) return;
    const view = getView(sideBarBookKey);
    const bookData = getBookData(sideBarBookKey);
    if (!view || !bookData?.book) return;

    setLoading(true);
    try {
      const text = await getCurrentPageText(sideBarBookKey, view);
      if (text) {
        setActiveSnippet({
          text,
          type: 'page',
          bookKey: sideBarBookKey,
          bookTitle: bookData.book.title,
          bookAuthor: bookData.book.author,
        });
        // Create new conversation
        await handleCreateConversation(text, 'page');
      }
    } catch (error) {
      console.error('Error selecting page:', error);
      setError(_('Failed to extract page text'));
    } finally {
      setLoading(false);
    }
  };

  const handleSelectChapter = async () => {
    if (!sideBarBookKey || !appService) return;
    const view = getView(sideBarBookKey);
    const progress = getProgress(sideBarBookKey);
    const bookData = getBookData(sideBarBookKey);
    if (!view || !progress || !bookData?.book) return;

    setLoading(true);
    try {
      const text = await getCurrentChapterText(sideBarBookKey, view, progress);
      if (text) {
        setActiveSnippet({
          text,
          type: 'chapter',
          bookKey: sideBarBookKey,
          bookTitle: bookData.book.title,
          bookAuthor: bookData.book.author,
        });
        // Create new conversation
        await handleCreateConversation(text, 'chapter');
      }
    } catch (error) {
      console.error('Error selecting chapter:', error);
      setError(_('Failed to extract chapter text'));
    } finally {
      setLoading(false);
    }
  };

  const handleCreateConversation = async (
    snippetText: string,
    snippetType: 'page' | 'chapter',
  ): Promise<string | null> => {
    if (!sideBarBookKey || !activeSnippet || !appService) return null;

    const conversation: AIConversation = {
      id: uniqueId(),
      bookKey: sideBarBookKey,
      bookTitle: activeSnippet.bookTitle,
      bookAuthor: activeSnippet.bookAuthor,
      snippet: snippetText,
      snippetType,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await createConversation(conversation);
    setCurrentConversationId(conversation.id);
    return conversation.id;
  };

  const handleSendMessage = async (messageText: string) => {
    if (!settings.globalReadSettings.openaiApiKey || !activeSnippet) {
      setError(_('OpenAI API key is not configured. Please add your API key in Settings > AI.'));
      return;
    }

    let conversationId = currentConversationId;
    if (!conversationId && activeSnippet) {
      // Create conversation if it doesn't exist
      const newConversationId = await handleCreateConversation(
        activeSnippet.text,
        activeSnippet.type as 'page' | 'chapter',
      );
      if (!newConversationId) {
        setError(_('Failed to create conversation. Please try again.'));
        return;
      }
      conversationId = newConversationId;
    }

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
      const openaiService = new OpenAIService(settings.globalReadSettings.openaiApiKey);
      let conversation = conversations.find((c) => c.id === conversationId);
      if (!conversation && appService) {
        // Reload conversations if not found
        const chatService = new AIChatService(appService);
        const allConversations = await chatService.loadConversations();
        setConversations(allConversations);
        conversation = allConversations.find((c) => c.id === conversationId);
      }
      if (!conversation) {
        setError(_('Conversation not found. Please try again.'));
        setLoading(false);
        return;
      }

      const systemPrompt = openaiService.createSystemPrompt(
        activeSnippet.bookTitle,
        activeSnippet.bookAuthor,
        activeSnippet.text,
      );

      const messages: AIChatMessageType[] = [...conversation.messages, userMessage];

      const response = await openaiService.sendMessage(messages, systemPrompt);

      if (response.error) {
        setError(response.error);
        return;
      }

      const assistantMessage: AIChatMessageType = {
        role: 'assistant',
        content: response.content,
        timestamp: Date.now(),
      };

      await addMessage(conversationId, assistantMessage);
    } catch (error) {
      console.error('Error sending message:', error);
      setError(_('Failed to send message. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const onDragMove = (data: { clientX: number }) => {
    const widthFraction = 1 - data.clientX / window.innerWidth;
    const newWidth = Math.max(MIN_AI_CHAT_WIDTH, Math.min(MAX_AI_CHAT_WIDTH, widthFraction));
    handleAIChatResize(`${Math.round(newWidth * 10000) / 100}%`);
  };

  const onDragKeyDown = (data: { key: DragKey; step: number }) => {
    const currentWidth = parseFloat(aiChatWidth) / 100;
    let newWidth = currentWidth;

    if (data.key === 'ArrowLeft') {
      newWidth = Math.max(MIN_AI_CHAT_WIDTH, currentWidth + data.step);
    } else if (data.key === 'ArrowRight') {
      newWidth = Math.min(MAX_AI_CHAT_WIDTH, currentWidth - data.step);
    }
    handleAIChatResize(`${Math.round(newWidth * 10000) / 100}%`);
  };

  const { handleDragStart, handleDragKeyDown } = useDrag(onDragMove, onDragKeyDown);

  const handleStartSpeechConversation = async () => {
    if (!settings.globalReadSettings.openaiApiKey || !activeSnippet) {
      setError(_('OpenAI API key is not configured. Please add your API key in Settings > AI.'));
      return;
    }

    try {
      // Create or get conversation
      let conversationId = currentConversationId;
      if (!conversationId && activeSnippet) {
        const newConversationId = await handleCreateConversation(
          activeSnippet.text,
          activeSnippet.type as 'page' | 'chapter',
        );
        if (!newConversationId) {
          setError(_('Failed to create conversation. Please try again.'));
          return;
        }
        conversationId = newConversationId;
      }

      if (!conversationId) {
        setError(_('Failed to create conversation. Please try again.'));
        return;
      }

      // Create system prompt
      const openaiService = new OpenAIService(settings.globalReadSettings.openaiApiKey);
      const systemPrompt = openaiService.createSystemPrompt(
        activeSnippet.bookTitle,
        activeSnippet.bookAuthor,
        activeSnippet.text,
      );

      // Initialize speech service
      console.error('[AIChatPanel] *** Creating RealtimeSpeechService ***');
      const service = new RealtimeSpeechService(settings.globalReadSettings.openaiApiKey, {
        onTranscript: async (text, role) => {
          console.error('[AIChatPanel] onTranscript:', role, text.substring(0, 50));
          if (conversationId) {
            const message: AIChatMessageType = {
              role,
              content: text,
              timestamp: Date.now(),
            };
            await addMessage(conversationId, message);
          }
        },
        onError: (errorMessage) => {
          console.error('[AIChatPanel] *** onError callback ***: ', errorMessage);
          setError(`[DEBUG v2] ${errorMessage}`);
        },
        onConnectionStateChange: (connected) => {
          console.error('[AIChatPanel] onConnectionStateChange:', connected);
          if (!connected) {
            stopSpeechConversation();
          }
        },
        onRecordingStateChange: (recording) => {
          console.error('[AIChatPanel] onRecordingStateChange:', recording);
          setRecording(recording);
        },
      });

      speechServiceRef.current = service;

      // Connect and start recording
      console.error('[AIChatPanel] *** Calling service.connect ***');
      await service.connect(systemPrompt);
      console.error('[AIChatPanel] *** Calling service.startRecording ***');
      await service.startRecording();
      console.error('[AIChatPanel] *** Recording started successfully ***');

      // Start speech conversation in store
      startSpeechConversation(conversationId);
      setError(null);
    } catch (error) {
      console.error('Error starting speech conversation:', error);
      setError(_('Failed to start voice conversation. Please try again.'));
      if (speechServiceRef.current) {
        await speechServiceRef.current.disconnect();
        speechServiceRef.current = null;
      }
    }
  };

  const handleStopSpeechConversation = async () => {
    if (speechServiceRef.current) {
      await speechServiceRef.current.disconnect();
      speechServiceRef.current = null;
    }
    stopSpeechConversation();
  };

  if (!sideBarBookKey) return null;

  const bookData = getBookData(sideBarBookKey);
  const viewSettings = getViewSettings(sideBarBookKey);
  if (!bookData || !bookData.bookDoc) {
    return null;
  }

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
          width: `${aiChatWidth}`,
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
          className={clsx(
            'drag-bar absolute -left-2 top-0 h-full w-0.5 cursor-col-resize bg-transparent p-2',
          )}
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
            handleTogglePin={handleTogglePin}
          />
        </div>
        <SnippetSelector
          bookKey={sideBarBookKey}
          onSelectPage={handleSelectPage}
          onSelectChapter={handleSelectChapter}
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
              disabled={!settings.globalReadSettings.openaiApiKey || isLoading}
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
            disabled={isLoading || !settings.globalReadSettings.openaiApiKey}
            placeholder={
              !settings.globalReadSettings.openaiApiKey
                ? _('Configure OpenAI API key in Settings > AI')
                : _('Type your message...')
            }
          />
        )}
      </div>
    </>
  ) : null;
};

export default AIChatPanel;
