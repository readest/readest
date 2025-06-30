import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { checkForAppUpdates } from '@/helpers/updater';
import { parseWebViewVersion } from '@/utils/ua';
import { getAppVersion } from '@/utils/version';
import Dialog from './Dialog';
import Link from './Link';

export const setAboutDialogVisible = (visible: boolean) => {
  const dialog = document.getElementById('about_window');
  if (dialog) {
    const event = new CustomEvent('setDialogVisibility', {
      detail: { visible },
    });
    dialog.dispatchEvent(event);
  }
};

type UpdateStatus = 'checking' | 'updating' | 'updated' | 'error';

export const AboutWindow = () => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [browserInfo, setBrowserInfo] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setBrowserInfo(parseWebViewVersion(appService));

    const handleCustomEvent = (event: CustomEvent) => {
      setIsOpen(event.detail.visible);
    };

    const el = document.getElementById('about_window');
    if (el) {
      el.addEventListener('setDialogVisibility', handleCustomEvent as EventListener);
    }

    return () => {
      if (el) {
        el.removeEventListener('setDialogVisibility', handleCustomEvent as EventListener);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCheckUpdate = async () => {
    setUpdateStatus('checking');
    try {
      const update = await checkForAppUpdates(_, false);
      if (update) {
        setIsOpen(false);
      } else {
        setUpdateStatus('updated');
      }
    } catch (error) {
      console.info('Error checking for updates:', error);
      setUpdateStatus('error');
    }
  };

  const handleClose = () => {
    setIsOpen(false);
    setUpdateStatus(null);
  };

  return (
    <Dialog
      id='about_window'
      isOpen={isOpen}
      title={_('About Readest')}
      onClose={handleClose}
      boxClassName='sm:!w-96 sm:h-auto'
    >
      <div className='about-content flex h-full flex-col items-center justify-center'>
        <div className='flex flex-col items-center gap-2 px-8'>
          <div className='mb-2 mt-8'>
            <Image src='/icon.png' alt='App Logo' className='h-20 w-20' width={64} height={64} />
          </div>
          <div className='flex select-text flex-col items-center'>
            <h2 className='mb-2 text-2xl font-bold'>Readest</h2>
            <p className='text-neutral-content text-center text-sm'>
              {_('Version {{version}}', { version: getAppVersion() })} {`(${browserInfo})`}
            </p>
          </div>
          <div className='h-5'>
            {appService?.hasUpdater && !updateStatus && (
              <span className='badge badge-primary cursor-pointer p-1' onClick={handleCheckUpdate}>
                {_('Check Update')}
              </span>
            )}
            {updateStatus === 'updated' && (
              <p className='text-neutral-content mt-2 text-xs'>{_('Already the latest version')}</p>
            )}
            {updateStatus === 'checking' && (
              <p className='text-neutral-content mt-2 text-xs'>{_('Checking for updates...')}</p>
            )}
            {updateStatus === 'error' && (
              <p className='text-error mt-2 text-xs'>{_('Error checking for updates')}</p>
            )}
          </div>
        </div>

        <div className='divider py-16 sm:py-2'></div>

        <div className='flex flex-col items-center px-4 text-center' dir='ltr'>
          <p className='text-neutral-content text-sm'>
            © {new Date().getFullYear()} Bilingify LLC. All rights reserved.
          </p>
          <p className='text-neutral-content mt-2 text-xs'>
            This software is licensed under the{' '}
            <Link
              href='https://www.gnu.org/licenses/agpl-3.0.html'
              className='text-blue-500 underline'
            >
              GNU Affero General Public License v3.0
            </Link>
            . You are free to use, modify, and distribute this software under the terms of the AGPL
            v3 license. Please see the license for more details.
          </p>
          <p className='text-neutral-content my-2 text-xs'>
            Source code is available at{' '}
            <Link href='https://github.com/readest/readest' className='text-blue-500 underline'>
              GitHub
            </Link>
            .
          </p>
        </div>
      </div>
    </Dialog>
  );
};
