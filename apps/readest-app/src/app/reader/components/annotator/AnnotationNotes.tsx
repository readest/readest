import clsx from 'clsx';
import React from 'react';
import { BookNote } from '@/types/book';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';

interface AnnotationNotesProps {
  bookKey: string;
  isVertical: boolean;
  notes: BookNote[];
  triangleDir: 'up' | 'down' | 'left' | 'right';
  popupWidth: number;
  popupHeight: number;
}

const AnnotationNotes: React.FC<AnnotationNotesProps> = ({
  bookKey,
  isVertical,
  notes,
  triangleDir,
  popupWidth,
  popupHeight,
}) => {
  const { getConfig, setConfig } = useBookDataStore();
  const { setHoveredBookKey } = useReaderStore();
  const { setSideBarVisible } = useSidebarStore();
  const config = getConfig(bookKey);
  const maxSize = useResponsiveSize(300);

  const handleShowAnnotation = (note: BookNote) => {
    if (!note.id) return;

    setHoveredBookKey('');
    setSideBarVisible(true);
    if (config?.viewSettings) {
      setConfig(bookKey, {
        viewSettings: { ...config.viewSettings, sideBarTab: 'annotations' },
      });
    }
  };

  return (
    <div
      className={clsx(
        'annotation-notes absolute flex overflow-y-auto rounded-lg text-white shadow-lg',
        'flex-col',
      )}
      style={{
        ...(isVertical
          ? {
              right: `${triangleDir === 'left' ? `${popupWidth + 16}px` : undefined}`,
              left: `${triangleDir === 'right' ? `${popupWidth + 16}px` : undefined}`,
              height: `${popupHeight}px`,
              maxWidth: `${maxSize}px`,
            }
          : {
              top: triangleDir === 'up' ? undefined : `${popupHeight + 16}px`,
              bottom: triangleDir === 'up' ? `${popupHeight + 16}px` : undefined,
              width: `${popupWidth}px`,
              maxHeight: `${maxSize}px`,
            }),
        scrollbarWidth: 'thin',
      }}
    >
      <div className={clsx('flex gap-4', isVertical ? 'h-full flex-row' : 'flex-col')}>
        {notes.map((note, index) => (
          <div
            role='none'
            key={note.id || index}
            onClick={() => handleShowAnnotation?.(note)}
            className='cursor-pointer rounded-lg bg-gray-600 p-4 shadow-md transition-colors'
          >
            {note.note && (
              <div
                dir='auto'
                className={clsx(
                  'hyphens-auto text-justify font-sans text-sm text-white',
                  isVertical && 'writing-vertical-rl',
                )}
                style={
                  isVertical
                    ? {
                        fontFeatureSettings: "'vrt2' 1, 'vert' 1",
                      }
                    : {}
                }
              >
                {note.note}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default AnnotationNotes;
