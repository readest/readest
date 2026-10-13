'use client';

import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trans } from 'react-i18next';
import { IoArrowBack } from 'react-icons/io5';
import { useEnv } from '@/context/EnvContext';
import { useTheme } from '@/hooks/useTheme';
import { useTranslation } from '@/hooks/useTranslation';
import { useEnsureSettingsLoaded } from '@/hooks/useEnsureSettingsLoaded';
import { useSettingsStore } from '@/store/settingsStore';
import { useThemeStore } from '@/store/themeStore';
import { useTrafficLightStore } from '@/store/trafficLightStore';
import {
  HardcoverOAuthError,
  pollDeviceToken,
  startDeviceAuth,
  type DeviceAuth,
} from '@/services/hardcover/hardcoverOAuth';
import { stashHardcoverReturnTarget } from '@/services/hardcover/hardcoverConnection';
import { eventDispatcher } from '@/utils/event';
import { getHorizontalInsetStyle } from '@/utils/insets';
import { stubTranslation as _ } from '@/utils/misc';
import { navigateToLibrary } from '@/utils/nav';
import { openExternalUrl } from '@/utils/open';
import QRCode from '@/components/settings/integrations/QRCode';
import WindowButtons from '@/components/WindowButtons';

// Registers the key for extraction; it is rendered through <Trans> below.
_('Visit {{url}} and enter');

export default function HardcoverConnectPage() {
  const _ = useTranslation();
  const router = useRouter();
  const { envConfig, appService } = useEnv();
  const { safeAreaInsets, isRoundedWindow, isIPhoneDuo } = useThemeStore();
  const { isTrafficLightVisible } = useTrafficLightStore();
  const { setSettings, saveSettings } = useSettingsStore();
  const settingsLoaded = useEnsureSettingsLoaded();
  const [device, setDevice] = useState<DeviceAuth | null>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  useTheme({ systemUIVisible: false });

  const leave = () => {
    stashHardcoverReturnTarget();
    // Back to wherever Connect was pressed (library or a book), like /auth.
    const redirect = new URLSearchParams(window.location.search).get('redirect');
    // Browsers read a backslash as '/' and drop tabs and newlines, so '/\host' and '/<TAB>/host'
    // would leave the app.
    if (redirect?.startsWith('/') && !redirect.startsWith('//') && !/[\\\p{Cc}]/u.test(redirect)) {
      router.replace(redirect);
    } else navigateToLibrary(router, '', undefined, true);
  };

  useEffect(() => {
    if (!settingsLoaded) return;
    const abort = new AbortController();
    void (async () => {
      let oauth;
      try {
        const auth = await startDeviceAuth();
        if (abort.signal.aborted) return;
        setDevice(auth);
        oauth = await pollDeviceToken(auth, { signal: abort.signal });
        if (abort.signal.aborted) return; // left the page while the last poll was in flight
      } catch (error) {
        const code = error instanceof HardcoverOAuthError ? error.code : null;
        if (code === 'aborted') return;
        const message =
          code === 'access_denied'
            ? _('Hardcover access was denied.')
            : code === 'expired_token'
              ? _('The code expired. Please try again.')
              : code
                ? _('Connection failed')
                : _('Unable to connect to Hardcover. Please check your network connection.');
        eventDispatcher.dispatch('toast', { message, type: 'error' });
        return leave();
      }
      try {
        const { settings: current } = useSettingsStore.getState();
        const newSettings = {
          ...current,
          hardcover: {
            enabled: true,
            // Keep any pasted token: the client prefers OAuth, and '' would sync to other devices.
            accessToken: current.hardcover?.accessToken ?? '',
            oauth,
            lastSyncedAt: current.hardcover?.lastSyncedAt ?? 0,
            autoSync: current.hardcover?.autoSync ?? false,
          },
        };
        // Persist first so a failed save never leaves unsaved credentials live in memory.
        await saveSettings(envConfig, newSettings);
        setSettings(newSettings);
      } catch (error) {
        console.error('[Hardcover] failed to save connection', error);
        eventDispatcher.dispatch('toast', { message: _('Connection failed'), type: 'error' });
      }
      leave();
    })();
    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsLoaded]);

  return (
    <div
      className={clsx(
        'bg-base-100 full-height inset-0 flex select-none flex-col items-center overflow-hidden',
        appService?.hasRoundedWindow && isRoundedWindow && 'window-border rounded-window',
      )}
    >
      <div
        className='flex h-full w-full flex-col items-center overflow-y-auto'
        style={{
          paddingTop: `${safeAreaInsets?.top || 0}px`,
          ...getHorizontalInsetStyle(safeAreaInsets, isIPhoneDuo),
        }}
      >
        <div
          ref={headerRef}
          className={clsx(
            'fixed z-10 flex w-full items-center justify-between py-2 pe-6 ps-4',
            appService?.hasTrafficLight && 'pt-11',
          )}
          style={{ top: `${safeAreaInsets?.top || 0}px` }}
        >
          <button
            aria-label={_('Go Back')}
            onClick={leave}
            className='btn btn-ghost h-12 min-h-12 w-12 p-0 sm:h-8 sm:min-h-8 sm:w-8'
          >
            <IoArrowBack className='text-base-content' />
          </button>
          {appService?.hasWindowBar && (
            <WindowButtons
              headerRef={headerRef}
              showMinimize={!isTrafficLightVisible}
              showMaximize={!isTrafficLightVisible}
              showClose={!isTrafficLightVisible}
              onClose={leave}
            />
          )}
        </div>
        <div
          className={clsx(
            // my-auto centers vertically; the equal padding keeps it clear of the fixed header.
            'z-20 my-auto flex w-full max-w-sm flex-col items-center gap-6 px-6 text-center',
            appService?.hasTrafficLight ? 'py-24' : 'py-16',
          )}
        >
          {device ? (
            <div className='flex w-full flex-col items-center gap-3 text-sm'>
              <div className='mb-3'>
                <QRCode value={device.verificationUriComplete} />
              </div>
              <p>{_('Scan this QR code')}</p>
              <p className='text-base-content/50'>{_('— or —')}</p>
              <p>
                <Trans
                  i18nKey='Visit {{url}} and enter'
                  defaults='<0>Visit </0><1>{{url}}</1><2> and enter</2>'
                  values={{ url: device.verificationUri }}
                  components={[
                    <span key='0' />,
                    <a
                      key='1'
                      className='link link-primary'
                      href={device.verificationUriComplete}
                      onClick={(e) => {
                        e.preventDefault();
                        openExternalUrl(device.verificationUriComplete);
                      }}
                    >
                      {device.verificationUri}
                    </a>,
                    <span key='2' />,
                  ]}
                />
              </p>
              <div className='font-mono text-2xl tracking-widest'>{device.userCode}</div>
            </div>
          ) : (
            <span className='loading loading-spinner loading-md' />
          )}
        </div>
      </div>
    </div>
  );
}
