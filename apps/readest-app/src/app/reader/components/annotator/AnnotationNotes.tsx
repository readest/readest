import clsx from 'clsx';
import React, { useMemo } from 'react';
import { BookNote } from '@/types/book';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import AnnotationNoteItem from './AnnotationNoteItem';

interface AnnotationNotesProps {
  bookKey: string;
  isVertical: boolean;
  notes: BookNote[];
  onEditNote?: (note: BookNote) => void;
  toolsVisible: boolean;
  triangleDir: 'up' | 'down' | 'left' | 'right';
  popupWidth: number;
  popupHeight: number;
  onDismiss: () => void;
}

const AnnotationNotes: React.FC<AnnotationNotesProps> = ({
  bookKey,
  isVertical,
  notes,
  onEditNote,
  toolsVisible,
  triangleDir,
  popupWidth,
  popupHeight,
  onDismiss,
}) => {
  const maxSize = useResponsiveSize(250);

  // The popup box this card sits in has a 1px border; stepping out over it
  // puts the card's own border on the box's edge, where the triangle joins.
  const edge = toolsVisible ? undefined : '-1px';

  const sortedNotes = useMemo(() => {
    return [...notes].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [notes]);

  return (
    <div
      className={clsx('annotation-notes text-base-content absolute flex rounded-lg')}
      style={{
        ...(isVertical
          ? {
              right: triangleDir === 'left' ? (edge ?? `${popupWidth + 16}px`) : undefined,
              left: triangleDir === 'right' ? (edge ?? `${popupWidth + 16}px`) : undefined,
              top: edge,
              height: `${popupHeight}px`,
              maxWidth: `${maxSize}px`,
              overflowX: 'auto',
            }
          : {
              top: triangleDir === 'down' ? (edge ?? `${popupHeight + 16}px`) : undefined,
              bottom: triangleDir === 'up' ? (edge ?? `${popupHeight + 16}px`) : undefined,
              left: edge,
              width: `${popupWidth}px`,
              maxHeight: `${maxSize}px`,
              overflowY: 'auto',
            }),
        scrollbarWidth: 'thin',
      }}
    >
      <div
        className={clsx('flex gap-4', isVertical ? 'h-full flex-row' : 'w-full flex-col')}
        style={
          isVertical
            ? {
                display: 'grid',
                gridAutoFlow: 'column',
                gridAutoColumns: 'max-content',
                minWidth: 'min-content',
                height: `${popupHeight}px`,
                maxHeight: `${popupHeight}px`,
              }
            : {}
        }
      >
        {sortedNotes.map((note, index) => (
          <AnnotationNoteItem
            key={note.id || index}
            bookKey={bookKey}
            note={note}
            onEdit={onEditNote}
            isVertical={isVertical}
            popupHeight={popupHeight}
            onDismiss={onDismiss}
          />
        ))}
      </div>
    </div>
  );
};

export default AnnotationNotes;
