import React from 'react';
import Image from 'next/image';
import packageJson from '../../package.json';
import WindowButtons from './WindowButtons';
import { useTranslation } from '@/hooks/useTranslation';

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
  return (
    <dialog id='about_window' className='modal'>
      <form method='dialog' className='modal-box w-96 max-w-lg p-4'>
        <div className='dialog-header bg-base-100 sticky top-0 z-10 flex items-center justify-center p-2'>
          <WindowButtons
            className='window-buttons absolute right-0 flex h-full items-center'
            showMinimize={false}
            showMaximize={false}
            onClose={() => setAboutDialogVisible(false)}
          />
        </div>
        <div className='flex flex-col items-center px-8'>
          <div className='mb-4'>
            <Image src='/icon.png' alt='App Logo' className='h-24 w-24' width={64} height={64} />
          </div>
          <h2 className='text-2xl font-bold'>Readest</h2>
          <p className='text-neutral-content text-sm'>Bilingify LLC</p>
          <span className='badge badge-primary mt-2'>
            {_('Version {{version}}', { version: packageJson.version })}
          </span>
        </div>

        <div className='divider'></div>

        <div className='flex flex-col items-center px-4 text-center'>
          <p className='text-neutral-content text-sm'>
            © {new Date().getFullYear()} Bilingify LLC. All rights reserved.
          </p>
          <p className='text-neutral-content mt-2 text-xs'>
            This software is licensed under the{' '}
            <a
              href='https://www.gnu.org/licenses/agpl-3.0.html'
              target='_blank'
              rel='noopener noreferrer'
              className='text-blue-500 underline'
            >
              GNU Affero General Public License v3.0
            </a>
            . You are free to use, modify, and distribute this software under the terms of the AGPL
            v3 license. Please see the license for more details.
          </p>
          <p className='text-neutral-content mt-2 text-xs'>
            Source code is available at{' '}
            <a
              href='https://github.com/readest/readest'
              target='_blank'
              rel='noopener noreferrer'
              className='text-blue-500 underline'
            >
              GitHub
            </a>
            .
          </p>
        </div>
      </form>
    </dialog>
  );
};
