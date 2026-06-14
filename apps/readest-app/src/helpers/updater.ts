import semver from 'semver';
import { check } from '@tauri-apps/plugin-updater';
import { type as osType } from '@tauri-apps/plugin-os';
import { fetch } from '@tauri-apps/plugin-http';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { ScrollBarStyle } from '@tauri-apps/api/window';
import { TranslationFunc } from '@/hooks/useTranslation';
import { setUpdaterWindowVisible } from '@/components/UpdaterWindow';
import { isTauriAppPlatform } from '@/services/environment';
import { getAppVersion, isUpdateNewer } from '@/utils/version';
import {
  CHECK_UPDATE_INTERVAL_SEC,
  READEST_CHANGELOG_FILE,
  READEST_UPDATER_FILE,
  READEST_NIGHTLY_UPDATER_FILE,
} from '@/services/constants';

const LAST_CHECK_KEY = 'lastAppUpdateCheck';

const showUpdateWindow = (latestVersion: string, scrollBarStyle: ScrollBarStyle) => {
  const win = new WebviewWindow('updater', {
    url: `/updater?latestVersion=${latestVersion}`,
    title: 'Software Update',
    width: 626,
    height: 406,
    center: true,
    resizable: true,
    scrollBarStyle,
  });
  win.once('tauri://created', () => {
    console.log('new window created');
  });
  win.once('tauri://error', (e) => {
    console.error('error creating window', e);
  });
};

type FetchFn = typeof fetch;

export interface UpdateManifestEntry {
  url?: string;
  signature?: string;
}
export interface UpdateManifest {
  version: string;
  pub_date?: string;
  notes?: string;
  platforms: Record<string, UpdateManifestEntry>;
}
export interface ResolvedNightlyUpdate {
  endpoint: string; // manifest URL (for the Tauri UpdaterBuilder path)
  version: string;
  notes?: string;
  pubDate?: string;
  platformKey: string;
  url: string; // artifact URL (for the custom install flows)
  signature: string; // artifact signature
}

export const getNightlyPlatformKey = (
  osTypeVal: string,
  osArchVal: string,
  isPortable: boolean,
  isAppImage: boolean,
): string | null => {
  const is64 = osArchVal === 'x86_64';
  if (osTypeVal === 'android')
    return osArchVal === 'aarch64' ? 'android-arm64' : 'android-universal';
  if (osTypeVal === 'macos') return osArchVal === 'aarch64' ? 'darwin-aarch64' : 'darwin-x86_64';
  if (osTypeVal === 'windows') {
    if (isPortable) return is64 ? 'windows-x86_64-portable' : 'windows-aarch64-portable';
    return is64 ? 'windows-x86_64' : 'windows-aarch64';
  }
  if (osTypeVal === 'linux') {
    if (isAppImage) return is64 ? 'linux-x86_64-appimage' : 'linux-aarch64-appimage';
    return is64 ? 'linux-x86_64' : 'linux-aarch64';
  }
  return null;
};

const fetchManifest = async (fetchFn: FetchFn, url: string): Promise<UpdateManifest | null> => {
  try {
    const res = await fetchFn(url, { connectTimeout: 5000 } as RequestInit);
    if (!res.ok) return null;
    return (await res.json()) as UpdateManifest;
  } catch (err) {
    console.warn('Failed to fetch update manifest', url, err);
    return null;
  }
};

// Nightly channel resolution: fetch the nightly + stable manifests, keep only
// candidates that (a) have a usable artifact for this platform and (b) are newer
// than the installed version, then return the newest by the base-aware rule.
export const resolveNightlyUpdate = async (
  currentVersion: string,
  platformKey: string,
  fetchFn: FetchFn,
): Promise<ResolvedNightlyUpdate | null> => {
  const [nightly, stable] = await Promise.all([
    fetchManifest(fetchFn, READEST_NIGHTLY_UPDATER_FILE),
    fetchManifest(fetchFn, READEST_UPDATER_FILE),
  ]);
  const sources: Array<[UpdateManifest | null, string]> = [
    [nightly, READEST_NIGHTLY_UPDATER_FILE],
    [stable, READEST_UPDATER_FILE],
  ];
  const candidates: ResolvedNightlyUpdate[] = [];
  for (const [manifest, endpoint] of sources) {
    if (!manifest?.version) continue;
    const entry = manifest.platforms?.[platformKey];
    if (!entry?.url || !entry?.signature) continue; // platform-eligibility filter
    if (!isUpdateNewer(manifest.version, currentVersion)) continue;
    candidates.push({
      endpoint,
      version: manifest.version,
      notes: manifest.notes,
      pubDate: manifest.pub_date,
      platformKey,
      url: entry.url,
      signature: entry.signature,
    });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (isUpdateNewer(a.version, b.version) ? -1 : 1));
  return candidates[0]!;
};

export const checkForAppUpdates = async (
  _: TranslationFunc,
  isAutoCheck = true,
): Promise<boolean> => {
  const lastCheck = localStorage.getItem(LAST_CHECK_KEY);
  const now = Date.now();
  if (isAutoCheck && lastCheck && now - parseInt(lastCheck, 10) < CHECK_UPDATE_INTERVAL_SEC * 1000)
    return false;
  localStorage.setItem(LAST_CHECK_KEY, now.toString());

  console.log('Checking for updates');
  const OS_TYPE = osType();
  if (['macos', 'windows', 'linux'].includes(OS_TYPE)) {
    const update = await check();
    if (update) {
      // Enum ScrollBarStyle is exported as type by tauri, so it cannot be used directly.
      const scrollBarStyle = (OS_TYPE === 'windows'
        ? 'fluentOverlay'
        : 'default') as unknown as ScrollBarStyle;
      showUpdateWindow(update.version, scrollBarStyle);
    }
    return !!update;
  } else if (OS_TYPE === 'android') {
    try {
      const response = await fetch(READEST_UPDATER_FILE, { connectTimeout: 5000 });
      const data = await response.json();
      const isNewer = semver.gt(data.version, getAppVersion());
      if (isNewer && ('android-arm64' in data.platforms || 'android-universal' in data.platforms)) {
        setUpdaterWindowVisible(true, data.version!, getAppVersion());
      }
      return isNewer;
    } catch (err) {
      console.warn('Failed to fetch Android update info', err);
      throw new Error('Failed to fetch Android update info');
    }
  }

  return false;
};

const LAST_SHOWN_RELEASE_NOTES_KEY = 'lastShownReleaseNotesVersion';

export const setLastShownReleaseNotesVersion = (version: string) => {
  localStorage.setItem(LAST_SHOWN_RELEASE_NOTES_KEY, version);
};

export const getLastShownReleaseNotesVersion = () => {
  return localStorage.getItem(LAST_SHOWN_RELEASE_NOTES_KEY) || '';
};

export const checkAppReleaseNotes = async (isAutoCheck = true) => {
  const currentVersion = getAppVersion();
  const lastShownVersion = getLastShownReleaseNotesVersion();
  if ((lastShownVersion && semver.gt(currentVersion, lastShownVersion)) || !isAutoCheck) {
    try {
      const fetchFunc = isTauriAppPlatform() ? fetch : window.fetch;
      const res = await fetchFunc(READEST_CHANGELOG_FILE);
      if (res.ok) {
        setUpdaterWindowVisible(true, currentVersion, lastShownVersion, false);
        return true;
      }
    } catch (err) {
      console.warn('Failed to fetch release notes', err);
    }
  } else if (!lastShownVersion) {
    setLastShownReleaseNotesVersion(currentVersion);
  }
  return false;
};
