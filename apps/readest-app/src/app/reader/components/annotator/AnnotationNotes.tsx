import clsx from 'clsx';
import dayjs from 'dayjs';
import React, { useMemo } from 'react';
import { BookNote } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';

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
  const { appService } = useEnv();
  const { getConfig, setConfig } = useBookDataStore();
  const { setHoveredBookKey } = useReaderStore();
  const { setSideBarVisible } = useSidebarStore();
  const config = getConfig(bookKey);
  const maxSize = useResponsiveSize(250);

  const sortedNotes = useMemo(() => {
    return [...notes].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [notes]);

  const handleShowAnnotation = (note: BookNote) => {
    if (!note.id) return;

    if (appService?.isMobile) {
      onDismiss();
    }

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
      className={clsx('annotation-notes absolute flex rounded-lg text-white')}
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
          <div
            role='none'
            key={note.id || index}
            onClick={() => handleShowAnnotation?.(note)}
            className={clsx(
              'popup-container cursor-pointer rounded-lg bg-gray-600 shadow-lg transition-colors',
            )}
            style={
              isVertical
                ? {
                    minWidth: 'max-content',
                    height: `${popupHeight}px`,
                    maxHeight: `${popupHeight}px`,
                  }
                : {}
            }
          >
            {note.note && (
              <div
                dir='auto'
                className={clsx(
                  'm-4 hyphens-auto text-justify font-sans text-sm',
                  'not-eink:text-white eink:text-base-content',
                  isVertical && 'writing-vertical-rl',
                )}
                style={
                  isVertical
                    ? {
                        fontFeatureSettings: "'vrt2' 1, 'vert' 1",
                        minWidth: 'max-content',
                      }
                    : {}
                }
              >
                <div className={clsx('flex flex-col justify-between gap-2')}>
                  {note.note}
                  <span className='not-eink:text-white/50 eink:text-base-content/50 text-sm sm:text-xs'>
                    {dayjs(note.createdAt).fromNow()}
                  </span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default AnnotationNotes;
