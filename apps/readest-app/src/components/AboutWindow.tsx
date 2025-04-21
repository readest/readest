import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import packageJson from '../../package.json';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { checkForAppUpdates } from '@/helpers/updater';
import { parseWebViewVersion } from '@/utils/ua';
import Dialog from './Dialog';
import Link from './Link';

export const setAboutDialogVisible = (visible: boolean) => {
  const dialog = document.getElementById('about_window');
  if (visible) {
    (dialog as HTMLDialogElement)?.showModal();
  } else {
    (dialog as HTMLDialogElement)?.close();
  }
};

export const AboutWindow = () => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const [isUpdated, setIsUpdated] = useState(false);
  const [browserInfo, setBrowserInfo] = useState('');

  useEffect(() => {
    setBrowserInfo(parseWebViewVersion(appService));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCheckUpdate = async () => {
    const update = await checkForAppUpdates(_, false);
    if (update) {
      setAboutDialogVisible(false);
    } else {
      setIsUpdated(true);
    }
  };

  return (
    <Dialog
      id='about_window'
      isOpen={false}
      title={_('About Readest')}
      onClose={() => setAboutDialogVisible(false)}
      boxClassName='sm:!w-96 sm:h-auto'
    >
      <div className='about-content flex h-full flex-col items-center justify-center'>
        <div className='flex flex-col items-center px-8'>
          <div className='mb-3'>
            <Image src='/icon.png' alt='App Logo' className='h-24 w-24' width={64} height={64} />
          </div>
          <div className='flex select-text flex-col items-center'>
            <h2 className='text-2xl font-bold'>Readest</h2>
            <p className='text-neutral-content text-center text-sm'>
              {_('Version {{version}}', { version: packageJson.version })} {`(${browserInfo})`}
            </p>
          </div>
          <div className='h-5'>
            {appService?.hasUpdater && !isUpdated && (
              <span className='badge badge-primary mt-2 cursor-pointer' onClick={handleCheckUpdate}>
                {_('Check Update')}
              </span>
            )}
            {isUpdated && (
              <p className='text-neutral-content mt-2 text-xs'>{_('Already the latest version')}</p>
            )}
          </div>
        </div>

        <div className='divider py-12 sm:py-2'></div>

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
