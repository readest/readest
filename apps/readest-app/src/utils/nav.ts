import { useRouter, redirect } from 'next/navigation';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { isPWA, isWebAppPlatform } from '@/services/environment';
import { BOOK_IDS_SEPARATOR } from '@/services/constants';
import { AppService } from '@/types/system';

let readerWindowsCount = 0;
const createReaderWindow = (appService: AppService, url: string) => {
  const currentWindow = getCurrentWindow();
  const label = currentWindow.label;
  const newLabelPrefix = label === 'main' ? 'reader' : label;
  const win = new WebviewWindow(`${newLabelPrefix}-${readerWindowsCount}`, {
    url,
    width: 800,
    height: 600,
    center: true,
    resizable: true,
    title: appService.isMacOSApp ? '' : 'Readest',
    decorations: appService.isMacOSApp ? true : false,
    transparent: appService.isMacOSApp ? false : true,
    shadow: appService.isMacOSApp ? undefined : true,
    titleBarStyle: appService.isMacOSApp ? 'overlay' : undefined,
  });
  win.once('tauri://created', () => {
    console.log('new window created');
    readerWindowsCount += 1;
  });
  win.once('tauri://error', (e) => {
    console.error('error creating window', e);
  });
  win.once('tauri://destroyed', () => {
    readerWindowsCount -= 1;
  });
};

export const showReaderWindow = (appService: AppService, bookIds: string[]) => {
  const ids = bookIds.join(BOOK_IDS_SEPARATOR);
  const params = new URLSearchParams('');
  params.set('ids', ids);
  const url = `/reader?${params.toString()}`;
  createReaderWindow(appService, url);
};

export const showLibraryWindow = (appService: AppService, filenames: string[]) => {
  const params = new URLSearchParams();
  filenames.forEach((filename) => params.append('file', filename));
  const url = `/library?${params.toString()}`;
  createReaderWindow(appService, url);
};

export const navigateToReader = (
  router: ReturnType<typeof useRouter>,
  bookIds: string[],
  queryParams?: string,
  navOptions?: { scroll?: boolean },
) => {
  const ids = bookIds.join(BOOK_IDS_SEPARATOR);
  if (isWebAppPlatform() && !isPWA()) {
    router.push(`/reader/${ids}${queryParams ? `?${queryParams}` : ''}`, navOptions);
  } else {
    const params = new URLSearchParams(queryParams || '');
    params.set('ids', ids);
    router.push(`/reader?${params.toString()}`, navOptions);
  }
};

export const navigateToLogin = (router: ReturnType<typeof useRouter>) => {
  const pathname = window.location.pathname;
  const search = window.location.search;
  const currentPath = pathname !== '/auth' ? pathname + search : '/';
  router.push(`/auth?redirect=${encodeURIComponent(currentPath)}`);
};

export const navigateToProfile = (router: ReturnType<typeof useRouter>) => {
  router.push('/user');
};

export const navigateToLibrary = (
  router: ReturnType<typeof useRouter>,
  queryParams?: string,
  navOptions?: { scroll?: boolean },
) => {
  router.replace(`/library${queryParams ? `?${queryParams}` : ''}`, navOptions);
};

export const redirectToLibrary = () => {
  redirect('/library');
};

export const navigateToResetPassword = (router: ReturnType<typeof useRouter>) => {
  const pathname = window.location.pathname;
  const search = window.location.search;
  const currentPath = pathname !== '/auth' ? pathname + search : '/';
  router.push(`/auth/recovery?redirect=${encodeURIComponent(currentPath)}`);
};
