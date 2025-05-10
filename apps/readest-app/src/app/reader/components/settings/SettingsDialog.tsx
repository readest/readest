import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';
import { BookConfig } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { RiFontSize } from 'react-icons/ri';
import { RiDashboardLine } from 'react-icons/ri';
import { VscSymbolColor } from 'react-icons/vsc';
import { PiDotsThreeVerticalBold } from 'react-icons/pi';
import { IoAccessibilityOutline } from 'react-icons/io5';
import { MdArrowBackIosNew, MdArrowForwardIos } from 'react-icons/md';
import { getDirFromUILanguage } from '@/utils/rtl';
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
  const { appService } = useEnv();
  const [isRtl] = useState(() => getDirFromUILanguage() === 'rtl');
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const [showTabLabels, setShowTabLabels] = useState(false);
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

  useEffect(() => {
    const container = tabsRef.current;
    if (!container) return;

    const checkButtonWidths = () => {
      const threshold = (container.clientWidth - 64) * 0.3;
      const hideLabel = Array.from(container.querySelectorAll('button')).some((button) => {
        const labelSpan = button.querySelector('span');
        const labelText = labelSpan?.textContent || '';
        const clone = button.cloneNode(true) as HTMLButtonElement;
        clone.style.position = 'absolute';
        clone.style.visibility = 'hidden';
        clone.style.width = 'auto';
        const cloneSpan = clone.querySelector('span');
        if (cloneSpan) {
          cloneSpan.classList.remove('hidden');
          cloneSpan.textContent = labelText;
        }
        document.body.appendChild(clone);
        const fullWidth = clone.scrollWidth;
        document.body.removeChild(clone);
        return fullWidth > threshold;
      });
      setShowTabLabels(!hideLabel);
    };

    checkButtonWidths();

    const resizeObserver = new ResizeObserver(checkButtonWidths);
    resizeObserver.observe(container);
    const mutationObserver = new MutationObserver(checkButtonWidths);
    mutationObserver.observe(container, {
      subtree: true,
      characterData: true,
    });

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, []);

  return (
    <>
      <Dialog
        isOpen={true}
        onClose={handleClose}
        className='modal-open'
        boxClassName={clsx('sm:min-w-[520px]', appService?.isMobile && 'sm:max-w-[90%] sm:w-3/4')}
        snapHeight={appService?.isMobile ? 0.7 : undefined}
        header={
          <div className='flex w-full items-center justify-between'>
            <button
              tabIndex={-1}
              onClick={handleClose}
              className={
                'btn btn-ghost btn-circle flex h-8 min-h-8 w-8 hover:bg-transparent focus:outline-none sm:hidden'
              }
            >
              {isRtl ? <MdArrowForwardIos /> : <MdArrowBackIosNew />}
            </button>
            <div
              ref={tabsRef}
              className={clsx(
                'dialog-tabs flex h-10 w-full items-center',
                showTabLabels ? 'gap-2 sm:gap-1' : 'gap-4',
              )}
            >
              {tabConfig.map(({ tab, icon: Icon, label }) => (
                <button
                  key={tab}
                  data-tab={tab}
                  className={clsx(
                    'btn btn-ghost text-base-content btn-sm',
                    activePanel === tab ? 'btn-active' : '',
                  )}
                  onClick={() => handleSetActivePanel(tab)}
                >
                  <Icon className='mr-0' />
                  <span className={clsx('label', !showTabLabels && 'hidden')}>{label}</span>
                </button>
              ))}
            </div>
            <div className='flex h-full items-center justify-end gap-x-2'>
              <Dropdown
                className='dropdown-bottom dropdown-end'
                buttonClassName='btn btn-ghost h-8 min-h-8 w-8 p-0 flex items-center justify-center'
                toggleButton={<PiDotsThreeVerticalBold />}
              >
                <DialogMenu />
              </Dropdown>
              <button
                onClick={handleClose}
                className={
                  'bg-base-300/65 btn btn-ghost btn-circle hidden h-6 min-h-6 w-6 p-0 sm:flex'
                }
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
