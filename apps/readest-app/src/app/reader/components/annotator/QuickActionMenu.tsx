import clsx from 'clsx';
import React from 'react';
import { PiScribbleLoop } from 'react-icons/pi';

import { AnnotationToolType } from '@/types/annotator';
import { useTranslation } from '@/hooks/useTranslation';
import { annotationToolQuickActions } from './AnnotationTools';
import { eventDispatcher } from '@/utils/event';
import MenuItem from '@/components/MenuItem';
import Menu from '@/components/Menu';

interface QuickActionMenuProps {
  /** The book to draw on; offers Draw among the tools when given. */
  bookKey?: string;
  menuClassName?: string;
  selectedAction?: AnnotationToolType | null;
  onActionSelect: (action: AnnotationToolType) => void;
  setIsDropdownOpen?: (open: boolean) => void;
}

const QuickActionMenu: React.FC<QuickActionMenuProps> = ({
  bookKey,
  menuClassName,
  selectedAction,
  onActionSelect,
  setIsDropdownOpen,
}) => {
  const _ = useTranslation();

  const handleActionClick = (action: AnnotationToolType) => {
    onActionSelect(action);
    if (selectedAction === action) {
      eventDispatcher.dispatch('toast', {
        type: 'info',
        timeout: 2000,
        message: _('Instant {{action}} Disabled', {
          action: _(
            annotationToolQuickActions.find((btn) => btn.type === action)?.label || _('Annotation'),
          ),
        }),
      });
    } else {
      eventDispatcher.dispatch('toast', {
        type: 'info',
        timeout: 2000,
        message: _(annotationToolQuickActions.find((btn) => btn.type === action)?.tooltip || ''),
      });
    }
    setIsDropdownOpen?.(false);
  };

  return (
    <Menu
      className={clsx(
        'annotation-quick-action-menu dropdown-content z-20 mt-1.5 border',
        'bgcolor-base-200 shadow-2xl',
        menuClassName,
      )}
      onCancel={() => setIsDropdownOpen?.(false)}
    >
      {annotationToolQuickActions.map((button) => (
        <MenuItem
          key={button.type}
          label={_('Instant {{action}}', { action: _(button.label) })}
          tooltip={_(button.tooltip)}
          buttonClass={selectedAction === button.type ? 'bg-base-300/85' : ''}
          Icon={button.Icon}
          onClick={() => handleActionClick(button.type)}
        />
      ))}
      {bookKey && (
        <MenuItem
          label={_('Instant {{action}}', { action: _('Draw') })}
          Icon={PiScribbleLoop}
          onClick={() => {
            eventDispatcher.dispatch('handwriting', { action: 'toggle', bookKey });
            setIsDropdownOpen?.(false);
          }}
        />
      )}
    </Menu>
  );
};

export default QuickActionMenu;
