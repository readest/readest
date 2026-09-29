import React from 'react';
import {
  RiPencilLine,
  RiEraserLine,
  RiArrowGoBackLine,
  RiArrowGoForwardLine,
  RiDeleteBinLine,
} from 'react-icons/ri';

import AnnotationToolButton from '../annotator/AnnotationToolButton';
import { useTranslation } from '@/hooks/useTranslation';

interface HandwritingToolbarProps {
  enabled: boolean;
  onToggle: () => void;
  erasing: boolean;
  onToggleErase: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
}

/**
 * Minimal handwriting mode toggle + tools, reusing the existing annotator
 * toolbar's button primitive rather than introducing new chrome.
 */
const HandwritingToolbar: React.FC<HandwritingToolbarProps> = ({
  enabled,
  onToggle,
  erasing,
  onToggleErase,
  onUndo,
  onRedo,
  onClear,
}) => {
  const _ = useTranslation();
  return (
    <div className='flex items-center gap-1'>
      <AnnotationToolButton
        showTooltip
        tooltipText={enabled ? _('Exit Handwriting') : _('Handwriting')}
        Icon={RiPencilLine}
        onClick={onToggle}
      />
      {enabled && (
        <>
          <div className={erasing ? 'bg-base-200 rounded-md' : undefined}>
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
          />
        </>
      )}
    </div>
  );
};

export default HandwritingToolbar;
