import clsx from 'clsx';
import type React from 'react';

import Popup from '@/components/Popup';
import type { Position } from '@/utils/sel';

export interface SelectionAction {
  label: string;
  Icon: React.ElementType;
  onClick: () => void;
}

interface SelectionActionPopupProps {
  actions: SelectionAction[];
  position: Position;
  trianglePosition: Position;
  isVertical: boolean;
  width: number;
  height: number;
  onDismiss: () => void;
}

const SelectionActionPopup: React.FC<SelectionActionPopupProps> = ({
  actions,
  position,
  trianglePosition,
  isVertical,
  width,
  height,
  onDismiss,
}) => (
  <div className='pointer-events-none absolute inset-0 z-[43]'>
    <Popup
      width={isVertical ? height : width}
      height={isVertical ? width : height}
      minHeight={isVertical ? width : height}
      position={position}
      trianglePosition={trianglePosition}
      className='selection-action-popup pointer-events-auto'
      onDismiss={onDismiss}
    >
      <div
        data-testid='selection-action-menu'
        className={clsx(
          'flex h-full w-full items-center gap-1 p-1',
          isVertical ? 'flex-col' : 'flex-row',
        )}
      >
        {actions.map(({ label, Icon, onClick }) => (
          <button
            key={label}
            type='button'
            onClick={onClick}
            className={clsx(
              'not-eink:hover:bg-base-200 flex items-center justify-center gap-1.5 rounded-md',
              'h-9 min-w-0 flex-1 px-2 text-xs font-medium whitespace-nowrap',
              isVertical && 'w-full flex-col px-1',
            )}
            aria-label={label}
          >
            <Icon className='size-4 shrink-0' />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </Popup>
  </div>
);

export default SelectionActionPopup;
