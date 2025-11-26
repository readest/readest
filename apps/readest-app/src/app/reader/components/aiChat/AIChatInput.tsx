import clsx from 'clsx';
import React, { useState, useRef, useEffect } from 'react';
import { IoSend } from 'react-icons/io5';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';

interface AIChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

const AIChatInput: React.FC<AIChatInputProps> = ({
  onSend,
  disabled = false,
  placeholder,
}) => {
  const _ = useTranslation();
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const iconSize = useResponsiveSize(18);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    // Auto-resize textarea
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  };

  return (
    <div className='ai-chat-input border-t-base-300 border-t bg-base-100 p-3'>
      <div className='flex items-end gap-2'>
        <textarea
          ref={textareaRef}
          className='textarea textarea-bordered flex-1 resize-none text-sm'
          placeholder={placeholder || _('Type your message...')}
          value={input}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={1}
          style={{ maxHeight: '120px', overflowY: 'auto' }}
        />
        <button
          className={clsx(
            'btn btn-primary btn-circle h-10 min-h-10 w-10 p-0',
            (disabled || !input.trim()) && 'btn-disabled',
          )}
          onClick={handleSend}
          disabled={disabled || !input.trim()}
          title={_('Send')}
        >
          <IoSend size={iconSize} />
        </button>
      </div>
    </div>
  );
};

export default AIChatInput;

