import clsx from 'clsx';
import React from 'react';

import { useEnv } from '@/context/EnvContext';
import { BookNote } from '@/types/book';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { useNotebookStore } from '@/store/notebookStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useTranslation } from '@/hooks/useTranslation';
import useScrollToItem from '../../hooks/useScrollToItem';
import { eventDispatcher } from '@/utils/event';

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
          <span className='content font-size-sm font-normal' dir='auto'>
            {item.note}
          </span>
        )}
        <div className='flex items-start'>
          {item.note && (
            <div className='my-1 me-2 min-h-full self-stretch border-l-2 border-gray-300'></div>
          )}
          <div className={clsx('content font-size-sm line-clamp-3', item.note && 'my-2')}>
            <span
              className={clsx(
                'inline',
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
        <div className='flex justify-end space-x-3 p-2' dir='ltr'>
          {item.note && (
            <button
              className={clsx(
                'btn btn-ghost content settings-content hover:bg-transparent',
                'flex h-4 min-h-4 items-end p-0',
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
            </button>
          )}
          <button
            className={clsx(
              'btn btn-ghost content settings-content hover:bg-transparent',
              'flex h-4 min-h-4 items-end p-0',
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
          </button>
        </div>
      </div>
    </li>
  );
};

export default BooknoteItem;
