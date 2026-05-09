import clsx from 'clsx';
import dayjs from 'dayjs';
import React, { useRef, useState } from 'react';
import { MdEdit, MdDelete } from 'react-icons/md';

import { marked } from 'marked';
import { useEnv } from '@/context/EnvContext';
import { BookNote, HighlightColor } from '@/types/book';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { useNotebookStore } from '@/store/notebookStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { eventDispatcher } from '@/utils/event';
import { removeBookNoteOverlays } from '../../utils/annotatorUtil';
import useScrollToItem from '../../hooks/useScrollToItem';
import TextButton from '@/components/TextButton';
import TextEditor, { TextEditorRef } from '@/components/TextEditor';

interface BooknoteItemProps {
  bookKey: string;
  item: BookNote;
  isNearest?: boolean;
  onClick?: () => void;
}

const BooknoteItem: React.FC<BooknoteItemProps> = ({ bookKey, item, isNearest, onClick }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const { getConfig, saveConfig, updateBooknotes } = useBookDataStore();
  const { getProgress, getView, getViewsById } = useReaderStore();
  const { setNotebookEditAnnotation, setNotebookVisible } = useNotebookStore();

  const globalReadSettings = settings.globalReadSettings;
  const customColors = globalReadSettings.customHighlightColors;

  const { text, cfi, note } = item;
  const editorRef = useRef<TextEditorRef>(null);
  const [editorDraft, setEditorDraft] = useState(text || '');
  const [inlineEditMode, setInlineEditMode] = useState(false);
  const separatorWidth = useResponsiveSize(3);
  const size18 = useResponsiveSize(18);

  const progress = getProgress(bookKey);
  const { isCurrent, viewRef } = useScrollToItem(cfi, progress, isNearest);

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
        views.forEach((view) => removeBookNoteOverlays(view, item));
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
          'content group relative border-b border-[rgba(178,135,70,0.22)] px-4 py-3 text-[#e4d2ab]',
          isCurrent
            ? 'bg-[linear-gradient(90deg,rgba(65,24,18,0.68),rgba(31,15,12,0.74)_70%,rgba(18,11,9,0.38))] shadow-[inset_0_1px_0_rgba(255,237,193,0.035)]'
            : 'hover:bg-[rgba(30,20,17,0.54)]',
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

  const isEditable = item.note || item.type === 'bookmark';

  return (
    <li
      // eslint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role
      role='button'
      ref={viewRef}
      className={clsx(
        'booknote-item content group relative cursor-pointer border-b border-[rgba(178,135,70,0.22)] px-4 py-3 text-[#e4d2ab]',
        isCurrent
          ? 'hover:bg-[#311814]/88 focus:bg-[#311814]/88 bg-[linear-gradient(90deg,rgba(61,21,16,0.7),rgba(31,14,11,0.78)_68%,rgba(18,11,9,0.4))] text-[#f0d6a0]'
          : 'hover:bg-[rgba(30,20,17,0.54)] focus:bg-[rgba(30,20,17,0.54)]',
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
      <span
        aria-hidden='true'
        className={clsx(
          'absolute bottom-3 left-0 top-3 w-[2px] rounded-full bg-gradient-to-b from-[#b73a2f] to-[#c9a45a] transition-opacity duration-150',
          isCurrent ? 'opacity-100' : 'opacity-0 group-hover:opacity-70',
        )}
      />
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
              className='bg-[#7d5a2d]/78 me-2 mt-2.5 min-h-full self-stretch rounded-xl'
              style={{
                minWidth: `${separatorWidth}px`,
              }}
            ></div>
          )}
          <div
            className={clsx(
              'content font-size-sm line-clamp-3 font-serif text-[#e9d8b2]',
              item.note && 'mt-2',
            )}
          >
            <span
              className={clsx(
                'booknote-text inline leading-normal',
                item.note && 'content font-size-xs text-[#9d8358]',
                (item.style === 'underline' || item.style === 'squiggly') &&
                  'underline decoration-2',
                item.style === 'highlight' && 'rounded-[4px] px-[2px] py-[1px]',
                item.style === 'squiggly' && 'decoration-wavy',
              )}
              style={
                {
                  ...(item.style === 'highlight'
                    ? {
                        backgroundColor: `color-mix(in srgb, ${customColors[item.color as HighlightColor] || item.color} calc(var(--overlayer-highlight-opacity, 0.3) * 100%), transparent)`,
                      }
                    : {}),
                  ...(item.style === 'underline' || item.style === 'squiggly'
                    ? {
                        textDecorationColor: `color-mix(in srgb, ${customColors[item.color as HighlightColor] || item.color} 80%, transparent)`,
                      }
                    : {}),
                } as React.CSSProperties
              }
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
          'group-focus-within:overflow-visible group-hover:overflow-visible',
          isEditable
            ? 'group-focus-within:max-h-12 group-hover:max-h-12'
            : 'group-focus-within:max-h-8 group-hover:max-h-8',
        )}
        style={
          {
            '--bottom-override': 0,
          } as React.CSSProperties
        }
        // This is needed to prevent the parent onClick from being triggered
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={clsx(
            'flex cursor-default items-center justify-between py-2',
            isEditable && 'flex-col',
          )}
        >
          <div className='flex w-full items-center gap-1 truncate'>
            <span className='truncate text-sm text-[#8e7348] sm:text-xs'>
              {item.page ? _('p {{page}}' + ' · ', { page: item.page }) : ''}
            </span>
            <span className='truncate text-sm text-[#8e7348] sm:text-xs'>
              {dayjs(item.createdAt).fromNow()}
            </span>
          </div>
          <div
            className={clsx('flex items-center justify-end gap-3', isEditable && 'w-full')}
            dir='ltr'
          >
            {isEditable && (
              <button
                onClick={item.type === 'bookmark' ? editBookmark : editNote.bind(null, item)}
                className='btn btn-ghost btn-xs bg-[#1a110f]/62 rounded-md border border-[#6a4d28]/20 p-0 text-[#c7ab74] opacity-0 transition duration-300 ease-in-out hover:bg-[#241612] hover:text-[#f0d6a0] group-focus-within:opacity-100 group-hover:opacity-100'
                aria-label={_('Edit')}
              >
                <MdEdit size={size18} />
              </button>
            )}

            <button
              onClick={deleteNote.bind(null, item)}
              className='btn btn-ghost btn-xs border-[#7b342d]/26 bg-[#1a110f]/62 rounded-md border p-0 text-[#b56b5f] opacity-0 transition duration-300 ease-in-out hover:bg-[#2a1613] hover:text-[#e6a093] group-focus-within:opacity-100 group-hover:opacity-100'
              aria-label={_('Delete')}
            >
              <MdDelete size={size18} />
            </button>
          </div>
        </div>
      </div>
    </li>
  );
};

export default BooknoteItem;
