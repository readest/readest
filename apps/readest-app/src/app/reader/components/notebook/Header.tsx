import clsx from 'clsx';
import React from 'react';

import {
  MdArrowBackIosNew,
  MdClose,
  MdOutlinePushPin,
  MdPushPin,
  MdSettings,
} from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useSettingsStore } from '@/store/settingsStore';
import { NotebookTab } from '@/store/notebookStore';
import { getNotebookTabs } from './notebookTabs';

const NotebookHeader: React.FC<{
  bookKey: string;
  activeTab: NotebookTab;
  isPinned: boolean;
  isFullScreenMobile?: boolean;
  handleClose: () => void;
  handleTogglePin: () => void;
}> = ({
  bookKey,
  activeTab,
  isPinned,
  isFullScreenMobile = false,
  handleClose,
  handleTogglePin,
}) => {
  const _ = useTranslation();
  const iconSize15 = useResponsiveSize(15);
  const iconSize18 = useResponsiveSize(18);
  const { setSettingsDialogBookKey, setActiveSettingsItemId, setSettingsDialogOpen } =
    useSettingsStore();
  const { title, titleIcon: TitleIcon, settings } = getNotebookTabs(_)[activeTab];

  const openSettings = (id: string) => {
    setSettingsDialogBookKey(bookKey);
    setActiveSettingsItemId(id);
    setSettingsDialogOpen(true);
  };

  const closeButton = (
    <button
      title={_('Close')}
      aria-label={_('Close')}
      onClick={handleClose}
      className={clsx(
        'btn btn-ghost btn-circle flex h-11 min-h-11 w-11 hover:bg-transparent',
        !isFullScreenMobile && 'sm:hidden',
      )}
    >
      {isFullScreenMobile ? <MdClose size={iconSize18} /> : <MdArrowBackIosNew />}
    </button>
  );

  return (
    <div className='notebook-header relative flex h-11 items-center px-3' dir='ltr'>
      <div className='absolute inset-0 z-[-1] flex items-center justify-center space-x-2'>
        <TitleIcon size={iconSize18} />
        <div className='notebook-title text-sm font-medium'>{title}</div>
      </div>
      <div className='flex w-full items-center gap-x-4'>
        <button
          title={isPinned ? _('Unpin Notebook') : _('Pin Notebook')}
          onClick={handleTogglePin}
          className={clsx(
            'btn btn-ghost btn-circle hidden h-6 min-h-6 w-6 sm:flex',
            isPinned ? 'bg-base-300' : 'bg-base-300/65',
            'eink:bg-transparent',
          )}
        >
          {isPinned ? <MdPushPin size={iconSize15} /> : <MdOutlinePushPin size={iconSize15} />}
        </button>
        {!isFullScreenMobile && closeButton}
        <div className='ml-auto flex items-center'>
          {settings && (
            <button
              title={settings.label}
              aria-label={settings.label}
              onClick={() => openSettings(settings.id)}
              className='btn btn-ghost btn-circle h-8 min-h-8 w-8'
            >
              <MdSettings size={iconSize18} />
            </button>
          )}
          {isFullScreenMobile && closeButton}
        </div>
      </div>
    </div>
  );
};

export default NotebookHeader;
