import { useEffect } from 'react';
import i18n from '@/i18n/i18n';
import { clearStoredServerConfig } from '@/services/serverConfig';
import { eventDispatcher } from '@/utils/event';
import { stubTranslation as _ } from '@/utils/misc';

const INVALID_SERVER_CONFIG_MESSAGE = _('Saved server settings were invalid and have been reset');

/**
 * The Tauri bootstrap script refuses a stored server config that fails
 * validation and flags it; the app then runs on its default server. Drop the
 * bad entry and tell the user, once.
 *
 * Runs in Providers, which renders before i18next registers with
 * react-i18next, so it must not use `useTranslation`: that hook calls no
 * hooks until then and several after, which breaks the hook order (React
 * error #311). It translates through i18next directly once initialized.
 */
export const useInvalidServerConfigNotice = () => {
  useEffect(() => {
    if (!window.__READEST_SERVER_CONFIG_INVALID) return;
    delete window.__READEST_SERVER_CONFIG_INVALID;
    clearStoredServerConfig();
    const notify = () => {
      eventDispatcher.dispatch('toast', {
        type: 'warning',
        message: i18n.t(INVALID_SERVER_CONFIG_MESSAGE, {
          defaultValue: INVALID_SERVER_CONFIG_MESSAGE,
        }),
      });
    };
    if (i18n.isInitialized) {
      notify();
      return;
    }
    i18n.on('initialized', notify);
    return () => i18n.off('initialized', notify);
  }, []);
};
