import React, { useEffect, useState } from 'react';
import { BookConfig } from '@/types/book';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { RiFontSize } from 'react-icons/ri';
import { RiDashboardLine } from 'react-icons/ri';
import { VscSymbolColor } from 'react-icons/vsc';
import { PiDotsThreeVerticalBold } from 'react-icons/pi';
import { IoAccessibilityOutline } from 'react-icons/io5';

import FontPanel from './FontPanel';
import LayoutPanel from './LayoutPanel';
import ColorPanel from './ColorPanel';
import WindowButtons from '@/components/WindowButtons';
import Dropdown from '@/components/Dropdown';
import DialogMenu from './DialogMenu';
import MiscPanel from './MiscPanel';

type SettingsPanelType = 'Font' | 'Layout' | 'Color' | 'Misc';

const SettingsDialog: React.FC<{ bookKey: string; config: BookConfig }> = ({ bookKey }) => {
  const _ = useTranslation();
  const [activePanel, setActivePanel] = useState<SettingsPanelType>('Font');
  const { setFontLayoutSettingsDialogOpen } = useSettingsStore();

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      setFontLayoutSettingsDialogOpen(false);
    }
  };

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <dialog className='modal modal-open min-w-90 w-full !bg-[rgba(0,0,0,0.2)]'>
      <div className='modal-box settings-content flex h-[65%] w-1/2 min-w-[480px] max-w-full flex-col p-0'>
        <div className='dialog-header bg-base-100 sticky top-0 z-10 flex items-center justify-center px-4 pt-2'>
          <div className='dialog-tabs flex h-10 max-w-[80%] flex-grow items-center justify-around'>
            <button
              className={`btn btn-ghost text-base-content h-8 min-h-8 px-4 ${activePanel === 'Font' ? 'btn-active' : ''}`}
              onClick={() => setActivePanel('Font')}
            >
              <RiFontSize size={20} className='mr-0' />
              {_('Font')}
            </button>
            <button
              className={`btn btn-ghost text-base-content h-8 min-h-8 px-4 ${activePanel === 'Layout' ? 'btn-active' : ''}`}
              onClick={() => setActivePanel('Layout')}
            >
              <RiDashboardLine size={20} className='mr-0' />
              {_('Layout')}
            </button>
            <button
              className={`btn btn-ghost text-base-content h-8 min-h-8 px-4 ${activePanel === 'Color' ? 'btn-active' : ''}`}
              onClick={() => setActivePanel('Color')}
            >
              <VscSymbolColor size={20} className='mr-0' />
              {_('Color')}
            </button>
            <button
              className={`btn btn-ghost text-base-content h-8 min-h-8 px-4 ${activePanel === 'Misc' ? 'btn-active' : ''}`}
              onClick={() => setActivePanel('Misc')}
            >
              <IoAccessibilityOutline size={20} className='mr-0' />
              {_('Misc')}
            </button>
          </div>
          <div className='flex h-full items-center justify-end'>
            <Dropdown
              className='dropdown-bottom dropdown-end'
              buttonClassName='btn btn-ghost h-8 min-h-8 w-8 p-0'
              toggleButton={<PiDotsThreeVerticalBold size={16} />}
            >
              <DialogMenu />
            </Dropdown>
            <WindowButtons
              className='window-buttons absolute right-4 !ml-2 flex h-full items-center'
              showMinimize={false}
              showMaximize={false}
              onClose={() => setFontLayoutSettingsDialogOpen(false)}
            />
          </div>
        </div>

        <div className='text-base-content mt-2 flex-grow overflow-y-auto px-[10%]'>
          {activePanel === 'Font' && <FontPanel bookKey={bookKey} />}
          {activePanel === 'Layout' && <LayoutPanel bookKey={bookKey} />}
          {activePanel === 'Color' && <ColorPanel bookKey={bookKey} />}
          {activePanel === 'Misc' && <MiscPanel bookKey={bookKey} />}
        </div>
      </div>
    </dialog>
  );
};

export default SettingsDialog;
