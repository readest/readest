'use client';

import '@/utils/polyfill';
import posthog from 'posthog-js';
import i18n from '@/i18n/i18n';
import { useEffect, useState } from 'react';
import { IconContext } from 'react-icons';
import { AuthProvider } from '@/context/AuthContext';
import { useEnv } from '@/context/EnvContext';
import { CSPostHogProvider } from '@/context/PHContext';
import { SyncProvider } from '@/context/SyncContext';
import { initSystemThemeListener, loadDataTheme } from '@/store/themeStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useCustomTextureStore } from '@/store/customTextureStore';
import { useSafeAreaInsets } from '@/hooks/useSafeAreaInsets';
import { useDefaultIconSize } from '@/hooks/useResponsiveSize';
import { useBackgroundTexture } from '@/hooks/useBackgroundTexture';
import { useEinkMode } from '@/hooks/useEinkMode';
import { getLocale } from '@/utils/misc';
import { getDirFromUILanguage } from '@/utils/rtl';
import { getAndroidPatchedViewportContent } from '@/utils/viewport';
import {
  getTelemetryDecision,
  rollIntoTelemetryPromptBucket,
  setTelemetryDecision,
  TELEMETRY_OPT_OUT_KEY,
} from '@/utils/telemetry';
import { getLibraryViewSettings } from '@/helpers/settings';
import { SETTINGS_FILENAME } from '@/services/constants';
import type { AppService } from '@/types/system';
import type { SystemSettings } from '@/types/settings';
import { DropdownProvider } from '@/context/DropdownContext';
import { CommandPaletteProvider, CommandPalette } from '@/components/command-palette';
import AtmosphereOverlay from '@/components/AtmosphereOverlay';
import AppLockScreen from '@/components/AppLockScreen';
import AppLockDialog from '@/components/settings/AppLockDialog';
import PassphrasePrompt from '@/components/PassphrasePrompt';
import TelemetryConsentDialog from '@/components/TelemetryConsentDialog';
import { upgradeToKeychainIfAvailable } from '@/libs/crypto/passphrase';
import { cryptoSession } from '@/libs/crypto/session';
import { useAppLockStore } from '@/store/appLockStore';
import { initSettingsSync } from '@/services/sync/replicaSettingsSync';

// One-time, on first launch after this feature ships, decide how to handle
// PostHog telemetry for the current install:
//   - Existing user (settings file already on disk): preserve their current
//     `telemetryEnabled` setting and persist a matching decision so we don't
//     reconsider on every boot.
//   - New user: silently opt 90% out and skip the prompt; show the consent
//     dialog to the remaining 10%. Until the dialog is resolved their state
//     is `pending` (opt-out at the PostHog layer).
// If a decision has already been recorded, this is a no-op.
const finalizeTelemetryDecision = ({
  appService,
  settings,
  isNewUser,
  onShowPrompt,
}: {
  appService: AppService;
  settings: SystemSettings;
  isNewUser: boolean;
  onShowPrompt: () => void;
}) => {
  const existing = getTelemetryDecision();
  if (existing === 'pending') {
    onShowPrompt();
    return;
  }
  if (existing !== null) return;

  if (!isNewUser) {
    // Existing user: don't change anything they had set. Sync PostHog to
    // their saved preference and record the decision so we stop checking.
    if (settings.telemetryEnabled) {
      localStorage.setItem(TELEMETRY_OPT_OUT_KEY, 'false');
      posthog.opt_in_capturing();
      setTelemetryDecision('opt-in');
    } else {
      localStorage.setItem(TELEMETRY_OPT_OUT_KEY, 'true');
      posthog.opt_out_capturing();
      setTelemetryDecision('opt-out');
    }
    return;
  }

  // Brand-new user. Default to opt-out for privacy; ask only the prompt
  // bucket so the rest get a friction-free first launch.
  if (rollIntoTelemetryPromptBucket()) {
    setTelemetryDecision('pending');
    onShowPrompt();
  } else {
    localStorage.setItem(TELEMETRY_OPT_OUT_KEY, 'true');
    posthog.opt_out_capturing();
    setTelemetryDecision('opt-out');
    // Persist the off-by-default to the settings file directly. The settings
    // store isn't seeded yet at this point in boot, so saveSysSettings would
    // write a malformed partial object — write through appService instead.
    settings.telemetryEnabled = false;
    void appService.saveSettings(settings);
  }
};

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
  const [showTelemetryConsent, setShowTelemetryConsent] = useState(false);
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
      const hadSettingsFilePromise = appService.exists(SETTINGS_FILENAME, 'Settings');
      appService.loadSettings().then(async (settings) => {
        const globalViewSettings = settings.globalViewSettings;
        const hadSettingsFile = await hadSettingsFilePromise.catch(() => false);
        finalizeTelemetryDecision({
          appService,
          settings,
          isNewUser: !hadSettingsFile,
          onShowPrompt: () => setShowTelemetryConsent(true),
        });
        applyUILanguage(globalViewSettings.uiLanguage);
        // Seed the customTextureStore with the disk-loaded textures (preserving
        // their saved ids) so the boot-time applyBackgroundTexture below can
        // resolve a custom textureId. Without this, the store is empty until
        // ColorPanel or the replica-pull seed runs — and the in-hook addTexture
        // fallback re-derives the id from name, which mismatches whenever the
        // saved id wasn't computed from the current name (legacy imports,
        // cross-device sync, name-based id collisions).
        if (settings.customTextures?.length) {
          useCustomTextureStore.getState().setTextures(settings.customTextures);
        }
        // The app boots onto the library, so apply the library background
        // (which inherits the reader/global texture until decoupled). The
        // reader re-applies its own texture when a book opens (issue #4743).
        applyBackgroundTexture(envConfig, getLibraryViewSettings(settings));
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
          biometricUnlockEnabled: !!settings.biometricUnlockEnabled,
        });
        // Subscribe the bundled-settings publisher to settingsStore
        // changes, AFTER priming the publish snapshot from the just-
        // loaded disk settings. Without this priming, the very first
        // setSettings(disk_default) at boot (typically from library
        // page's initLibrary) would diff every whitelisted field
        // against `undefined`, treat them all as "new", and push the
        // local defaults to the server with a fresh HLC — overwriting
        // the cross-device authoritative values another device set.
        // Idempotent — safe to call on remount.
        initSettingsSync(settings);
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

  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!meta) return;
    const updated = getAndroidPatchedViewportContent(navigator.userAgent, meta.content);
    if (updated) meta.content = updated;
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
                <TelemetryConsentDialog
                  open={showTelemetryConsent}
                  onClose={() => setShowTelemetryConsent(false)}
                />
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
