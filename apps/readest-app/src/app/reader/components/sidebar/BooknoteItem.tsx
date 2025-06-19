import clsx from 'clsx';
import dayjs from 'dayjs';
import React from 'react';

import { marked } from 'marked';
import { useEnv } from '@/context/EnvContext';
import { BookNote } from '@/types/book';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { useNotebookStore } from '@/store/notebookStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { eventDispatcher } from '@/utils/event';
import useScrollToItem from '../../hooks/useScrollToItem';

interface BooknoteItemProps {
  bookKey: string;
  item: BookNote;
}

const BooknoteItem: React.FC<BooknoteItemProps> = ({ bookKey, item }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const { getConfig, saveConfig, updateBooknotes } = useBookDataStore();
  const { getProgress, getView, getViewsById } = useReaderStore();
  const { setNotebookEditAnnotation, setNotebookVisible } = useNotebookStore();
  const separatorWidth = useResponsiveSize(3);

  const { text, cfi, note } = item;
  const progress = getProgress(bookKey);
  const { isCurrent, viewRef } = useScrollToItem(cfi, progress);

  const handleClickItem = (event: React.MouseEvent) => {
    event.preventDefault();
    eventDispatcher.dispatch('navigate', { bookKey, cfi });

    getView(bookKey)?.goTo(cfi);
    if (note) {
      setNotebookVisible(true);
    }
  };

  const deleteNote = (note: BookNote) => {
    if (!bookKey) return;
    const config = getConfig(bookKey);
    if (!config) return;
    const { booknotes = [] } = config;
    booknotes.forEach((item) => {
      if (item.id === note.id) {
        item.deletedAt = Date.now();
        const views = getViewsById(bookKey.split('-')[0]!);
        views.forEach((view) => view?.addAnnotation(item, true));
      }
    });
    const updatedConfig = updateBooknotes(bookKey, booknotes);
    if (updatedConfig) {
      saveConfig(envConfig, bookKey, updatedConfig, settings);
    }
  };

  const editNote = (note: BookNote) => {
    setNotebookVisible(true);
    setNotebookEditAnnotation(note);
  };

  return (
    <li
      ref={viewRef}
      className={clsx(
        'border-base-300 content group relative my-2 cursor-pointer rounded-lg p-2',
        isCurrent ? 'bg-base-300/85 hover:bg-base-300' : 'hover:bg-base-300/55 bg-base-100',
        'transition-all duration-300 ease-in-out',
      )}
      tabIndex={0}
      onClick={handleClickItem}
    >
      <div
        className={clsx('min-h-4 p-0 transition-all duration-300 ease-in-out')}
        style={
          {
            '--top-override': '0.7rem',
            '--end-override': '0.3rem',
          } as React.CSSProperties
        }
      >
        {item.note && (
          <div
            className='content prose prose-sm font-size-sm'
            dir='auto'
            dangerouslySetInnerHTML={{ __html: marked.parse(item.note) }}
          ></div>
        )}
        <div className='flex items-start'>
          {item.note && (
            <div
              className='me-2 mt-2.5 min-h-full self-stretch rounded-xl bg-gray-300'
              style={{
                minWidth: `${separatorWidth}px`,
              }}
            ></div>
          )}
          <div className={clsx('content font-size-sm line-clamp-3', item.note && 'mt-2')}>
            <span
              className={clsx(
                'inline leading-normal',
                item.note && 'content font-size-xs text-gray-500',
                (item.style === 'underline' || item.style === 'squiggly') &&
                  'underline decoration-2',
                item.style === 'highlight' && `bg-${item.color}-500 bg-opacity-40`,
                item.style === 'underline' && `decoration-${item.color}-400`,
                item.style === 'squiggly' && `decoration-wavy decoration-${item.color}-400`,
              )}
            >
              {text || ''}
            </span>
          </div>
        </div>
      </div>
      <div
        className={clsx(
          'max-h-0 overflow-hidden p-0 text-xs',
          'transition-[max-height] duration-300 ease-in-out',
          'group-hover:max-h-8 group-hover:overflow-visible',
        )}
        style={
          {
            '--bottom-override': 0,
          } as React.CSSProperties
        }
        onClick={(e) => e.stopPropagation()}
      >
        <div className='flex cursor-default items-center justify-between'>
          <div className='flex items-center'>
            <span className='text-sm text-gray-500 sm:text-xs'>
              {dayjs(item.createdAt).fromNow()}
            </span>
          </div>
          <div className='flex items-center justify-end space-x-3 p-2' dir='ltr'>
            {item.note && (
              <div
                className={clsx(
                  'content settings-content cursor-pointer',
                  'flex items-end p-0 hover:bg-transparent',
                )}
                onClick={editNote.bind(null, item)}
              >
                <div
                  className={clsx(
                    'align-bottom text-blue-500',
                    'transition duration-300 ease-in-out',
                    'content font-size-sm',
                    'opacity-0 group-hover:opacity-100',
                    'hover:text-blue-600',
                  )}
                >
                  {_('Edit')}
                </div>
              </div>
            )}
            <div
              className={clsx(
                'content settings-content cursor-pointer',
                'flex items-end p-0 hover:bg-transparent',
              )}
              onClick={deleteNote.bind(null, item)}
            >
              <div
                className={clsx(
                  'align-bottom text-red-500',
                  'transition duration-300 ease-in-out',
                  'content font-size-sm',
                  'opacity-0 group-hover:opacity-100',
                  'hover:text-red-600',
                )}
              >
                {_('Delete')}
              </div>
            </div>
          </div>
        </div>
      </div>
    </li>
  );
};

export default BooknoteItem;
