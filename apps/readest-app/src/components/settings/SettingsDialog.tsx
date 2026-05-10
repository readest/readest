import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useTranslation } from '@/hooks/useTranslation';
import { useCommandPalette } from '@/components/command-palette';
import { RiFontSize, RiShareLine } from 'react-icons/ri';
import { RiDashboardLine, RiTranslate } from 'react-icons/ri';
import { VscSymbolColor } from 'react-icons/vsc';
import { PiDotsThreeVerticalBold, PiRobot, PiSpeakerHigh } from 'react-icons/pi';
import { LiaHandPointerSolid } from 'react-icons/lia';
import { IoAccessibilityOutline } from 'react-icons/io5';
import {
  MdArrowBackIosNew,
  MdArrowForwardIos,
  MdChevronLeft,
  MdChevronRight,
  MdClose,
} from 'react-icons/md';
import { FiSearch } from 'react-icons/fi';
import { getDirFromUILanguage } from '@/utils/rtl';
import { getCommandPaletteShortcut } from '@/services/environment';
import FontPanel from './FontPanel';
import LayoutPanel from './LayoutPanel';
import ColorPanel from './ColorPanel';
import IntegrationsPanel from './IntegrationsPanel';
import Dropdown from '@/components/Dropdown';
import Dialog from '@/components/Dialog';
import DialogMenu from './DialogMenu';
import ControlPanel from './ControlPanel';
import LangPanel from './LangPanel';
import MiscPanel from './MiscPanel';
import AIPanel from './AIPanel';
import TTSPanel from './TTSPanel';

export type SettingsPanelType =
  | 'Font'
  | 'Layout'
  | 'Color'
  | 'Control'
  | 'TTS'
  | 'Language'
  | 'AI'
  | 'Integrations'
  | 'Custom';
export type SettingsPanelPanelProp = {
  bookKey: string;
  onRegisterReset: (resetFn: () => void) => void;
};

type TabConfig = {
  tab: SettingsPanelType;
  icon: React.ElementType;
  label: string;
  disabled?: boolean;
};

const SettingsDialog: React.FC<{ bookKey: string }> = ({ bookKey }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const closeIconSize = useResponsiveSize(16);
  const [isRtl] = useState(() => getDirFromUILanguage() === 'rtl');
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [showAllTabLabels, setShowAllTabLabels] = useState(false);
  const [canScrollTabsForward, setCanScrollTabsForward] = useState(false);
  const {
    setFontPanelView,
    setSettingsDialogOpen,
    activeSettingsItemId,
    setActiveSettingsItemId,
    requestedPanel,
    setRequestedPanel,
  } = useSettingsStore();
  const { open: openCommandPalette } = useCommandPalette();

  const handleOpenCommandPalette = () => {
    openCommandPalette();
    setSettingsDialogOpen(false);
  };

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
      tab: 'TTS',
      icon: PiSpeakerHigh,
      label: _('TTS'),
    },
    {
      tab: 'AI',
      icon: PiRobot,
      label: _('AI Assistant'),
      disabled: process.env.NODE_ENV === 'production',
    },
    {
      tab: 'Integrations',
      icon: RiShareLine,
      label: _('Integrations'),
    },
    {
      tab: 'Custom',
      icon: IoAccessibilityOutline,
      label: _('Custom'),
    },
  ] as TabConfig[];

  const [activePanel, setActivePanel] = useState<SettingsPanelType>(() => {
    // Deep-link: if a caller asked for a specific panel before opening the
    // dialog, honor that for the initial state. The store-clear lives in
    // a useEffect below so we never call a zustand setter during render
    // (would warn "Cannot update a component while rendering another").
    if (requestedPanel && tabConfig.some((tab) => tab.tab === requestedPanel)) {
      return requestedPanel as SettingsPanelType;
    }
    const lastPanel = localStorage.getItem('lastConfigPanel');
    if (lastPanel && tabConfig.some((tab) => tab.tab === lastPanel)) {
      return lastPanel as SettingsPanelType;
    }
    return 'Font' as SettingsPanelType;
  });

  // Clear the deep-link request after the initial render has consumed it,
  // so the next dialog open doesn't stick on the same panel. Effect runs
  // once on mount; subsequent callers must call setRequestedPanel before
  // opening the dialog again.
  useEffect(() => {
    if (requestedPanel) setRequestedPanel(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSetActivePanel = (tab: SettingsPanelType) => {
    setActivePanel(tab);
    setFontPanelView('main-fonts');
    localStorage.setItem('lastConfigPanel', tab);
  };

  // sync localStorage and fontPanelView when activePanel changes
  const activePanelRef = useRef(activePanel);
  useEffect(() => {
    if (activePanelRef.current !== activePanel) {
      activePanelRef.current = activePanel;
      setFontPanelView('main-fonts');
      localStorage.setItem('lastConfigPanel', activePanel);
    }
  }, [activePanel, setFontPanelView]);

  const [resetFunctions, setResetFunctions] = useState<
    Record<SettingsPanelType, (() => void) | null>
  >({
    Font: null,
    Layout: null,
    Color: null,
    Control: null,
    TTS: null,
    Language: null,
    AI: null,
    Integrations: null,
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

  // handle activeSettingsItemId: switch to correct panel and scroll to item
  useEffect(() => {
    if (!activeSettingsItemId) return;

    // parse panel from item id (format: settings.panel.itemName)
    const parts = activeSettingsItemId.split('.');
    if (parts.length >= 2) {
      const panelMap: Record<string, SettingsPanelType> = {
        font: 'Font',
        layout: 'Layout',
        color: 'Color',
        control: 'Control',
        tts: 'TTS',
        language: 'Language',
        ai: 'AI',
        integrations: 'Integrations',
        custom: 'Custom',
      };
      const panelKey = parts[1]?.toLowerCase();
      const targetPanel = panelMap[panelKey || ''];
      if (targetPanel && targetPanel !== activePanel) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- panel switch based on external navigation is intended
        setActivePanel(targetPanel);
      }
    }

    // scroll to item after panel renders
    const timeoutId = setTimeout(() => {
      const element = panelRef.current?.querySelector(
        `[data-setting-id="${activeSettingsItemId}"]`,
      );
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        element.classList.add('settings-highlight');
        setTimeout(() => element.classList.remove('settings-highlight'), 2000);
      }
      setActiveSettingsItemId(null);
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [activeSettingsItemId, activePanel, setActiveSettingsItemId]);

  useEffect(() => {
    setFontPanelView('main-fonts');

    const container = tabsRef.current;
    if (!container) return;

    const checkButtonWidths = () => {
      const threshold = (container.clientWidth - 64) / tabConfig.filter((t) => !t.disabled).length;
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

    // |scrollLeft| (Math.abs) handles RTL, where modern browsers use 0 → -max
    // for scrolling toward the visual-leading end of the strip.
    const updateScrollState = () => {
      const overflow = container.scrollWidth - container.clientWidth;
      const scrolled = Math.abs(container.scrollLeft);
      setCanScrollTabsForward(overflow > 1 && scrolled < overflow - 1);
    };

    const recompute = () => {
      checkButtonWidths();
      updateScrollState();
    };

    recompute();

    const resizeObserver = new ResizeObserver(recompute);
    resizeObserver.observe(container);
    const mutationObserver = new MutationObserver(recompute);
    mutationObserver.observe(container, {
      subtree: true,
      characterData: true,
    });
    container.addEventListener('scroll', updateScrollState, { passive: true });

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      container.removeEventListener('scroll', updateScrollState);
    };
  }, [setFontPanelView]);

  const handleScrollTabsForward = () => {
    const container = tabsRef.current;
    if (!container) return;
    const amount = container.clientWidth * 0.7;
    container.scrollBy({ left: isRtl ? -amount : amount, behavior: 'smooth' });
  };

  const currentPanel = tabConfig.find((tab) => tab.tab === activePanel);

  const windowControls = (
    <div className='flex h-full items-center justify-end gap-x-2'>
      <button
        onClick={handleOpenCommandPalette}
        aria-label={_('Search Settings')}
        title={`${_('Search Settings')} (${getCommandPaletteShortcut()})`}
        className='btn btn-ghost flex h-8 min-h-8 w-8 items-center justify-center p-0'
      >
        <FiSearch />
      </button>
      <Dropdown
        label={_('Settings Menu')}
        className='dropdown-bottom dropdown-end'
        buttonClassName='btn btn-ghost h-8 min-h-8 w-8 p-0 flex items-center justify-center'
        toggleButton={<PiDotsThreeVerticalBold />}
      >
        <DialogMenu
          bookKey={bookKey}
          activePanel={activePanel}
          onReset={handleResetCurrentPanel}
          resetLabel={
            currentPanel ? _('Reset {{settings}}', { settings: currentPanel.label }) : undefined
          }
        />
      </Dropdown>
      <button
        onClick={handleClose}
        aria-label={_('Close')}
        className={'bg-base-300/65 btn btn-ghost btn-circle hidden h-6 min-h-6 w-6 p-0 sm:flex'}
      >
        <MdClose size={closeIconSize} />
      </button>
    </div>
  );

  return (
    <Dialog
      isOpen={true}
      onClose={handleClose}
      className='modal-open'
      bgClassName={bookKey ? 'sm:!bg-black/20' : 'sm:!bg-black/50'}
      boxClassName={clsx(
        'sm:min-w-[520px] overflow-hidden bg-base-200',
        appService?.isMobile && 'sm:max-w-[90%] sm:w-3/4',
      )}
      snapHeight={appService?.isMobile ? 0.7 : undefined}
      // Settings panels can be tall (Layout / Color especially); native
      // scrollbars vanish on Android/iOS webviews, so use OverlayScrollbars
      // to keep a visible, theme-aware track on every platform.
      useOverlayScroll
      header={
        <div className='flex w-full flex-col items-center'>
          <div className='-mt-2 flex w-full items-center justify-center pb-2 sm:hidden'>
            <button
              tabIndex={-1}
              aria-label={_('Close')}
              onClick={handleClose}
              className={
                'btn btn-ghost btn-circle absolute left-3 flex h-8 min-h-8 w-8 hover:bg-transparent focus:outline-none'
              }
            >
              {isRtl ? <MdArrowForwardIos /> : <MdArrowBackIosNew />}
            </button>
            <div className='tab-title flex text-base font-semibold'>
              {currentPanel?.label || ''}
            </div>
            <div className='absolute right-3'>{windowControls}</div>
          </div>
          <div className='flex w-full flex-row items-center justify-between'>
            <div
              ref={tabsRef}
              role='group'
              aria-label={_('Settings Panels') + ' - ' + (currentPanel?.label || '')}
              className={clsx(
                'dialog-tabs ms-1 flex h-10 w-full items-center gap-1 overflow-x-auto sm:ms-0',
              )}
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            >
              {tabConfig
                .filter((t) => !t.disabled)
                .map(({ tab, icon: Icon, label }) => (
                  <button
                    key={tab}
                    data-tab={tab}
                    tabIndex={0}
                    title={label}
                    className={clsx(
                      'btn btn-ghost text-base-content btn-sm gap-1 px-2 max-[350px]:px-1',
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
            {canScrollTabsForward && (
              <button
                type='button'
                onClick={handleScrollTabsForward}
                aria-label={_('Scroll tabs')}
                title={_('Scroll tabs')}
                tabIndex={-1}
                className='btn btn-ghost btn-circle flex h-8 min-h-8 w-8 shrink-0 items-center justify-center p-0'
              >
                {isRtl ? <MdChevronLeft /> : <MdChevronRight />}
              </button>
            )}
            <div className='hidden sm:flex'>{windowControls}</div>
          </div>
        </div>
      }
    >
      <div
        ref={panelRef}
        role='group'
        aria-label={`${_(currentPanel?.label || '')} - ${_('Settings')}`}
      >
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
        {activePanel === 'TTS' && (
          <TTSPanel bookKey={bookKey} onRegisterReset={(fn) => registerResetFunction('TTS', fn)} />
        )}
        {activePanel === 'Language' && (
          <LangPanel
            bookKey={bookKey}
            onRegisterReset={(fn) => registerResetFunction('Language', fn)}
          />
        )}
        {activePanel === 'AI' && <AIPanel />}
        {activePanel === 'Integrations' && <IntegrationsPanel />}
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
