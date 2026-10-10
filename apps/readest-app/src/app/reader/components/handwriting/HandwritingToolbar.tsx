import React from 'react';
import {
  RiPencilLine,
  RiEraserLine,
  RiArrowGoBackLine,
  RiArrowGoForwardLine,
  RiDeleteBinLine,
  RiPaletteLine,
} from 'react-icons/ri';

import AnnotationToolButton from '../annotator/AnnotationToolButton';
import { useTranslation } from '@/hooks/useTranslation';
import HandwritingOptions from './HandwritingOptions';

interface HandwritingToolbarProps {
  enabled: boolean;
  onToggle: () => void;
  erasing: boolean;
  onToggleErase: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  penColor: string;
  penWidth: number;
  onSelectColor: (color: string) => void;
  onSelectWidth: (width: number) => void;
  onRestyle: () => void;
  hasInk: boolean;
}

/**
 * Minimal handwriting mode toggle + tools, reusing the existing annotator
 * toolbar's button primitive rather than introducing new chrome. The pen
 * swatches show only while drawing, so the toolbar stays a single row when
 * handwriting is off.
 */
const HandwritingToolbar: React.FC<HandwritingToolbarProps> = ({
  enabled,
  onToggle,
  erasing,
  onToggleErase,
  onUndo,
  onRedo,
  onClear,
  penColor,
  penWidth,
  onSelectColor,
  onSelectWidth,
  onRestyle,
  hasInk,
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
          <HandwritingOptions
            color={penColor}
            width={penWidth}
            onSelectColor={onSelectColor}
            onSelectWidth={onSelectWidth}
          />
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
          {/* Only meaningful once the page has ink; keeps the row short on a
              blank page. */}
          {hasInk && (
            <AnnotationToolButton
              showTooltip
              tooltipText={_('Restyle Page Ink')}
              Icon={RiPaletteLine}
              onClick={onRestyle}
            />
          )}
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
