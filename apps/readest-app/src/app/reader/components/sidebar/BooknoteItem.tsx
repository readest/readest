import clsx from 'clsx';
import dayjs from 'dayjs';
import React, { useEffect, useMemo } from 'react';
import { MdEdit, MdDelete, MdContentCopy, MdPlaylistAdd } from 'react-icons/md';

import { useEnv } from '@/context/EnvContext';
import { BookNote, HighlightColor } from '@/types/book';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { useNotebookStore } from '@/store/notebookStore';
import { useNotebookDocumentStore } from '@/store/notebookDocumentStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { eventDispatcher } from '@/utils/event';
import { isCfiInLocation } from '@/utils/cfi';
import { buildAnnotationUrl } from '@/utils/deeplink';
import { buildAnnotationCopyMarkdown } from '@/utils/note';
import { writeTextToClipboard } from '@/utils/clipboard';
import { DEFAULT_NOTE_EXPORT_CONFIG } from '@/services/constants';
import {
  removeBookNoteOverlays,
  removeEmptyAnnotationPlaceholder,
} from '../../utils/annotatorUtil';
import { parseNoteMarkdown } from '../../utils/noteMarkdown';
import { useSaveBooknoteNoteText } from '../../hooks/useSaveBooknoteNoteText';
import { useInlineTextEditor } from '../../hooks/useInlineTextEditor';
import TextButton from '@/components/TextButton';
import TextEditor from '@/components/TextEditor';

interface BooknoteItemProps {
  bookKey: string;
  item: BookNote;
  isNearest?: boolean;
  onClick?: () => void;
  inlineNoteEditing?: boolean;
  startEditing?: boolean;
  placeholderIds?: string[];
  onFinishEditing?: () => void;
}

const BooknoteItem: React.FC<BooknoteItemProps> = ({
  bookKey,
  item,
  isNearest,
  onClick,
  inlineNoteEditing,
  startEditing,
  placeholderIds = [],
  onFinishEditing,
}) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { settings } = useSettingsStore();
  const { getConfig, saveConfig, updateBooknotes } = useBookDataStore();
  const { getProgress, getView, getViewsById, getViewSettings } = useReaderStore();
  const { setNotebookActiveTab, setNotebookEditAnnotation, setNotebookVisible } =
    useNotebookStore();
  const { setSideBarVisible } = useSidebarStore();

  const globalReadSettings = settings.globalReadSettings;
  const customColors = globalReadSettings.customHighlightColors;

  const { text, cfi, note } = item;
  const isBookmark = item.type === 'bookmark';
  const saveBooknoteNoteText = useSaveBooknoteNoteText(bookKey);
  const saveBookmarkText = (draftText: string) => {
    const config = getConfig(bookKey);
    if (!config || !draftText) return;
    const { booknotes: annotations = [] } = config;
    const existingIndex = annotations.findIndex((annotation) => item.id === annotation.id);
    if (existingIndex === -1) return;
    annotations[existingIndex]!.updatedAt = Date.now();
    annotations[existingIndex]!.text = draftText;
    const updatedConfig = updateBooknotes(bookKey, annotations);
    if (updatedConfig) {
      saveConfig(envConfig, bookKey, updatedConfig, settings);
    }
  };
  const { editorRef, draftText, setDraftText, inlineEditMode, startEdit, cancelEdit, save } =
    useInlineTextEditor((draftText) => {
      if (isBookmark) saveBookmarkText(draftText);
      else saveBooknoteNoteText(item.id, draftText);
      onFinishEditing?.();
    });
  const separatorWidth = useResponsiveSize(3);
  const size18 = useResponsiveSize(18);

  const progress = getProgress(bookKey);
  // Active highlight: keep visual "current" state but don't scroll from the
  // item itself anymore — the parent (virtualized) BooknoteView handles
  // scrolling via virtuosoRef.scrollToIndex, avoiding N getBoundingClientRect
  // calls when the list grows large.
  const isCurrent = useMemo(
    () => isCfiInLocation(cfi, progress?.location) || !!isNearest,
    [cfi, progress?.location, isNearest],
  );

  // parseNoteMarkdown is heavy when called on every list scroll re-render
  // across hundreds of items. Cache by note text — note edits change
  // item.note and bust the cache automatically.
  const noteHtml = useMemo(() => (note ? parseNoteMarkdown(note) : ''), [note]);

  // dayjs().fromNow() reformats every render; cache per createdAt.
  const createdAtLabel = useMemo(() => dayjs(item.createdAt).fromNow(), [item.createdAt]);

  const handleClickItem = (event: React.MouseEvent | React.KeyboardEvent) => {
    event.preventDefault();
    eventDispatcher.dispatch('navigate', { bookKey, cfi });

    onClick?.();
    getView(bookKey)?.goTo(cfi);
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

  const buildSourceMarkdown = () => {
    const bookHash = item.bookHash || bookKey.split('-')[0]!;
    const linkType =
      getViewSettings(bookKey)?.noteExportConfig?.linkType ?? DEFAULT_NOTE_EXPORT_CONFIG.linkType;
    const url = buildAnnotationUrl({ bookHash, noteId: item.id, cfi: item.cfi }, linkType);
    const linkLabel = item.page
      ? _('Page: {{number}}', { number: item.page })
      : _('Open in Readest');
    return {
      bookHash,
      markdown: buildAnnotationCopyMarkdown({
        text: item.text,
        note: item.note,
        noteLabel: _('Note'),
        url,
        linkLabel,
      }),
    };
  };

  const handleCopyLink = () => {
    const { markdown } = buildSourceMarkdown();
    void writeTextToClipboard(markdown);
    eventDispatcher.dispatch('toast', {
      type: 'info',
      message: _('Copied to clipboard'),
      className: 'whitespace-nowrap',
      timeout: 2000,
    });
  };

  const handleInsertIntoNotebook = () => {
    const { bookHash, markdown } = buildSourceMarkdown();
    const result = useNotebookDocumentStore.getState().insert(bookHash, markdown);
    if (!result.accepted) {
      eventDispatcher.dispatch('toast', {
        type: 'warning',
        message: _('Notebook is too large to save. Copy or remove some text to continue.'),
        timeout: 3000,
      });
      return;
    }
    setNotebookActiveTab('notes');
    setNotebookVisible(true);
    if (appService?.isMobile || window.innerWidth < 640 || window.innerHeight < 640) {
      setSideBarVisible(false);
    }
  };

  const editBookmark = () => startEdit(text || '');

  const editNoteInline = () => startEdit(item.note || '');

  useEffect(() => {
    if (startEditing) startEdit(item.note || '');
  }, [item.note, startEdit, startEditing]);

  const cancelRequestedEdit = () => {
    if (placeholderIds.length > 0) {
      const config = getConfig(bookKey);
      const { booknotes = [] } = config ?? {};
      const removed = placeholderIds
        .map((id) => removeEmptyAnnotationPlaceholder(booknotes, id, Date.now()))
        .filter((placeholder): placeholder is BookNote => placeholder !== null);
      if (removed.length > 0) {
        const views = getViewsById(bookKey.split('-')[0]!);
        removed.forEach((placeholder) => {
          views.forEach((view) => removeBookNoteOverlays(view, placeholder));
        });
        const updatedConfig = updateBooknotes(bookKey, booknotes);
        if (updatedConfig) saveConfig(envConfig, bookKey, updatedConfig, settings);
      }
    }
    cancelEdit();
    onFinishEditing?.();
  };

  if (inlineEditMode) {
    return (
      <div
        data-testid='booknote-note-editor'
        className={clsx(
          'border-base-300 content group relative my-2 cursor-pointer rounded-lg p-2',
          isCurrent ? 'bg-base-300/85 hover:bg-base-300' : 'hover:bg-base-300/55 bg-base-100',
          'transition-all duration-300 ease-in-out',
        )}
      >
        <div className='flex w-full'>
          <TextEditor
            className='leading-normal!'
            ref={editorRef}
            value={draftText}
            onChange={setDraftText}
            onSave={save}
            onEscape={startEditing ? cancelRequestedEdit : cancelEdit}
            spellCheck={false}
            autoFocus
          />
        </div>
        <div className='flex justify-end space-x-3 p-2' dir='ltr'>
          <TextButton onClick={startEditing ? cancelRequestedEdit : cancelEdit}>
            {_('Cancel')}
          </TextButton>
          <TextButton onClick={save} disabled={isBookmark && !draftText}>
            {_('Save')}
          </TextButton>
        </div>
      </div>
    );
  }

  const isEditable =
    !!item.note || isBookmark || (!!inlineNoteEditing && item.type === 'annotation');

  return (
    <li
      // eslint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role
      role='button'
      aria-current={isCurrent ? 'page' : undefined}
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
            dangerouslySetInnerHTML={{ __html: noteHtml }}
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
                item.note && 'content font-size-xs text-base-content',
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
            <span className='truncate text-sm text-gray-500 sm:text-xs'>
              {item.page ? _('p {{page}}' + ' · ', { page: item.page }) : ''}
            </span>
            <span className='truncate text-sm text-gray-500 sm:text-xs'>{createdAtLabel}</span>
          </div>
          <div
            className={clsx('flex items-center justify-end gap-4', isEditable && 'w-full')}
            dir='ltr'
          >
            <button
              onClick={handleCopyLink}
              className='btn btn-ghost btn-xs text-base-content p-0 opacity-0 transition duration-300 ease-in-out hover:bg-transparent group-focus-within:opacity-100 group-hover:opacity-100'
              aria-label={_('Copy')}
            >
              <MdContentCopy size={size18} />
            </button>

            {(item.type === 'annotation' || item.type === 'excerpt') && (
              <button
                onClick={handleInsertIntoNotebook}
                className='btn btn-ghost btn-xs text-base-content p-0 opacity-0 transition duration-300 ease-in-out hover:bg-transparent group-focus-within:opacity-100 group-hover:opacity-100'
                aria-label={_('Insert into Notebook')}
              >
                <MdPlaylistAdd size={size18} />
              </button>
            )}

            <button
              onClick={deleteNote.bind(null, item)}
              className='btn btn-ghost btn-xs p-0 text-red-500 opacity-0 transition duration-300 ease-in-out hover:bg-transparent group-focus-within:opacity-100 group-hover:opacity-100'
              aria-label={_('Delete')}
            >
              <MdDelete size={size18} />
            </button>

            {isEditable && (
              <button
                onClick={
                  item.type === 'bookmark'
                    ? editBookmark
                    : inlineNoteEditing
                      ? editNoteInline
                      : editNote.bind(null, item)
                }
                className='btn btn-ghost btn-xs p-0 text-blue-500 opacity-0 transition duration-300 ease-in-out hover:bg-transparent group-focus-within:opacity-100 group-hover:opacity-100'
                aria-label={item.note || item.type === 'bookmark' ? _('Edit') : _('Add Note')}
              >
                <MdEdit size={size18} />
              </button>
            )}
          </div>
        </div>
      </div>
    </li>
  );
};

// Memoize: BooknoteView re-renders on every progress tick / config change.
// Without React.memo each tick would re-render every visible note row even
// though their props are unchanged. Default shallow compare is enough since
// `item` and `onClick` are stable references from the parent's useMemo /
// useCallback.
export default React.memo(BooknoteItem);
