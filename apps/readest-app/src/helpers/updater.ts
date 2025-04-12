import { check } from '@tauri-apps/plugin-updater';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { CHECK_UPDATE_INTERVAL_SEC } from '@/services/constants';
import { TranslationFunc } from '@/hooks/useTranslation';

const LAST_CHECK_KEY = 'lastAppUpdateCheck';

export const checkForAppUpdates = async (_: TranslationFunc, autoCheck = true) => {
  const lastCheck = localStorage.getItem(LAST_CHECK_KEY);
  const now = Date.now();
  if (autoCheck && lastCheck && now - parseInt(lastCheck, 10) < CHECK_UPDATE_INTERVAL_SEC * 1000)
    return;
  localStorage.setItem(LAST_CHECK_KEY, now.toString());

  console.log('Checking for updates');
  const update = await check();
  console.log('Update found', update);
  if (update) {
    const win = new WebviewWindow('updater', {
      url: `/updater?version=${update.version}`,
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
  }
  return update;
};
