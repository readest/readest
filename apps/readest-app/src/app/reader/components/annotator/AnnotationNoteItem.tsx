import clsx from 'clsx';
import dayjs from 'dayjs';
import React, { useMemo } from 'react';
import { MdEdit } from 'react-icons/md';
import { BookNote } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useSaveBooknoteNoteText } from '../../hooks/useSaveBooknoteNoteText';
import { useInlineTextEditor } from '../../hooks/useInlineTextEditor';
import { parseNoteMarkdown } from '../../utils/noteMarkdown';
import TextButton from '@/components/TextButton';
import TextEditor from '@/components/TextEditor';

interface AnnotationNoteItemProps {
  bookKey: string;
  note: BookNote;
  isVertical: boolean;
  popupHeight: number;
  onDismiss: () => void;
}

const cardClassName = clsx(
  'popup-container rounded-lg',
  'not-eink:shadow-lg bg-base-300 theme-dark:bg-base-100',
);

const AnnotationNoteItem: React.FC<AnnotationNoteItemProps> = ({
  bookKey,
  note,
  isVertical,
  popupHeight,
  onDismiss,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { getConfig, setConfig } = useBookDataStore();
  const { setHoveredBookKey } = useReaderStore();
  const { setSideBarVisible } = useSidebarStore();
  const saveBooknoteNoteText = useSaveBooknoteNoteText(bookKey);
  const size16 = useResponsiveSize(16);
  // Same parser (and sanitizer) as the sidebar so a note previews identically
  // in both places (#5785); cached because the popup re-renders on every
  // reposition and parsing long notes is not free.
  const noteHtml = useMemo(() => (note.note ? parseNoteMarkdown(note.note) : ''), [note.note]);

  const { editorRef, draftText, setDraftText, inlineEditMode, startEdit, cancelEdit, save } =
    useInlineTextEditor((noteText) => saveBooknoteNoteText(note.id, noteText));

  const cardStyle = isVertical
    ? { minWidth: 'max-content', height: `${popupHeight}px`, maxHeight: `${popupHeight}px` }
    : {};

  const handleShowAnnotation = () => {
    if (!note.id) return;

    if (appService?.isMobile) {
      onDismiss();
    }

    setHoveredBookKey('');
    setSideBarVisible(true);
    const config = getConfig(bookKey);
    if (config?.viewSettings) {
      setConfig(bookKey, {
        viewSettings: { ...config.viewSettings, sideBarTab: 'annotations' },
      });
    }
  };

  const handleEditClick = (event: React.MouseEvent) => {
    // Editing must not also trigger the card's own click handler
    // (handleShowAnnotation), which would open the sidebar underneath it.
    event.stopPropagation();
    startEdit(note.note || '');
  };

  if (inlineEditMode) {
    return (
      <div className={cardClassName} style={cardStyle}>
        <div className='m-4 flex flex-col gap-2'>
          <TextEditor
            ref={editorRef}
            value={draftText}
            onChange={setDraftText}
            onSave={save}
            onEscape={cancelEdit}
            spellCheck={false}
            autoFocus
          />
          <div className='flex justify-end gap-3' dir='ltr'>
            <TextButton onClick={cancelEdit}>{_('Cancel')}</TextButton>
            <TextButton onClick={save}>{_('Save')}</TextButton>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      role='none'
      onClick={handleShowAnnotation}
      className={clsx(cardClassName, 'cursor-pointer transition-colors')}
      style={cardStyle}
    >
      {note.note && (
        <div
          dir='auto'
          className={clsx(
            'm-4 hyphens-auto text-justify font-sans text-sm',
            isVertical && 'writing-vertical-rl',
          )}
          style={
            isVertical ? { fontFeatureSettings: "'vrt2' 1, 'vert' 1", minWidth: 'max-content' } : {}
          }
        >
          <div className='flex flex-col justify-between gap-2'>
            <div
              className='prose prose-sm max-w-none'
              dangerouslySetInnerHTML={{ __html: noteHtml }}
            />
            <div className='flex items-center justify-between gap-2'>
              <span className='text-base-content/50 text-sm sm:text-xs'>
                {dayjs(note.createdAt).fromNow()}
              </span>
              {/* Always visible, not hover-gated: the popup is used on touch
                  devices, which have no hover state to reveal it. */}
              <button
                onClick={handleEditClick}
                className='btn btn-ghost btn-xs p-0 text-blue-500 hover:bg-transparent'
                aria-label={_('Edit')}
              >
                <MdEdit size={size16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default React.memo(AnnotationNoteItem);
