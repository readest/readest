import clsx from 'clsx';
import React, { useState } from 'react';
import {
  RiEraserLine,
  RiArrowGoBackLine,
  RiArrowGoForwardLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiSave3Line,
  RiCloseLine,
  RiPencilLine,
  RiMarkPenLine,
} from 'react-icons/ri';

import type { IconType } from 'react-icons';

import type { InkTool } from '@/services/handwriting/model';
import { useTranslation } from '@/hooks/useTranslation';
import AnnotationToolButton from '../annotator/AnnotationToolButton';
import HandwritingOptions from './HandwritingOptions';

const TOOLS: { tool: InkTool; label: string; Icon: IconType }[] = [
  { tool: 'pen', label: 'Pen', Icon: RiPencilLine },
  { tool: 'marker', label: 'Marker', Icon: RiMarkPenLine },
];

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
  /** Finishes the drawing as one annotation and keeps drawing. */
  onSave: () => void;
  /** Leaves drawing mode; every stroke is already saved as it is drawn. */
  onClose: () => void;
  tool: InkTool;
  onSelectTool: (tool: InkTool) => void;
  /** Bottom safe-area inset, filled with the dock's own background. */
  bottomInset?: number;
}

/** Replaces the reader footer while drawing: tools, history, paging, save and close. */
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
  onSave,
  onClose,
  tool,
  onSelectTool,
  bottomInset = 0,
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
    <div
      className={clsx(BAR, 'bottom-0 box-content h-13 justify-between border-t px-3')}
      style={{ paddingBottom: bottomInset }}
    >
      {optionsOpen && (
        <div className='eink-bordered bg-base-100 border-base-300/50 not-eink:shadow-md absolute bottom-full start-3 mb-2 rounded-2xl border px-3 py-2'>
          <HandwritingOptions
            tool={tool}
            color={penColor}
            width={penWidth}
            onSelectColor={choose(onSelectColor)}
            onSelectWidth={choose(onSelectWidth)}
          />
        </div>
      )}
      <div className='flex items-center gap-2'>
        {TOOLS.map(({ tool: value, label, Icon }) => {
          const active = !erasing && tool === value;
          return (
            <button
              key={value}
              type='button'
              aria-label={_(label)}
              aria-pressed={active}
              aria-expanded={active ? optionsOpen : undefined}
              onClick={() => {
                if (active) {
                  setOptionsOpen((open) => !open);
                } else {
                  setOptionsOpen(false);
                  onSelectTool(value);
                }
              }}
              className={clsx(
                'relative flex h-8 min-h-8 w-8 items-center justify-center rounded-md p-0',
                active ? 'bg-base-300 eink:border' : 'not-eink:hover:bg-base-200',
              )}
            >
              <Icon />
              {/* The active tool's ink color, like the band on a Notes tool. */}
              {active && (
                <span
                  className='absolute bottom-1 h-0.5 w-3.5 rounded-full'
                  style={{ backgroundColor: penColor }}
                />
              )}
            </button>
          );
        })}
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
          onClick={onSave}
        />
        <AnnotationToolButton
          showTooltip
          tooltipText={_('Close')}
          Icon={RiCloseLine}
          onClick={onClose}
        />
      </div>
    </div>
  );
};
