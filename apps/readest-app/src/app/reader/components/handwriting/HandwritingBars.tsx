import clsx from 'clsx';
import React, { useState } from 'react';
import {
  RiEraserLine,
  RiArrowGoBackLine,
  RiArrowGoForwardLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiArrowDropDownLine,
  RiSave3Line,
} from 'react-icons/ri';

import { useTranslation } from '@/hooks/useTranslation';
import AnnotationToolButton from '../annotator/AnnotationToolButton';
import HandwritingOptions from './HandwritingOptions';

const BAR =
  'eink-bordered bg-base-100 border-base-300/50 absolute inset-x-0 z-30 flex items-center';

interface HandwritingDockProps {
  erasing: boolean;
  onToggleErase: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onTurnLeft: () => void;
  onTurnRight: () => void;
  penColor: string;
  penWidth: number;
  onSelectColor: (color: string) => void;
  onSelectWidth: (width: number) => void;
  /** Ends the drawing session; every stroke is already saved as it is drawn. */
  onDone: () => void;
  bottom?: number;
}

/** Replaces the reader footer while drawing: pen, eraser, history, paging and save. */
export const HandwritingDock: React.FC<HandwritingDockProps> = ({
  erasing,
  onToggleErase,
  onUndo,
  onRedo,
  onTurnLeft,
  onTurnRight,
  penColor,
  penWidth,
  onSelectColor,
  onSelectWidth,
  onDone,
  bottom = 0,
}) => {
  const _ = useTranslation();
  const [optionsOpen, setOptionsOpen] = useState(false);
  const choose =
    <T,>(select: (value: T) => void) =>
    (value: T) => {
      select(value);
      setOptionsOpen(false);
    };

  return (
    <div className={clsx(BAR, 'h-13 justify-between border-t px-3')} style={{ bottom }}>
      {optionsOpen && (
        <div className='eink-bordered bg-base-100 border-base-300/50 not-eink:shadow-md absolute bottom-full start-3 mb-2 rounded-2xl border px-3 py-2'>
          <HandwritingOptions
            color={penColor}
            width={penWidth}
            onSelectColor={choose(onSelectColor)}
            onSelectWidth={choose(onSelectWidth)}
          />
        </div>
      )}
      <div className='flex items-center gap-2'>
        <button
          type='button'
          aria-label={_('Pen')}
          aria-expanded={optionsOpen}
          onClick={() => setOptionsOpen((open) => !open)}
          className={clsx(
            'flex h-8 items-center gap-0.5 rounded-md px-1',
            !erasing && 'bg-base-300 eink:border',
          )}
        >
          <span
            className='border-base-content/20 h-4 w-4 rounded-full border'
            style={{ backgroundColor: penColor }}
          />
          <RiArrowDropDownLine size={20} />
        </button>
        <div className={clsx('rounded-md', erasing && 'bg-base-300 eink:border')}>
          <AnnotationToolButton
            showTooltip
            tooltipText={_('Eraser')}
            Icon={RiEraserLine}
            onClick={onToggleErase}
          />
        </div>
        <AnnotationToolButton
          showTooltip
          tooltipText={_('Undo')}
          Icon={RiArrowGoBackLine}
          onClick={onUndo}
        />
        <AnnotationToolButton
          showTooltip
          tooltipText={_('Redo')}
          Icon={RiArrowGoForwardLine}
          onClick={onRedo}
        />
      </div>
      {/* Pages turn by their on-screen side, like the reader's own buttons. */}
      <div className='flex items-center gap-2' dir='ltr'>
        <AnnotationToolButton
          showTooltip
          tooltipText={_('Previous Page')}
          Icon={RiArrowLeftSLine}
          onClick={onTurnLeft}
        />
        <AnnotationToolButton
          showTooltip
          tooltipText={_('Next Page')}
          Icon={RiArrowRightSLine}
          onClick={onTurnRight}
        />
        <AnnotationToolButton
          showTooltip
          tooltipText={_('Save')}
          Icon={RiSave3Line}
          onClick={onDone}
        />
      </div>
    </div>
  );
};
