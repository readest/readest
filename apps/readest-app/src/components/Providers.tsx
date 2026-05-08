'use client';

import '@/utils/polyfill';
import i18n from '@/i18n/i18n';
import { useEffect } from 'react';
import { IconContext } from 'react-icons';
import { AuthProvider } from '@/context/AuthContext';
import { useEnv } from '@/context/EnvContext';
import { CSPostHogProvider } from '@/context/PHContext';
import { SyncProvider } from '@/context/SyncContext';
import { initSystemThemeListener, loadDataTheme } from '@/store/themeStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useSafeAreaInsets } from '@/hooks/useSafeAreaInsets';
import { useDefaultIconSize } from '@/hooks/useResponsiveSize';
import { useBackgroundTexture } from '@/hooks/useBackgroundTexture';
import { useEinkMode } from '@/hooks/useEinkMode';
import { getLocale } from '@/utils/misc';
import { getDirFromUILanguage } from '@/utils/rtl';
import { DropdownProvider } from '@/context/DropdownContext';
import { CommandPaletteProvider, CommandPalette } from '@/components/command-palette';
import AtmosphereOverlay from '@/components/AtmosphereOverlay';
import AppLockScreen from '@/components/AppLockScreen';
import AppLockDialog from '@/components/settings/AppLockDialog';
import PassphrasePrompt from '@/components/PassphrasePrompt';
import { upgradeToKeychainIfAvailable } from '@/libs/crypto/passphrase';
import { cryptoSession } from '@/libs/crypto/session';
import { useAppLockStore } from '@/store/appLockStore';
import { initSettingsSync } from '@/services/sync/replicaSettingsSync';

const Providers = ({ children }: { children: React.ReactNode }) => {
  const { envConfig, appService } = useEnv();
  const { applyUILanguage } = useSettingsStore();
  const { applyBackgroundTexture } = useBackgroundTexture();
  const { applyEinkMode } = useEinkMode();
  const {
    isInitialized: isLockInitialized,
    isUnlocked,
    initialize: initializeAppLock,
  } = useAppLockStore();
  const iconSize = useDefaultIconSize();
  useSafeAreaInsets(); // Initialize safe area insets

  useEffect(() => {
    const handlerLanguageChanged = (lng: string) => {
      document.documentElement.lang = lng;
      // Set RTL class on document for targeted styling without affecting layout
      const dir = getDirFromUILanguage();
      if (dir === 'rtl') {
        document.documentElement.classList.add('ui-rtl');
      } else {
        document.documentElement.classList.remove('ui-rtl');
      }
    };

    const locale = getLocale();
    handlerLanguageChanged(locale);
    i18n.on('languageChanged', handlerLanguageChanged);
    return () => {
      i18n.off('languageChanged', handlerLanguageChanged);
    };
  }, []);

  useEffect(() => {
    loadDataTheme();
    if (appService) {
      initSystemThemeListener(appService);
      appService.loadSettings().then((settings) => {
        const globalViewSettings = settings.globalViewSettings;
        applyUILanguage(globalViewSettings.uiLanguage);
        applyBackgroundTexture(envConfig, globalViewSettings);
        if (globalViewSettings.isEink) {
          applyEinkMode(true);
        }
        // Initialize the app-lock gate from on-disk settings. Until
        // this runs, the gate renders nothing — guarantees the
        // library can't flash on screen before the lock screen does.
        initializeAppLock({
          enabled: !!settings.pinCodeEnabled,
          hash: settings.pinCodeHash,
          salt: settings.pinCodeSalt,
        });
      });
    }
  }, [
    envConfig,
    appService,
    applyUILanguage,
    applyBackgroundTexture,
    applyEinkMode,
    initializeAppLock,
  ]);

  // Sync-passphrase boot path: upgrade the passphrase store from
  // ephemeral to OS keychain on Tauri (probe is async — must run after
  // the platform check resolves), then attempt a silent unlock from
  // the saved passphrase. Failures are silent — the gate prompts on
  // first encrypted-field operation if we couldn't restore.
  useEffect(() => {
    void (async () => {
      await upgradeToKeychainIfAvailable();
      await cryptoSession.tryRestoreFromStore();
    })();
  }, []);

  // Subscribe the bundled-settings publisher to settingsStore changes.
  // After this fires, every setSettings call diffs the whitelist
  // against the last-published snapshot and emits a single replica
  // upsert for changed fields (no-op if nothing whitelisted changed).
  // Idempotent — safe to call on remount.
  useEffect(() => {
    initSettingsSync();
  }, []);

  // Make sure appService is available in all children components
  if (!appService) return;

  // App-lock gate. While the lock store is uninitialized we render
  // nothing — without this guard the library would flash on screen
  // for a few hundred ms before `loadSettings` resolved and let the
  // lock store decide whether to lock.
  const showAppLockScreen = isLockInitialized && !isUnlocked;
  const appShellHidden = !isLockInitialized || !isUnlocked;

  return (
    <CSPostHogProvider>
      <AuthProvider>
        <IconContext.Provider value={{ size: `${iconSize}px` }}>
          <SyncProvider>
            <DropdownProvider>
              <CommandPaletteProvider>
                <div
                  aria-hidden={appShellHidden}
                  style={appShellHidden ? { display: 'none' } : undefined}
                >
                  {children}
                  <CommandPalette />
                  <AtmosphereOverlay />
                  <PassphrasePrompt />
                </div>
                <AppLockDialog />
                {showAppLockScreen && <AppLockScreen />}
              </CommandPaletteProvider>
            </DropdownProvider>
          </SyncProvider>
        </IconContext.Provider>
      </AuthProvider>
    </CSPostHogProvider>
  );
};

export default Providers;
