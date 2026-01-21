import clsx from 'clsx';
import dayjs from 'dayjs';
import React, { useRef, useState } from 'react';

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
import { NOTE_PREFIX } from '@/types/view';
import useScrollToItem from '../../hooks/useScrollToItem';
import TextButton from '@/components/TextButton';
import TextEditor, { TextEditorRef } from '@/components/TextEditor';

interface BooknoteItemProps {
  bookKey: string;
  item: BookNote;
  onClick?: () => void;
}

const BooknoteItem: React.FC<BooknoteItemProps> = ({ bookKey, item, onClick }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const { getConfig, saveConfig, updateBooknotes } = useBookDataStore();
  const { getProgress, getView, getViewsById } = useReaderStore();
  const { setNotebookEditAnnotation, setNotebookVisible } = useNotebookStore();

  const { text, cfi, note } = item;
  const editorRef = useRef<TextEditorRef>(null);
  const [editorDraft, setEditorDraft] = useState(text || '');
  const [inlineEditMode, setInlineEditMode] = useState(false);
  const separatorWidth = useResponsiveSize(3);

  const progress = getProgress(bookKey);
  const { isCurrent, viewRef } = useScrollToItem(cfi, progress);

  const handleClickItem = (event: React.MouseEvent | React.KeyboardEvent) => {
    event.preventDefault();
    eventDispatcher.dispatch('navigate', { bookKey, cfi });

    onClick?.();
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
        views.forEach((view) =>
          view?.addAnnotation({ ...item, value: `${NOTE_PREFIX}${item.cfi}` }, true),
        );
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

  const editBookmark = () => {
    setEditorDraft(text || '');
    setInlineEditMode(true);
  };

  const handleSaveBookmark = () => {
    setInlineEditMode(false);
    const config = getConfig(bookKey);
    if (!config || !editorDraft) return;

    const { booknotes: annotations = [] } = config;
    const existingIndex = annotations.findIndex((annotation) => item.id === annotation.id);
    if (existingIndex === -1) return;
    annotations[existingIndex]!.updatedAt = Date.now();
    annotations[existingIndex]!.text = editorDraft;
    const updatedConfig = updateBooknotes(bookKey, annotations);
    if (updatedConfig) {
      saveConfig(envConfig, bookKey, updatedConfig, settings);
    }
  };

  if (inlineEditMode) {
    return (
      <div
        className={clsx(
          'border-base-300 content group relative my-2 cursor-pointer rounded-lg p-2',
          isCurrent ? 'bg-base-300/85 hover:bg-base-300' : 'hover:bg-base-300/55 bg-base-100',
          'transition-all duration-300 ease-in-out',
        )}
      >
        <div className='flex w-full'>
          <TextEditor
            className='!leading-normal'
            ref={editorRef}
            value={editorDraft}
            onChange={setEditorDraft}
            onSave={handleSaveBookmark}
            onEscape={() => setInlineEditMode(false)}
            spellCheck={false}
          />
        </div>
        <div className='flex justify-end space-x-3 p-2' dir='ltr'>
          <TextButton onClick={() => setInlineEditMode(false)}>{_('Cancel')}</TextButton>
          <TextButton onClick={handleSaveBookmark} disabled={!editorDraft}>
            {_('Save')}
          </TextButton>
        </div>
      </div>
    );
  }

  return (
    <li
      // eslint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role
      role='button'
      ref={viewRef}
      className={clsx(
        'booknote-item border-base-300 content group relative my-2 cursor-pointer rounded-lg p-2',
        isCurrent
          ? 'bg-base-300/85 hover:bg-base-300 focus:bg-base-300'
          : 'hover:bg-base-300/55 focus:bg-base-300/55 bg-base-100',
        'transition-all duration-300 ease-in-out',
      )}
      tabIndex={0}
      onClick={handleClickItem}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          handleClickItem(e);
        } else {
          e.stopPropagation();
        }
      }}
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
                'booknote-text inline leading-normal',
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
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        className={clsx(
          'max-h-0 overflow-hidden p-0',
          'transition-[max-height] duration-300 ease-in-out',
          'group-hover:max-h-8 group-hover:overflow-visible',
          'group-focus-within:max-h-8 group-focus-within:overflow-visible',
        )}
        style={
          {
            '--bottom-override': 0,
          } as React.CSSProperties
        }
        // This is needed to prevent the parent onClick from being triggered
        onClick={(e) => e.stopPropagation()}
      >
        <div className='flex cursor-default items-center justify-between'>
          <div className='flex items-center'>
            <span className='text-sm text-gray-500 sm:text-xs'>
              {dayjs(item.createdAt).fromNow()}
            </span>
          </div>
          <div className='flex items-center justify-end space-x-3 p-2' dir='ltr'>
            {(item.note || item.type === 'bookmark') && (
              <TextButton
                onClick={item.type === 'bookmark' ? editBookmark : editNote.bind(null, item)}
                variant='primary'
                className='opacity-0 transition duration-300 ease-in-out group-focus-within:opacity-100 group-hover:opacity-100'
              >
                {_('Edit')}
              </TextButton>
            )}

            <TextButton
              onClick={deleteNote.bind(null, item)}
              variant='danger'
              className='opacity-0 transition duration-300 ease-in-out group-focus-within:opacity-100 group-hover:opacity-100'
            >
              {_('Delete')}
            </TextButton>
          </div>
        </div>
      </div>
    </li>
  );
};

export default BooknoteItem;
