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
import { useEnv } from '@/context/EnvContext';

interface ChatHistoryViewProps {
  bookKey: string;
}

const ChatHistoryView: React.FC<ChatHistoryViewProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
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
      if (!appService) return;
      if (await appService.ask(_('Delete this conversation?'))) {
        await deleteConversation(id);
      }
    },
    [deleteConversation, _, appService],
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
        <div className='size-5 animate-spin rounded-full border-2 border-[#b28b4e] border-t-transparent' />
      </div>
    );
  }

  return (
    <div className='relative flex h-full flex-col'>
      {/* Conversation list */}
      <div className='flex-1 overflow-y-auto'>
        {conversations.length === 0 ? (
          <div className='flex h-full flex-col items-center justify-center gap-3 p-4 text-center'>
            <div className='border-[#6a4d28]/28 bg-[#1a110f]/72 rounded-full border p-3'>
              <LuMessageSquare className='size-6 text-[#8f7447]' />
            </div>
            <div>
              <p className='text-[#d0bb92]/82 text-sm'>{_('No conversations yet')}</p>
              <p className='text-xs text-[#8e7348]'>
                {_('Start a new chat to ask questions about this book')}
              </p>
            </div>
          </div>
        ) : (
          <ul className='divide-y divide-[#5e4525]/20 px-2 pb-16 pt-2'>
            {conversations.map((conversation) => (
              <li
                key={conversation.id}
                className={clsx(
                  'border-[#5e4525]/18 bg-[#17100d]/78 group mb-2 flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2.5',
                  'hover:border-[#8f6a37]/32 transition-colors duration-150 hover:bg-[#241612]',
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
                            'input input-xs input-bordered border-[#8f6a37]/28 w-full bg-[#120c0a] text-[#e0ccaa]',
                          )}
                          // eslint-disable-next-line jsx-a11y/no-autofocus
                          autoFocus
                        />
                        <button
                          onClick={handleSaveRename}
                          className='btn btn-ghost btn-xs border-[#6a4d28]/24 bg-[#1a110f]/78 border text-[#c6aa73] hover:bg-[#241612] hover:text-[#f0d6a0]'
                          aria-label={_('Save')}
                        >
                          <LuCheck size={14} />
                        </button>
                        <button
                          onClick={handleCancelRename}
                          className='btn btn-ghost btn-xs border-[#7b342d]/32 bg-[#1a110f]/78 border text-[#c07d73] hover:bg-[#2a1613] hover:text-[#e7a39a]'
                          aria-label={_('Cancel')}
                        >
                          <LuX size={14} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <p className='line-clamp-1 text-sm font-medium text-[#e0ccaa]'>
                          {conversation.title}
                        </p>
                        <p className='text-xs text-[#8e7348]'>
                          {dayjs(conversation.updatedAt).format('MMM D, YYYY h:mm A')}
                        </p>
                      </>
                    )}
                  </div>
                </div>

                {editingId !== conversation.id && (
                  <div className='flex flex-shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100'>
                    <button
                      onClick={(e) => handleStartRename(e, conversation)}
                      className='btn btn-ghost btn-xs border-[#6a4d28]/24 border bg-[#1a110f]/80 text-[#c7ab74] hover:bg-[#241612] hover:text-[#f0d6a0]'
                      aria-label={_('Rename')}
                    >
                      <LuPencil size={12} />
                    </button>
                    <button
                      onClick={(e) => handleDeleteConversation(e, conversation.id)}
                      className='btn btn-ghost btn-xs border-[#7b342d]/32 border bg-[#1a110f]/80 text-[#b56b5f] hover:bg-[#2a1613] hover:text-[#e6a093]'
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
            'border-[#ad8444]/42 flex items-center gap-2 rounded-full border bg-[linear-gradient(180deg,rgba(50,24,18,0.94),rgba(33,16,13,0.98))] px-4 py-2 text-[#f0d6a0]',
            'hover:bg-[linear-gradient(180deg,rgba(61,31,24,0.96),rgba(39,19,15,0.98))]',
            'shadow-[0_10px_26px_rgba(0,0,0,0.25),0_0_16px_rgba(126,31,25,0.14)]',
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
