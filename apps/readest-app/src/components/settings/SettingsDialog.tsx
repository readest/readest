import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useTranslation } from '@/hooks/useTranslation';
import { RiFontSize } from 'react-icons/ri';
import { RiDashboardLine, RiTranslate } from 'react-icons/ri';
import { VscSymbolColor } from 'react-icons/vsc';
import { PiDotsThreeVerticalBold } from 'react-icons/pi';
import { LiaHandPointerSolid } from 'react-icons/lia';
import { IoAccessibilityOutline } from 'react-icons/io5';
import { MdArrowBackIosNew, MdArrowForwardIos, MdClose } from 'react-icons/md';
import { getDirFromUILanguage } from '@/utils/rtl';
import FontPanel from './FontPanel';
import LayoutPanel from './LayoutPanel';
import ColorPanel from './ColorPanel';
import Dropdown from '@/components/Dropdown';
import Dialog from '@/components/Dialog';
import DialogMenu from './DialogMenu';
import ControlPanel from './ControlPanel';
import LangPanel from './LangPanel';
import MiscPanel from './MiscPanel';

export type SettingsPanelType = 'Font' | 'Layout' | 'Color' | 'Control' | 'Language' | 'Custom';
export type SettingsPanelPanelProp = {
  bookKey: string;
  onRegisterReset: (resetFn: () => void) => void;
};

type TabConfig = {
  tab: SettingsPanelType;
  icon: React.ElementType;
  label: string;
};

const SettingsDialog: React.FC<{ bookKey: string }> = ({ bookKey }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const closeIconSize = useResponsiveSize(16);
  const [isRtl] = useState(() => getDirFromUILanguage() === 'rtl');
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const [showAllTabLabels, setShowAllTabLabels] = useState(false);
  const { setFontPanelView, setSettingsDialogOpen } = useSettingsStore();

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
      tab: 'Control',
      icon: LiaHandPointerSolid,
      label: _('Behavior'),
    },
    {
      tab: 'Language',
      icon: RiTranslate,
      label: _('Language'),
    },
    {
      tab: 'Custom',
      icon: IoAccessibilityOutline,
      label: _('Custom'),
    },
  ] as TabConfig[];

  const [activePanel, setActivePanel] = useState<SettingsPanelType>(() => {
    const lastPanel = localStorage.getItem('lastConfigPanel');
    if (lastPanel && tabConfig.some((tab) => tab.tab === lastPanel)) {
      return lastPanel as SettingsPanelType;
    }
    return 'Font' as SettingsPanelType;
  });

  const handleSetActivePanel = (tab: SettingsPanelType) => {
    setActivePanel(tab);
    setFontPanelView('main-fonts');
    localStorage.setItem('lastConfigPanel', tab);
  };

  const [resetFunctions, setResetFunctions] = useState<
    Record<SettingsPanelType, (() => void) | null>
  >({
    Font: null,
    Layout: null,
    Color: null,
    Control: null,
    Language: null,
    Custom: null,
  });

  const registerResetFunction = (panel: SettingsPanelType, resetFn: () => void) => {
    setResetFunctions((prev) => ({ ...prev, [panel]: resetFn }));
  };

  const handleResetCurrentPanel = () => {
    const resetFn = resetFunctions[activePanel];
    if (resetFn) {
      resetFn();
    }
  };

  const handleClose = () => {
    setSettingsDialogOpen(false);
  };

  useEffect(() => {
    setFontPanelView('main-fonts');

    const container = tabsRef.current;
    if (!container) return;

    const checkButtonWidths = () => {
      const threshold = (container.clientWidth - 64) * 0.22;
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
      setShowAllTabLabels(!hideLabel);
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
  }, [setFontPanelView]);

  const currentPanel = tabConfig.find((tab) => tab.tab === activePanel);

  return (
    <Dialog
      isOpen={true}
      onClose={handleClose}
      className='modal-open'
      bgClassName={bookKey ? 'sm:!bg-black/20' : 'sm:!bg-black/50'}
      boxClassName={clsx('sm:min-w-[520px]', appService?.isMobile && 'sm:max-w-[90%] sm:w-3/4')}
      snapHeight={appService?.isMobile ? 0.7 : undefined}
      header={
        <div className='flex w-full flex-col items-center'>
          <div className='tab-title flex pb-2 text-base font-semibold sm:hidden'>
            {currentPanel?.label || ''}
          </div>
          <div className='flex w-full flex-row items-center justify-between'>
            <button
              tabIndex={-1}
              aria-label={_('Close')}
              onClick={handleClose}
              className={
                'btn btn-ghost btn-circle flex h-8 min-h-8 w-8 hover:bg-transparent focus:outline-none sm:hidden'
              }
            >
              {isRtl ? <MdArrowForwardIos /> : <MdArrowBackIosNew />}
            </button>
            <div
              ref={tabsRef}
              role='group'
              aria-label={_('Settings Panels') + ' - ' + (currentPanel?.label || '')}
              className={clsx('dialog-tabs ms-1 flex h-10 w-full items-center gap-1 sm:ms-0')}
            >
              {tabConfig.map(({ tab, icon: Icon, label }) => (
                <button
                  key={tab}
                  data-tab={tab}
                  tabIndex={0}
                  title={label}
                  className={clsx(
                    'btn btn-ghost text-base-content btn-sm gap-1 px-2',
                    activePanel === tab ? 'btn-active' : '',
                  )}
                  onClick={() => handleSetActivePanel(tab)}
                >
                  <Icon className='mr-0' />
                  <span
                    className={clsx(
                      window.innerWidth < 640 && 'hidden',
                      !(showAllTabLabels || activePanel === tab) && 'hidden',
                    )}
                  >
                    {label}
                  </span>
                </button>
              ))}
            </div>
            <div className='flex h-full items-center justify-end gap-x-2'>
              <Dropdown
                label={_('Settings Menu')}
                className='dropdown-bottom dropdown-end'
                buttonClassName='btn btn-ghost h-8 min-h-8 w-8 p-0 flex items-center justify-center'
                toggleButton={<PiDotsThreeVerticalBold />}
              >
                <DialogMenu
                  activePanel={activePanel}
                  onReset={handleResetCurrentPanel}
                  resetLabel={
                    currentPanel
                      ? _('Reset {{settings}}', { settings: currentPanel.label })
                      : undefined
                  }
                />
              </Dropdown>
              <button
                onClick={handleClose}
                aria-label={_('Close')}
                className={
                  'bg-base-300/65 btn btn-ghost btn-circle hidden h-6 min-h-6 w-6 p-0 sm:flex'
                }
              >
                <MdClose size={closeIconSize} />
              </button>
            </div>
          </div>
        </div>
      }
    >
      <div role='group' aria-label={`${_(currentPanel?.label || '')} - ${_('Settings')}`}>
        {activePanel === 'Font' && (
          <FontPanel
            bookKey={bookKey}
            onRegisterReset={(fn) => registerResetFunction('Font', fn)}
          />
        )}
        {activePanel === 'Layout' && (
          <LayoutPanel
            bookKey={bookKey}
            onRegisterReset={(fn) => registerResetFunction('Layout', fn)}
          />
        )}
        {activePanel === 'Color' && (
          <ColorPanel
            bookKey={bookKey}
            onRegisterReset={(fn) => registerResetFunction('Color', fn)}
          />
        )}
        {activePanel === 'Control' && (
          <ControlPanel
            bookKey={bookKey}
            onRegisterReset={(fn) => registerResetFunction('Control', fn)}
          />
        )}
        {activePanel === 'Language' && (
          <LangPanel
            bookKey={bookKey}
            onRegisterReset={(fn) => registerResetFunction('Language', fn)}
          />
        )}
        {activePanel === 'Custom' && (
          <MiscPanel
            bookKey={bookKey}
            onRegisterReset={(fn) => registerResetFunction('Custom', fn)}
          />
        )}
      </div>
    </Dialog>
  );
};

export default SettingsDialog;
