import semver from 'semver';
import { check } from '@tauri-apps/plugin-updater';
import { type as osType } from '@tauri-apps/plugin-os';
import { fetch } from '@tauri-apps/plugin-http';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { TranslationFunc } from '@/hooks/useTranslation';
import { setUpdaterWindowVisible } from '@/components/UpdaterWindow';
import { getAppVersion } from '@/utils/version';
import { CHECK_UPDATE_INTERVAL_SEC, READEST_UPDATER_FILE } from '@/services/constants';

const LAST_CHECK_KEY = 'lastAppUpdateCheck';

const showUpdateWindow = (newVersion: string) => {
  const win = new WebviewWindow('updater', {
    url: `/updater?version=${newVersion}`,
    title: 'Software Update',
    width: 626,
    height: 406,
    center: true,
    resizable: true,
  });
  win.once('tauri://created', () => {
    console.log('new window created');
  });
  win.once('tauri://error', (e) => {
    console.error('error creating window', e);
  });
};

export const checkForAppUpdates = async (
  _: TranslationFunc,
  autoCheck = true,
): Promise<boolean> => {
  const lastCheck = localStorage.getItem(LAST_CHECK_KEY);
  const now = Date.now();
  if (autoCheck && lastCheck && now - parseInt(lastCheck, 10) < CHECK_UPDATE_INTERVAL_SEC * 1000)
    return false;
  localStorage.setItem(LAST_CHECK_KEY, now.toString());

  console.log('Checking for updates');
  const OS_TYPE = osType();
  if (['macos', 'windows', 'linux'].includes(OS_TYPE)) {
    const update = await check();
    if (update) {
      showUpdateWindow(update.version);
    }
    return !!update;
  } else if (OS_TYPE === 'android') {
    try {
      const response = await fetch(READEST_UPDATER_FILE, { connectTimeout: 5000 });
      const data = await response.json();
      const isNewer = semver.gt(data.version, getAppVersion());
      if (isNewer && ('android-arm64' in data.platforms || 'android-universal' in data.platforms)) {
        setUpdaterWindowVisible(true, data.version);
      }
      return isNewer;
    } catch (err) {
      console.warn('Failed to fetch Android update info', err);
      throw new Error('Failed to fetch Android update info');
    }
  }

  return false;
};
