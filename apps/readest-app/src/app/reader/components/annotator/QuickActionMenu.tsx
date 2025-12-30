import clsx from 'clsx';
import React from 'react';
import { MdCheck } from 'react-icons/md';

import { AnnotationToolType } from '@/types/annotator';
import { useTranslation } from '@/hooks/useTranslation';
import { annotationToolQuickActions } from './AnnotationTools';
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
  };

  return (
    <Menu
      className={clsx(
        'annotation-quick-action-menu dropdown-content z-20 mt-1 border',
        'bgcolor-base-200 border-base-200 shadow-2xl',
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
          Icon={selectedAction === button.type ? MdCheck : button.Icon}
          onClick={() => handleActionClick(button.type)}
        />
      ))}
    </Menu>
  );
};

export default QuickActionMenu;
