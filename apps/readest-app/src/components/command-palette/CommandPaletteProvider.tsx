'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useThemeStore } from '@/store/themeStore';
import { useEnv } from '@/context/EnvContext';
import { isTauriAppPlatform } from '@/services/environment';
import { tauriHandleSetAlwaysOnTop, tauriHandleToggleFullScreen } from '@/utils/window';
import { setAboutDialogVisible } from '@/components/AboutWindow';
import { saveSysSettings } from '@/helpers/settings';
import { SettingsPanelType } from '@/components/settings/SettingsDialog';
import {
  CommandItem,
  buildCommandRegistry,
  searchCommands,
  CommandSearchResult,
  groupResultsByCategory,
  trackCommandUsage,
  getRecentCommands,
  CommandCategory,
} from '@/services/commandRegistry';

interface CommandPaletteContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  query: string;
  setQuery: (query: string) => void;
  results: CommandSearchResult[];
  groupedResults: Record<CommandCategory, CommandSearchResult[]>;
  recentItems: CommandItem[];
  executeCommand: (item: CommandItem) => void;
  commandItems: CommandItem[];
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null);

export const useCommandPalette = (): CommandPaletteContextValue => {
  const context = useContext(CommandPaletteContext);
  if (!context) {
    throw new Error('useCommandPalette must be used within CommandPaletteProvider');
  }
  return context;
};

interface CommandPaletteProviderProps {
  children: React.ReactNode;
}

export const CommandPaletteProvider: React.FC<CommandPaletteProviderProps> = ({ children }) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { themeMode, setThemeMode } = useThemeStore();
  const { settings, setSettingsDialogOpen, setActiveSettingsItemId } = useSettingsStore();

  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');

  const isDesktop = isTauriAppPlatform() && !appService?.isMobile;

  // action handlers
  const toggleTheme = useCallback(() => {
    const nextMode = themeMode === 'auto' ? 'light' : themeMode === 'light' ? 'dark' : 'auto';
    setThemeMode(nextMode);
  }, [themeMode, setThemeMode]);

  const toggleFullscreen = useCallback(() => {
    tauriHandleToggleFullScreen();
  }, []);

  const toggleAlwaysOnTop = useCallback(() => {
    const newValue = !settings.alwaysOnTop;
    saveSysSettings(envConfig, 'alwaysOnTop', newValue);
    tauriHandleSetAlwaysOnTop(newValue);
  }, [envConfig, settings.alwaysOnTop]);

  const toggleScreenWakeLock = useCallback(() => {
    const newValue = !settings.screenWakeLock;
    saveSysSettings(envConfig, 'screenWakeLock', newValue);
  }, [envConfig, settings.screenWakeLock]);

  const toggleAutoUpload = useCallback(() => {
    const newValue = !settings.autoUpload;
    saveSysSettings(envConfig, 'autoUpload', newValue);
  }, [envConfig, settings.autoUpload]);

  const reloadPage = useCallback(() => {
    window.location.reload();
  }, []);

  const toggleOpenLastBooks = useCallback(() => {
    const newValue = !settings.openLastBooks;
    saveSysSettings(envConfig, 'openLastBooks', newValue);
  }, [envConfig, settings.openLastBooks]);

  const showAbout = useCallback(() => {
    setAboutDialogVisible(true);
  }, []);

  const toggleTelemetry = useCallback(() => {
    const newValue = !settings.telemetryEnabled;
    saveSysSettings(envConfig, 'telemetryEnabled', newValue);
  }, [envConfig, settings.telemetryEnabled]);

  const openSettingsPanel = useCallback(
    (_panel: SettingsPanelType, itemId?: string) => {
      // panel is encoded in itemId (e.g., 'settings.font.defaultFontSize')
      // SettingsDialog will parse this to determine which panel to show
      if (itemId) {
        setActiveSettingsItemId(itemId);
      }
      setSettingsDialogOpen(true);
    },
    [setSettingsDialogOpen, setActiveSettingsItemId],
  );

  // build command registry
  const commandItems = useMemo(
    () =>
      buildCommandRegistry({
        _,
        openSettingsPanel,
        toggleTheme,
        toggleFullscreen,
        toggleAlwaysOnTop,
        toggleScreenWakeLock,
        toggleAutoUpload,
        reloadPage,
        toggleOpenLastBooks,
        showAbout,
        toggleTelemetry,
        isDesktop,
      }),
    [
      _,
      openSettingsPanel,
      toggleTheme,
      toggleFullscreen,
      toggleAlwaysOnTop,
      toggleScreenWakeLock,
      toggleAutoUpload,
      reloadPage,
      toggleOpenLastBooks,
      showAbout,
      toggleTelemetry,
      isDesktop,
    ],
  );

  // search results
  const results = useMemo(() => searchCommands(query, commandItems), [query, commandItems]);
  const groupedResults = useMemo(() => groupResultsByCategory(results), [results]);

  // recent items
  const recentItems = useMemo(() => getRecentCommands(commandItems, 5), [commandItems]);

  // palette controls
  const open = useCallback(() => {
    setIsOpen(true);
    setQuery('');
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setQuery('');
  }, []);

  const toggle = useCallback(() => {
    if (isOpen) {
      close();
    } else {
      open();
    }
  }, [isOpen, open, close]);

  // execute command
  const executeCommand = useCallback(
    (item: CommandItem) => {
      trackCommandUsage(item.id);
      close();
      // slight delay to allow modal to close before action
      requestAnimationFrame(() => {
        item.action();
      });
    },
    [close],
  );

  // keyboard shortcut handler (Ctrl/Cmd+Shift+P)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      if (isCmdOrCtrl && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        e.stopPropagation();
        toggle();
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [toggle]);

  const value = useMemo(
    () => ({
      isOpen,
      open,
      close,
      toggle,
      query,
      setQuery,
      results,
      groupedResults,
      recentItems,
      executeCommand,
      commandItems,
    }),
    [
      isOpen,
      open,
      close,
      toggle,
      query,
      setQuery,
      results,
      groupedResults,
      recentItems,
      executeCommand,
      commandItems,
    ],
  );

  return <CommandPaletteContext.Provider value={value}>{children}</CommandPaletteContext.Provider>;
};

export default CommandPaletteProvider;
