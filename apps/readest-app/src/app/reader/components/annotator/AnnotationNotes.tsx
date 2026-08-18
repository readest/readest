import clsx from 'clsx';
import React, { useMemo } from 'react';
import { BookNote } from '@/types/book';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import AnnotationNoteItem from './AnnotationNoteItem';

interface AnnotationNotesProps {
  bookKey: string;
  isVertical: boolean;
  notes: BookNote[];
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
  toolsVisible,
  triangleDir,
  popupWidth,
  popupHeight,
  onDismiss,
}) => {
  const maxSize = useResponsiveSize(250);

  const sortedNotes = useMemo(() => {
    return [...notes].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [notes]);

  return (
    <div
      className={clsx('annotation-notes text-base-content absolute flex rounded-lg')}
      style={{
        ...(isVertical
          ? {
              right: triangleDir === 'left' ? `${toolsVisible ? popupWidth + 16 : 0}px` : undefined,
              left: triangleDir === 'right' ? `${toolsVisible ? popupWidth + 16 : 0}px` : undefined,
              height: `${popupHeight}px`,
              maxWidth: `${maxSize}px`,
              overflowX: 'auto',
            }
          : {
              top: triangleDir === 'down' ? `${toolsVisible ? popupHeight + 16 : 0}px` : undefined,
              bottom: triangleDir === 'up' ? `${toolsVisible ? popupHeight + 16 : 0}px` : undefined,
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
