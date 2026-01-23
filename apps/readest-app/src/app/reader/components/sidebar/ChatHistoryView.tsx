'use client';

import clsx from 'clsx';
import dayjs from 'dayjs';
import React, { useEffect, useState, useCallback } from 'react';
import { LuMessageSquare, LuTrash2, LuPencil, LuCheck, LuX, LuPlus } from 'react-icons/lu';

import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { useAIChatStore } from '@/store/aiChatStore';
import { useNotebookStore } from '@/store/notebookStore';
import type { AIConversation } from '@/services/ai/types';

interface ChatHistoryViewProps {
  bookKey: string;
}

const ChatHistoryView: React.FC<ChatHistoryViewProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { getBookData } = useBookDataStore();
  const {
    conversations,
    isLoadingHistory,
    loadConversations,
    setActiveConversation,
    deleteConversation,
    renameConversation,
    createConversation,
  } = useAIChatStore();
  const { setNotebookVisible, setNotebookActiveTab } = useNotebookStore();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  const bookData = getBookData(bookKey);
  const bookHash = bookKey.split('-')[0] || '';
  const bookTitle = bookData?.book?.title || 'Unknown';

  // Load conversations for this book
  useEffect(() => {
    if (bookHash) {
      loadConversations(bookHash);
    }
  }, [bookHash, loadConversations]);

  const handleSelectConversation = useCallback(
    async (conversation: AIConversation) => {
      await setActiveConversation(conversation.id);
      setNotebookVisible(true);
      setNotebookActiveTab('ai');
    },
    [setActiveConversation, setNotebookVisible, setNotebookActiveTab],
  );

  const handleNewConversation = useCallback(async () => {
    await createConversation(bookHash, `Chat about ${bookTitle}`);
    setNotebookVisible(true);
    setNotebookActiveTab('ai');
  }, [bookHash, bookTitle, createConversation, setNotebookVisible, setNotebookActiveTab]);

  const handleDeleteConversation = useCallback(
    async (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      if (window.confirm(_('Delete this conversation?'))) {
        await deleteConversation(id);
      }
    },
    [deleteConversation, _],
  );

  const handleStartRename = useCallback((e: React.MouseEvent, conversation: AIConversation) => {
    e.stopPropagation();
    setEditingId(conversation.id);
    setEditTitle(conversation.title);
  }, []);

  const handleSaveRename = useCallback(
    async (e: React.MouseEvent | React.KeyboardEvent) => {
      e.stopPropagation();
      if (editingId && editTitle.trim()) {
        await renameConversation(editingId, editTitle.trim());
      }
      setEditingId(null);
      setEditTitle('');
    },
    [editingId, editTitle, renameConversation],
  );

  const handleCancelRename = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(null);
    setEditTitle('');
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleSaveRename(e);
      } else if (e.key === 'Escape') {
        setEditingId(null);
        setEditTitle('');
      }
    },
    [handleSaveRename],
  );

  if (isLoadingHistory) {
    return (
      <div className='flex h-full items-center justify-center p-4'>
        <div className='border-primary size-5 animate-spin rounded-full border-2 border-t-transparent' />
      </div>
    );
  }

  return (
    <div className='relative flex h-full flex-col'>
      {/* Conversation list */}
      <div className='flex-1 overflow-y-auto'>
        {conversations.length === 0 ? (
          <div className='flex h-full flex-col items-center justify-center gap-3 p-4 text-center'>
            <div className='bg-base-300/50 rounded-full p-3'>
              <LuMessageSquare className='text-base-content/50 size-6' />
            </div>
            <div>
              <p className='text-base-content/70 text-sm'>{_('No conversations yet')}</p>
              <p className='text-base-content/50 text-xs'>
                {_('Start a new chat to ask questions about this book')}
              </p>
            </div>
          </div>
        ) : (
          <ul className='divide-base-300/30 divide-y pb-16'>
            {conversations.map((conversation) => (
              <li
                key={conversation.id}
                className={clsx(
                  'group flex cursor-pointer items-start gap-2 px-3 py-2.5',
                  'hover:bg-base-300/50 transition-colors duration-150',
                )}
              >
                <div
                  className='flex flex-1 items-start gap-2'
                  tabIndex={0}
                  role='button'
                  onClick={() => handleSelectConversation(conversation)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleSelectConversation(conversation);
                    }
                  }}
                >
                  <LuMessageSquare className='text-base-content/40 mt-0.5 size-4 flex-shrink-0' />

                  <div className='min-w-0 flex-1'>
                    {editingId === conversation.id ? (
                      <div
                        className='flex items-center gap-1'
                        role='presentation'
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <input
                          type='text'
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onKeyDown={handleKeyDown}
                          className={clsx(
                            'input input-xs input-bordered w-full',
                            'bg-base-100 text-base-content',
                          )}
                          // eslint-disable-next-line jsx-a11y/no-autofocus
                          autoFocus
                        />
                        <button
                          onClick={handleSaveRename}
                          className='btn btn-ghost btn-xs text-success'
                          aria-label={_('Save')}
                        >
                          <LuCheck size={14} />
                        </button>
                        <button
                          onClick={handleCancelRename}
                          className='btn btn-ghost btn-xs text-error'
                          aria-label={_('Cancel')}
                        >
                          <LuX size={14} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <p className='text-base-content line-clamp-1 text-sm font-medium'>
                          {conversation.title}
                        </p>
                        <p className='text-base-content/50 text-xs'>
                          {dayjs(conversation.updatedAt).format('MMM D, YYYY h:mm A')}
                        </p>
                      </>
                    )}
                  </div>
                </div>

                {editingId !== conversation.id && (
                  <div className='flex flex-shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100'>
                    <button
                      onClick={(e) => handleStartRename(e, conversation)}
                      className='btn btn-ghost btn-xs'
                      aria-label={_('Rename')}
                    >
                      <LuPencil size={12} />
                    </button>
                    <button
                      onClick={(e) => handleDeleteConversation(e, conversation.id)}
                      className='btn btn-ghost btn-xs text-error'
                      aria-label={_('Delete')}
                    >
                      <LuTrash2 size={12} />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Floating New Chat button at bottom right */}
      <div className='absolute bottom-4 right-4'>
        <button
          onClick={handleNewConversation}
          className={clsx(
            'flex items-center gap-2 rounded-full px-4 py-2',
            'bg-base-300 text-base-content',
            'hover:bg-base-content/10',
            'border border-base-content/10',
            'shadow-sm',
            'transition-all duration-200 ease-out',
            'active:scale-[0.97]',
          )}
          aria-label={_('New Chat')}
        >
          <LuPlus size={16} />
          <span className='text-sm font-medium'>{_('New Chat')}</span>
        </button>
      </div>
    </div>
  );
};

export default ChatHistoryView;
