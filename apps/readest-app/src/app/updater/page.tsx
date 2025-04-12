'use client';

import clsx from 'clsx';
import semver from 'semver';
import Image from 'next/image';
import { Suspense, useEffect, useState } from 'react';
import { check, Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { fetch } from '@tauri-apps/plugin-http';
import { useTranslation } from '@/hooks/useTranslation';
import { useSearchParams } from 'next/navigation';
import { useTheme } from '@/hooks/useTheme';
import packageJson from '../../../package.json';
import Spinner from '@/components/Spinner';

const CHANGELOG_URL =
  'https://github.com/readest/readest/releases/latest/download/release-notes.json';

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

const UpdaterDialog = () => {
  const _ = useTranslation();
  const searchParams = useSearchParams();
  const currentVersion = packageJson.version;
  const version = searchParams?.get('version') || '';
  const [update, setUpdate] = useState<Update | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [newVersion, setNewVersion] = useState(version);
  const [changelogs, setChangelogs] = useState<Changelog[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [contentLength, setContentLength] = useState<number | null>(null);
  const [downloaded, setDownloaded] = useState<number | null>(null);

  useEffect(() => {
    const fetchChangelogs = async (
      fromVersion: string,
      toVersion: string,
    ): Promise<Changelog[]> => {
      try {
        const res = await fetch(CHANGELOG_URL);
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
    const checkForUpdates = async () => {
      const update = await check();
      setUpdate(update);
      if (update) {
        setNewVersion(update.version);
        const changelogs = await fetchChangelogs(currentVersion, update.version);
        if (changelogs.length > 0) {
          setChangelogs(changelogs);
        } else {
          setChangelogs([
            {
              version: update.version,
              date: new Date(update.date!).toDateString(),
              notes: parseNumberedList(update.body ?? ''),
            },
          ]);
        }
      }
    };
    checkForUpdates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useTheme();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const handleDownloadInstall = async () => {
    if (!update) {
      return;
    }
    console.log(`found update ${update.version} from ${update.date} with notes ${update.body}`);
    let downloaded = 0;
    let contentLength = 0;
    let lastLogged = 0;
    setProgress(0);
    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case 'Started':
          contentLength = event.data.contentLength!;
          setContentLength(contentLength);
          console.log(`started downloading ${event.data.contentLength} bytes`);
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
    console.log('update installed');
    await relaunch();
  };

  if (!isMounted) {
    return null;
  }

  return (
    <div className='bg-base-300 flex min-h-screen items-center justify-center'>
      <div className='card bg-base-200 w-full max-w-2xl !rounded-none shadow-xl'>
        <div className='card-body'>
          <div className='flex items-start gap-8'>
            <div className='flex flex-col items-center justify-center gap-4'>
              <div className='bg-base-200 flex items-center justify-center rounded-2xl shadow-md'>
                <Image src='/icon.png' alt='Logo' className='h-20 w-20' width={64} height={64} />
              </div>
            </div>

            <div className='text-base-content flex-1 text-sm'>
              <h2 className='mb-2 font-bold'>{_('A new version of Readest is Available!')}</h2>
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
                      !update && 'btn-disabled',
                    )}
                    onClick={handleDownloadInstall}
                  >
                    {_('DOWNLOAD & INSTALL')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className='text-base-content px-8 text-sm'>
          <h3 className='mb-2 font-bold'>{_('Changelog:')}</h3>
          <div className='bg-base-300 mb-4 rounded-lg px-4 pb-2 pt-4'>
            {changelogs.length > 0 ? (
              changelogs.map((entry: Changelog) => (
                <div key={entry.version} className='mb-4'>
                  <h4 className='mb-2 font-bold'>
                    {entry.version} ({entry.date})
                  </h4>
                  <ul className='list-disc space-y-1 pl-6 text-sm'>
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

const UpdaterPage = () => {
  return (
    <Suspense
      fallback={
        <div className='fixed inset-0 z-50 flex items-center justify-center'>
          <Spinner loading />
        </div>
      }
    >
      <UpdaterDialog />
    </Suspense>
  );
};

export default UpdaterPage;
