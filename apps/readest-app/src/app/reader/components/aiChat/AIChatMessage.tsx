import clsx from 'clsx';
import React from 'react';
import { AIChatMessage as Message } from '@/services/aiChatService';
import { useTranslation } from '@/hooks/useTranslation';

interface AIChatMessageProps {
  message: Message;
}

const AIChatMessage: React.FC<AIChatMessageProps> = ({ message }) => {
  const _ = useTranslation();
  const isUser = message.role === 'user';

  return (
    <div
      className={clsx(
        'ai-chat-message mb-4 flex',
        isUser ? 'justify-end' : 'justify-start',
      )}
    >
      <div
        className={clsx(
          'max-w-[80%] rounded-lg px-4 py-2',
          isUser
            ? 'bg-primary text-primary-content'
            : 'bg-base-300 text-base-content',
        )}
      >
        <div className='whitespace-pre-wrap break-words text-sm'>{message.content}</div>
        <div
          className={clsx(
            'mt-1 text-xs opacity-70',
            isUser ? 'text-right' : 'text-left',
          )}
        >
          {new Date(message.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </div>
      </div>
    </div>
  );
};

export default AIChatMessage;

