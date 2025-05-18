import clsx from 'clsx';
import semver from 'semver';
import Image from 'next/image';
import { useEnv } from '@/context/EnvContext';
import { useEffect, useState } from 'react';
import { type as osType, arch as osArch } from '@tauri-apps/plugin-os';
import { check, Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { fetch } from '@tauri-apps/plugin-http';
import { useTranslator } from '@/hooks/useTranslator';
import { useTranslation } from '@/hooks/useTranslation';
import { useSearchParams } from 'next/navigation';
import { tauriDownload } from '@/utils/transfer';
import { installPackage } from '@/utils/bridge';
import { getLocale } from '@/utils/misc';
import { READEST_UPDATER_FILE, READEST_CHANGELOG_FILE } from '@/services/constants';
import packageJson from '../../package.json';
import Dialog from '@/components/Dialog';

interface ReleaseNotes {
  releases: Record<
    string,
    {
      date: string;
      notes: string[];
    }
  >;
}

interface Changelog {
  version: string;
  date: string;
  notes: string[];
}

type DownloadEvent =
  | {
      event: 'Started';
      data: {
        contentLength?: number;
      };
    }
  | {
      event: 'Progress';
      data: {
        chunkLength: number;
      };
    }
  | {
      event: 'Finished';
    };

interface GenericUpdate {
  currentVersion: string;
  version: string;
  date?: string;
  body?: string;
  downloadAndInstall?(onEvent?: (progress: DownloadEvent) => void): Promise<void>;
}

export const UpdaterContent = ({ version }: { version?: string }) => {
  const _ = useTranslation();
  const [targetLang, setTargetLang] = useState('EN');
  const { translate } = useTranslator({
    sourceLang: 'AUTO',
    targetLang,
  });
  const { appService } = useEnv();
  const searchParams = useSearchParams();
  const currentVersion = packageJson.version;
  const resolvedVersion = version ?? searchParams?.get('version') ?? '';
  const [update, setUpdate] = useState<GenericUpdate | Update | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [newVersion, setNewVersion] = useState(resolvedVersion);
  const [changelogs, setChangelogs] = useState<Changelog[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [contentLength, setContentLength] = useState<number | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState<number | null>(null);

  useEffect(() => {
    const locale = getLocale();
    let userLang = locale.split('-')[0] || 'en';
    if (locale === 'zh-CN') {
      userLang = 'zh-Hans';
    } else if (locale.startsWith('zh')) {
      userLang = 'zh-Hant';
    }
    setTargetLang(userLang.toUpperCase());
  }, []);

  useEffect(() => {
    const checkDesktopUpdate = async () => {
      const update = await check();
      if (update) {
        setUpdate(update);
      }
    };
    const checkAndroidUpdate = async () => {
      const response = await fetch(READEST_UPDATER_FILE);
      const data = await response.json();
      if (semver.gt(data.version, packageJson.version)) {
        const OS_ARCH = osArch();
        const platformKey = OS_ARCH === 'aarch64' ? 'android-arm64' : 'android-universal';
        const arch = OS_ARCH === 'aarch64' ? 'arm64' : 'universal';
        const downloadUrl = data.platforms[platformKey]?.url as string;
        const cachePrefix = appService?.fs.getPrefix('Cache');
        const apkFilePath = `${cachePrefix}/Readest_${data.version}_${arch}.apk`;
        setUpdate({
          currentVersion: packageJson.version,
          version: data.version,
          date: data.date,
          body: data.notes,
          downloadAndInstall: async (onEvent) => {
            await new Promise<void>(async (resolve, reject) => {
              let downloaded = 0;
              let total = 0;
              await tauriDownload(downloadUrl, apkFilePath, (progress) => {
                if (!onEvent) return;
                if (!total && progress.total) {
                  total = progress.total;
                  onEvent({
                    event: 'Started',
                    data: { contentLength: total },
                  });
                } else if (downloaded > 0 && progress.progress === progress.total) {
                  console.log('APK downloaded to', apkFilePath);
                  onEvent?.({ event: 'Finished' });
                  setTimeout(() => {
                    resolve();
                  }, 1000);
                }

                onEvent({
                  event: 'Progress',
                  data: { chunkLength: progress.progress - downloaded },
                });
                downloaded = progress.progress;
              }).catch((error) => {
                console.error('Download failed:', error);
                reject(error);
              });
            });

            const res = await installPackage({
              path: apkFilePath,
            });
            if (res.success) {
              console.log('APK installed successfully');
            } else {
              console.error('Failed to install APK:', res.error);
            }
          },
        } as GenericUpdate);
      }
    };
    const checkForUpdates = async () => {
      const OS_TYPE = osType();
      if (['macos', 'windows', 'linux'].includes(OS_TYPE)) {
        checkDesktopUpdate();
      } else if (OS_TYPE === 'android') {
        checkAndroidUpdate();
      }
    };
    checkForUpdates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const fetchChangelogs = async (
      fromVersion: string,
      toVersion: string,
    ): Promise<Changelog[]> => {
      try {
        const res = await fetch(READEST_CHANGELOG_FILE);
        const data: ReleaseNotes = await res.json();
        const releases = data.releases;

        const entries = Object.entries(releases)
          .filter(([ver]) => semver.gt(ver, fromVersion) && semver.lte(ver, toVersion))
          .sort(([a], [b]) => semver.rcompare(a, b))
          .map(([version, info]) => ({
            version,
            date: new Date(info.date).toDateString(),
            notes: info.notes,
          }));

        return entries;
      } catch (error) {
        console.error('Failed to fetch changelog:', error);
        return [];
      }
    };
    const parseNumberedList = (input: string): string[] => {
      return input
        .split(/(?:^|\s)\d+\.\s/)
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    };
    const updateChangelogs = async (update: GenericUpdate) => {
      setNewVersion(update.version);
      let changelogs = await fetchChangelogs(currentVersion, update.version);
      if (changelogs.length === 0) {
        changelogs = [
          {
            version: update.version,
            date: new Date(update.date!).toDateString(),
            notes: parseNumberedList(update.body ?? ''),
          },
        ];
      }
      for (const entry of changelogs) {
        try {
          entry.notes = await translate(entry.notes, { useCache: true });
        } catch (error) {
          console.log('Failed to translate changelog:', error);
        }
      }

      setChangelogs(changelogs);
    };
    if (update) {
      updateChangelogs(update);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [update]);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const handleDownloadInstall = async () => {
    if (!update) {
      return;
    }
    let downloaded = 0;
    let contentLength = 0;
    let lastLogged = 0;
    setProgress(0);
    setIsDownloading(true);
    await update.downloadAndInstall?.((event) => {
      switch (event.event) {
        case 'Started':
          contentLength = event.data.contentLength!;
          setContentLength(contentLength);
          break;
        case 'Progress':
          downloaded += event.data.chunkLength;
          setDownloaded(downloaded);
          const percent = Math.floor((downloaded / contentLength) * 100);
          setProgress(percent);
          if (downloaded - lastLogged >= 1 * 1024 * 1024) {
            console.log(`downloaded ${downloaded} bytes from ${contentLength}`);
            lastLogged = downloaded;
          }
          break;
        case 'Finished':
          console.log('download finished');
          setProgress(100);
          break;
      }
    });
    console.log('package installed');
    if (!appService?.isAndroidApp && process.env.NODE_ENV === 'production') {
      await relaunch();
    }
  };

  if (!isMounted) {
    return null;
  }

  return (
    <div className='bg-base-100 flex min-h-screen justify-center'>
      <div className='flex w-full max-w-2xl flex-col gap-4'>
        <div className='flex flex-col justify-center gap-4 sm:flex-row sm:items-start'>
          <div className='flex items-center justify-center'>
            <Image src='/icon.png' alt='Logo' className='h-20 w-20' width={64} height={64} />
          </div>

          <div className='text-base-content flex-grow text-sm'>
            <h2 className='mb-4 text-center font-bold sm:text-start'>
              {_('A new version of Readest is Available!')}
            </h2>
            <p className='mb-2'>
              {_('Readest {{newVersion}} is available (installed version {{currentVersion}}).', {
                newVersion,
                currentVersion,
              })}
            </p>
            <p className='mb-2'>{_('Download and install now?')}</p>

            <div className='flex w-full flex-row items-center justify-end gap-4'>
              {progress !== null && (
                <div className='flex flex-grow flex-col'>
                  <progress
                    className='progress my-1 h-4 w-full'
                    value={progress}
                    max='100'
                  ></progress>
                  <p className='text-base-content/75 flex items-center justify-center text-sm'>
                    {progress < 100
                      ? _('Downloading {{downloaded}} of {{contentLength}}', {
                          downloaded: downloaded
                            ? `${Math.floor(downloaded / 1024 / 1024)} MB`
                            : '0 MB',
                          contentLength: contentLength
                            ? `${Math.floor(contentLength / 1024 / 1024)} MB`
                            : '0 MB',
                        })
                      : _('Download finished')}
                  </p>
                </div>
              )}

              <div className='card-actions'>
                <button
                  className={clsx(
                    'btn btn-warning text-base-100 px-6 font-bold',
                    (!update || isDownloading) && 'btn-disabled',
                  )}
                  onClick={handleDownloadInstall}
                >
                  {_('DOWNLOAD & INSTALL')}
                </button>
              </div>
            </div>
          </div>
        </div>
        <div className='text-base-content text-sm'>
          <h3 className='mb-2 font-bold'>{_('Changelog:')}</h3>
          <div className='bg-base-300 mb-4 rounded-lg px-4 pb-2 pt-4'>
            {changelogs.length > 0 ? (
              changelogs.map((entry: Changelog) => (
                <div key={entry.version} className='mb-4'>
                  <h4 className='mb-2 font-bold'>
                    {entry.version} ({entry.date})
                  </h4>
                  <ul className='list-disc space-y-1 ps-6 text-sm'>
                    {entry.notes.map((note: string, i: number) => (
                      <li key={i}>{note}</li>
                    ))}
                  </ul>
                </div>
              ))
            ) : (
              <div className='flex h-56 w-full flex-col gap-4'>
                <div className='skeleton h-4 w-28'></div>
                <div className='skeleton h-4 w-full'></div>
                <div className='skeleton h-4 w-full'></div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export const setUpdaterWindowVisible = (visible: boolean, newVersion?: string) => {
  const dialog = document.getElementById('updater_window');
  if (dialog) {
    const event = new CustomEvent('setDialogVisibility', {
      detail: { visible, newVersion },
    });
    dialog.dispatchEvent(event);
  }
};

export const UpdaterWindow = () => {
  const _ = useTranslation();
  const [newVersion, setNewVersion] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleCustomEvent = (event: CustomEvent) => {
      const { visible, newVersion } = event.detail;
      setIsOpen(visible);
      if (newVersion) {
        setNewVersion(newVersion);
      }
    };

    const el = document.getElementById('updater_window');
    if (el) {
      el.addEventListener('setDialogVisibility', handleCustomEvent as EventListener);
    }

    return () => {
      if (el) {
        el.removeEventListener('setDialogVisibility', handleCustomEvent as EventListener);
      }
    };
  }, []);

  return (
    <Dialog
      id='updater_window'
      isOpen={isOpen}
      title={_('Software Update')}
      onClose={() => setIsOpen(false)}
      boxClassName='sm:!w-[80%] sm:h-auto'
    >
      <UpdaterContent version={newVersion ?? undefined} />
    </Dialog>
  );
};
