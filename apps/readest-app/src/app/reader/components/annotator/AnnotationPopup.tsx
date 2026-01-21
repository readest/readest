import clsx from 'clsx';
import React from 'react';
import { Position } from '@/utils/sel';
import { BookNote, HighlightColor, HighlightStyle } from '@/types/book';
import Popup from '@/components/Popup';
import AnnotationToolButton from './AnnotationToolButton';
import AnnotationNotes from './AnnotationNotes';
import HighlightOptions from './HighlightOptions';

interface AnnotationPopupProps {
  bookKey: string;
  dir: 'ltr' | 'rtl';
  isVertical: boolean;
  buttons: Array<{
    tooltipText: string;
    Icon: React.ElementType;
    onClick: () => void;
    disabled?: boolean;
    visible?: boolean;
  }>;
  notes: BookNote[];
  position: Position;
  trianglePosition: Position;
  highlightOptionsVisible: boolean;
  selectedStyle: HighlightStyle;
  selectedColor: HighlightColor;
  popupWidth: number;
  popupHeight: number;
  onHighlight: (update?: boolean) => void;
  onDismiss: () => void;
}

const AnnotationPopup: React.FC<AnnotationPopupProps> = ({
  bookKey,
  dir,
  isVertical,
  buttons,
  notes,
  position,
  trianglePosition,
  highlightOptionsVisible,
  selectedStyle,
  selectedColor,
  popupWidth,
  popupHeight,
  onHighlight,
  onDismiss,
}) => {
  return (
    <div dir={dir}>
      <Popup
        width={isVertical ? popupHeight : popupWidth}
        height={isVertical ? popupWidth : popupHeight}
        minHeight={isVertical ? popupWidth : popupHeight}
        position={position}
        trianglePosition={trianglePosition}
        className={clsx(
          'selection-popup bg-gray-600 text-white',
          notes.length > 0 && 'bg-transparent',
        )}
        triangleClassName='text-gray-600'
        onDismiss={onDismiss}
      >
        <div className={clsx('flex h-full gap-4', isVertical ? 'flex-row' : 'flex-col')}>
          <div
            className={clsx(
              'selection-buttons flex h-full w-full items-center justify-between p-2',
              isVertical ? 'flex-col overflow-y-auto' : 'flex-row overflow-x-auto',
              notes.length > 0 && 'hidden',
            )}
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {buttons.map((button, index) => {
              if (button.visible === false) return null;
              return (
                <AnnotationToolButton
                  key={index}
                  showTooltip={!highlightOptionsVisible}
                  tooltipText={button.tooltipText}
                  Icon={button.Icon}
                  onClick={button.onClick}
                  disabled={button.disabled}
                />
              );
            })}
          </div>
          {notes.length > 0 ? (
            <AnnotationNotes
              bookKey={bookKey}
              isVertical={isVertical}
              notes={notes}
              toolsVisible={false}
              triangleDir={trianglePosition.dir!}
              popupWidth={isVertical ? popupHeight : popupWidth}
              popupHeight={isVertical ? popupWidth : popupHeight}
              onDismiss={onDismiss}
            />
          ) : (
            highlightOptionsVisible && (
              <HighlightOptions
                isVertical={isVertical}
                triangleDir={trianglePosition.dir!}
                popupWidth={isVertical ? popupHeight : popupWidth}
                popupHeight={isVertical ? popupWidth : popupHeight}
                selectedStyle={selectedStyle}
                selectedColor={selectedColor}
                onHandleHighlight={onHighlight}
              />
            )
          )}
        </div>
      </Popup>
    </div>
  );
};

export default AnnotationPopup;
