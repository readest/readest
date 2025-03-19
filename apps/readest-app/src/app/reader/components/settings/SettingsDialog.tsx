import clsx from 'clsx';
import React, { useState } from 'react';
import { BookConfig } from '@/types/book';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { RiFontSize } from 'react-icons/ri';
import { RiDashboardLine } from 'react-icons/ri';
import { VscSymbolColor } from 'react-icons/vsc';
import { PiDotsThreeVerticalBold } from 'react-icons/pi';
import { IoAccessibilityOutline } from 'react-icons/io5';
import { MdArrowBackIosNew } from 'react-icons/md';

import FontPanel from './FontPanel';
import LayoutPanel from './LayoutPanel';
import ColorPanel from './ColorPanel';
import Dropdown from '@/components/Dropdown';
import Dialog from '@/components/Dialog';
import DialogMenu from './DialogMenu';
import MiscPanel from './MiscPanel';

type SettingsPanelType = 'Font' | 'Layout' | 'Color' | 'Misc';

type TabConfig = {
  tab: SettingsPanelType;
  icon: React.ElementType;
  label: string;
};

const SettingsDialog: React.FC<{ bookKey: string; config: BookConfig }> = ({ bookKey }) => {
  const _ = useTranslation();
  const [activePanel, setActivePanel] = useState<SettingsPanelType>(
    (localStorage.getItem('lastConfigPanel') || 'Font') as SettingsPanelType,
  );
  const { setFontLayoutSettingsDialogOpen } = useSettingsStore();

  const tabConfig = [
    {
      tab: 'Font',
      icon: RiFontSize,
      label: _('Font'),
    },
    {
      tab: 'Layout',
      icon: RiDashboardLine,
      label: _('Layout'),
    },
    {
      tab: 'Color',
      icon: VscSymbolColor,
      label: _('Color'),
    },
    {
      tab: 'Misc',
      icon: IoAccessibilityOutline,
      label: _('Misc'),
    },
  ] as TabConfig[];

  const handleSetActivePanel = (tab: SettingsPanelType) => {
    setActivePanel(tab);
    localStorage.setItem('lastConfigPanel', tab);
  };

  const handleClose = () => {
    setFontLayoutSettingsDialogOpen(false);
  };

  return (
    <>
      <Dialog
        isOpen={true}
        onClose={handleClose}
        className='modal-open'
        boxClassName='sm:min-w-[520px]'
        snapHeight={window.innerWidth < 640 ? 0.7 : undefined}
        header={
          <div className='flex w-full items-center justify-between'>
            <button
              tabIndex={-1}
              onClick={handleClose}
              className={
                'btn btn-ghost btn-circle flex h-6 min-h-6 w-6 hover:bg-transparent focus:outline-none sm:hidden'
              }
            >
              <MdArrowBackIosNew />
            </button>
            <div className='dialog-tabs flex h-10 max-w-[100%] flex-grow items-center gap-2 pl-4'>
              {tabConfig.map(({ tab, icon: Icon, label }) => (
                <button
                  key={tab}
                  className={clsx(
                    'btn btn-ghost text-base-content btn-sm',
                    activePanel === tab ? 'btn-active' : '',
                  )}
                  onClick={() => handleSetActivePanel(tab)}
                >
                  <Icon className='mr-0' />
                  {window.innerWidth >= 500 ? label : ''}
                </button>
              ))}
            </div>
            <div className='flex h-full items-center justify-end gap-x-2'>
              <Dropdown
                className='dropdown-bottom dropdown-end'
                buttonClassName='btn btn-ghost h-8 min-h-8 w-8 p-0'
                toggleButton={<PiDotsThreeVerticalBold />}
              >
                <DialogMenu />
              </Dropdown>
              <button
                onClick={handleClose}
                className={'bg-base-300/65 btn btn-ghost btn-circle hidden h-6 min-h-6 w-6 sm:flex'}
              >
                <svg
                  xmlns='http://www.w3.org/2000/svg'
                  width='1em'
                  height='1em'
                  viewBox='0 0 24 24'
                >
                  <path
                    fill='currentColor'
                    d='M19 6.41L17.59 5L12 10.59L6.41 5L5 6.41L10.59 12L5 17.59L6.41 19L12 13.41L17.59 19L19 17.59L13.41 12z'
                  />
                </svg>
              </button>
            </div>
          </div>
        }
      >
        {activePanel === 'Font' && <FontPanel bookKey={bookKey} />}
        {activePanel === 'Layout' && <LayoutPanel bookKey={bookKey} />}
        {activePanel === 'Color' && <ColorPanel bookKey={bookKey} />}
        {activePanel === 'Misc' && <MiscPanel bookKey={bookKey} />}
      </Dialog>
    </>
  );
};

export default SettingsDialog;
