import clsx from 'clsx';
import React from 'react';
import {
  RiEraserLine,
  RiArrowGoBackLine,
  RiArrowGoForwardLine,
  RiDeleteBinLine,
  RiCheckLine,
} from 'react-icons/ri';

import AnnotationToolButton from '../annotator/AnnotationToolButton';
import { useTranslation } from '@/hooks/useTranslation';
import HandwritingOptions from './HandwritingOptions';

interface HandwritingToolbarProps {
  onExit: () => void;
  erasing: boolean;
  onToggleErase: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  hasInk: boolean;
  penColor: string;
  penWidth: number;
  onSelectColor: (color: string) => void;
  onSelectWidth: (width: number) => void;
}

/** Pen, eraser and history controls shown while handwriting mode is on. */
const HandwritingToolbar: React.FC<HandwritingToolbarProps> = ({
  onExit,
  erasing,
  onToggleErase,
  onUndo,
  onRedo,
  onClear,
  hasInk,
  penColor,
  penWidth,
  onSelectColor,
  onSelectWidth,
}) => {
  const _ = useTranslation();
  return (
    <div className='eink-bordered bg-base-100 not-eink:shadow-md not-eink:border-base-content/10 flex max-w-full items-center gap-1 overflow-x-auto rounded-2xl border px-2 py-1'>
      <HandwritingOptions
        color={penColor}
        width={penWidth}
        onSelectColor={onSelectColor}
        onSelectWidth={onSelectWidth}
      />
      <div className='bg-base-content/20 mx-0.5 h-5 w-px shrink-0' />
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
      <AnnotationToolButton
        showTooltip
        tooltipText={_('Clear Page')}
        Icon={RiDeleteBinLine}
        onClick={onClear}
        disabled={!hasInk}
      />
      <AnnotationToolButton
        showTooltip
        tooltipText={_('Done')}
        Icon={RiCheckLine}
        onClick={onExit}
      />
    </div>
  );
};

export default HandwritingToolbar;
