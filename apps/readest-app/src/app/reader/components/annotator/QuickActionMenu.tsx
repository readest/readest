import clsx from 'clsx';
import React from 'react';

import { AnnotationToolType } from '@/types/annotator';
import { useTranslation } from '@/hooks/useTranslation';
import { annotationToolQuickActions } from './AnnotationTools';
import { eventDispatcher } from '@/utils/event';
import MenuItem from '@/components/MenuItem';
import Menu from '@/components/Menu';

interface QuickActionMenuProps {
  selectedAction?: AnnotationToolType | null;
  onActionSelect: (action: AnnotationToolType) => void;
  setIsDropdownOpen?: (open: boolean) => void;
}

const QuickActionMenu: React.FC<QuickActionMenuProps> = ({
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
        message: _('Quick action disabled'),
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
        'annotation-quick-action-menu dropdown-content z-20 mt-1 border',
        'bgcolor-base-200 shadow-2xl',
      )}
      style={{
        maxWidth: `${window.innerWidth - 40}px`,
      }}
      onCancel={() => setIsDropdownOpen?.(false)}
    >
      {annotationToolQuickActions.map((button) => (
        <MenuItem
          key={button.type}
          label={_(button.label)}
          tooltip={_(button.tooltip)}
          buttonClass={selectedAction === button.type ? 'bg-base-300/85' : ''}
          Icon={button.Icon}
          onClick={() => handleActionClick(button.type)}
        />
      ))}
    </Menu>
  );
};

export default QuickActionMenu;
